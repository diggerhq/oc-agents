import { Router, Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';
import { queryOne, query, execute } from '../db/index.js';
import { ocService, terminalEvents, getPartialOutput, clearPartialOutput, getSandboxKey } from '../services/oc.js';
import { getS3MountConfig } from '../services/storage.js';
import { OPENCODE_PROVIDERS, getModelById, DEFAULT_OPENCODE_MODEL } from '../config/models.js';
import { logEvent } from '../services/analytics.js';
import { syncAgentBucketsBackAndIndex } from '../services/attachedFilesSync.js';
import { sendTaskStatus } from '../services/websocket.js';
import { getGitHubTokenForUser } from './githubApp.js';
import type { Session, Task, ModelProvider, AgentConfig, AgentBucket } from '../types/index.js';

// Note: Skill detection is handled natively by oc.ts when configuring Claude settings.
// Files in skills/ folders are concatenated into CLAUDE.md which Claude Code reads automatically.

const router = Router();

// Allowed domains for gateway URLs
const ALLOWED_DOMAINS = ['oshu.dev', 'primeintuition.ai', 'localhost'];

// Get gateway base URL from request (for KB and MCP gateway URLs)
function getGatewayBaseUrl(req: Request): string {
  // Use GATEWAY_URL if set (for ngrok in local dev)
  if (process.env.GATEWAY_URL) {
    return process.env.GATEWAY_URL;
  }
  
  const host = req.get('host') || '';
  const protocol = req.get('x-forwarded-proto') || req.protocol;
  
  // Check if host is in allowed domains
  for (const domain of ALLOWED_DOMAINS) {
    if (host.includes(domain)) {
      return `${protocol}://${host}`;
    }
  }
  
  // Fallback to env var
  return process.env.PUBLIC_URL || `${protocol}://${host}`;
}

// Get available agent providers
router.get('/providers', requireAuth, (req, res) => {
  res.json({
    providers: [
      {
        id: 'claude-code',
        name: 'Claude Code',
        description: 'Anthropic\'s agentic coding CLI',
        requiresKey: 'ANTHROPIC_API_KEY',
      },
      {
        id: 'aider',
        name: 'Aider',
        description: 'AI pair programming with OpenAI',
        requiresKey: 'OPENAI_API_KEY',
      },
      {
        id: 'opencode',
        name: 'OpenCode',
        description: 'Open-source coding agent (75+ providers)',
        requiresKey: 'ANTHROPIC_API_KEY',
        supportsModelSelection: true,
      },
    ],
  });
});

// Get available models for OpenCode
router.get('/opencode/models', requireAuth, (req, res) => {
  // Check which API keys are configured
  const configuredProviders = OPENCODE_PROVIDERS.map(provider => ({
    ...provider,
    configured: !!process.env[provider.envKey],
    models: provider.models.map(model => ({
      ...model,
      configured: !!process.env[model.envKey],
    })),
  }));

  res.json({
    providers: configuredProviders,
    defaultModel: DEFAULT_OPENCODE_MODEL,
  });
});

// Start a sandbox for a session
router.post('/sessions/:sessionId/sandbox/start', requireAuth, async (req, res) => {
  try {
    const session = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.sessionId, req.session.userId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get GitHub App token if repo URL is provided
    let githubToken: string | undefined;
    if (session.repo_url) {
      const appToken = await getGitHubTokenForUser(req.session.userId!, session.repo_url);
      if (appToken) {
        githubToken = appToken.token;
        console.log(`[Agent] Using GitHub App token for repo access`);
      } else {
        return res.status(400).json({ error: 'GitHub App not installed (required for repo access). Install the GitHub App in Settings.' });
      }
    }

    // Check for required API key based on provider
    const provider = session.agent_provider || 'claude-code';
    if (provider === 'claude-code' && !process.env.ANTHROPIC_API_KEY) {
      return res.status(400).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
    }
    if (provider === 'aider' && !process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OPENAI_API_KEY not configured on server' });
    }
    if (provider === 'opencode' && !process.env.ANTHROPIC_API_KEY) {
      return res.status(400).json({ error: 'ANTHROPIC_API_KEY not configured on server (OpenCode uses Anthropic)' });
    }

    // Generate sandbox key for playground (owner testing) - isolated from SDK users
    const sandboxKey = getSandboxKey({ agentId: session.id, surface: 'playground' });
    
    // Create sandbox with provider-specific template if available
    console.log(`[Agent] Creating sandbox for session ${session.id} with key ${sandboxKey} and provider ${provider}`);
    const sandboxInfo = await ocService.createSandbox(sandboxKey, provider as ModelProvider);

    // Clone the repository if URL is provided
    if (session.repo_url && githubToken) {
      console.log(`[Agent] Cloning repo ${session.repo_url}`);
      const cloneResult = await ocService.cloneRepo(
        sandboxKey,
        session.repo_url,
        session.branch || 'main',
        githubToken
      );

      if (!cloneResult.success) {
        await ocService.closeSandbox(sandboxKey);
        return res.status(500).json({ error: `Failed to clone repo: ${cloneResult.error}` });
      }
    } else if (!session.repo_url) {
      console.log(`[Agent] No repo URL provided, skipping clone`);
    }

    // Install agent tools based on provider
    console.log(`[Agent] Installing ${provider} tools...`);
    const installResult = await ocService.installAgentTools(sandboxKey, provider as ModelProvider);
    
    if (!installResult.success) {
      await ocService.closeSandbox(sandboxKey);
      return res.status(500).json({ error: `Failed to install ${provider}: ${installResult.error}` });
    }

    // Mount any attached buckets
    const agentBuckets = await query<AgentBucket & { bucket_name: string }>(
      `SELECT ab.*, b.name as bucket_name FROM agent_buckets ab 
       JOIN buckets b ON ab.bucket_id = b.id 
       WHERE ab.session_id = $1`,
      [session.id]
    );
    
    if (agentBuckets.length > 0) {
      console.log(`[Agent] Syncing ${agentBuckets.length} bucket(s) for session ${session.id}`);
      
      // Get user's storage config
      const storageConfig = await getS3MountConfig(req.session.userId!);
      
      if (storageConfig) {
        // Install rclone first
        const rcloneResult = await ocService.installRclone(sandboxKey);
        if (!rcloneResult.success) {
          console.error(`[Agent] Failed to install rclone: ${rcloneResult.error}`);
        } else {
          // Sync each bucket to a named subdirectory (e.g., /files/Documents/)
          for (const bucket of agentBuckets) {
            // Resolve base path - ensure it's under /home/user
            let basePath = bucket.mount_path;
            if (!basePath.startsWith('/home/')) {
              basePath = `/home/user${basePath.startsWith('/') ? '' : '/'}${basePath}`;
            }
            
            // Mount to a subdirectory named after the bucket (friendly name)
            const localPath = `${basePath}/${bucket.bucket_name}`;
            const remotePath = `${req.session.userId}/${bucket.bucket_id}`;
            
            console.log(`[Agent] Syncing bucket "${bucket.bucket_name}" to ${localPath}`);
            
            const syncResult = await ocService.syncWithRclone(sandboxKey, {
              provider: storageConfig.provider,
              bucketName: storageConfig.bucketName,
              accessKeyId: storageConfig.accessKeyId,
              secretAccessKey: storageConfig.secretAccessKey,
              endpoint: storageConfig.endpoint,
              region: storageConfig.region,
              remotePath,
              localPath,
            });
            
            if (!syncResult.success) {
              console.error(`[Agent] Failed to sync bucket ${bucket.bucket_name}: ${syncResult.error}`);
            } else {
              console.log(`[Agent] Successfully synced "${bucket.bucket_name}" to ${localPath}`);
            }
          }
        }
      } else {
        console.warn(`[Agent] No storage config found for user ${req.session.userId}, cannot sync buckets`);
      }
    }

    // Update session with sandbox ID
    await execute(
      "UPDATE sessions SET sandbox_id = $1, status = 'active', updated_at = NOW() WHERE id = $2",
      [sandboxInfo.id, session.id]
    );

    console.log(`[Agent] Sandbox ready for session ${session.id}`);
    
    // Log sandbox start event
    logEvent({
      agentId: session.id,
      eventType: 'sandbox_start',
      source: 'chat',
      sessionId: session.id,
      success: true,
      metadata: { provider, sandboxId: sandboxInfo.id },
    });

    res.json({
      success: true,
      sandbox: sandboxInfo,
      provider,
    });
  } catch (error) {
    console.error('Start sandbox error:', error);
    res.status(500).json({ error: 'Failed to start sandbox' });
  }
});

// Stop a sandbox
router.post('/sessions/:sessionId/sandbox/stop', requireAuth, async (req, res) => {
  try {
    const session = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.sessionId, req.session.userId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Generate sandbox key for playground
    const sandboxKey = getSandboxKey({ agentId: session.id, surface: 'playground' });

    // Best-effort: persist any attached file changes before shutdown.
    try {
      await syncAgentBucketsBackAndIndex({
        sandboxSessionId: sandboxKey,
        agentId: session.id,
        ownerUserId: session.user_id,
      });
    } catch (syncErr) {
      console.error(`[Agent] Sync-back/index failed during sandbox stop for session ${session.id}:`, syncErr);
    }

    await ocService.closeSandbox(sandboxKey);

    await execute(
      "UPDATE sessions SET sandbox_id = NULL, status = 'completed', updated_at = NOW() WHERE id = $1",
      [session.id]
    );
    
    // Log sandbox stop event
    logEvent({
      agentId: session.id,
      eventType: 'sandbox_stop',
      source: 'chat',
      sessionId: session.id,
      success: true,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Stop sandbox error:', error);
    res.status(500).json({ error: 'Failed to stop sandbox' });
  }
});

// Reset a sandbox (destroy and recreate)
router.post('/sessions/:sessionId/sandbox/reset', requireAuth, async (req, res) => {
  try {
    const session = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.sessionId, req.session.userId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Generate sandbox key for playground
    const sandboxKey = getSandboxKey({ agentId: session.id, surface: 'playground' });
    const provider = session.agent_provider || 'claude-code';

    // Close existing sandbox if running
    try {
      await ocService.closeSandbox(sandboxKey);
      console.log(`[Agent] Closed existing sandbox ${sandboxKey} for reset`);
    } catch (closeErr) {
      console.log(`[Agent] No existing sandbox to close for ${sandboxKey}`);
    }

    // Create new sandbox
    console.log(`[Agent] Creating new sandbox ${sandboxKey} for reset`);
    const sandboxInfo = await ocService.createSandbox(sandboxKey, provider as ModelProvider);

    // Clone repo if available (using GitHub App token)
    if (session.repo_url) {
      const appToken = await getGitHubTokenForUser(req.session.userId!, session.repo_url);
      if (appToken) {
        const cloneResult = await ocService.cloneRepo(
          sandboxKey,
          session.repo_url,
          session.branch || 'main',
          appToken.token
        );
        if (!cloneResult.success) {
          console.error(`[Agent] Failed to clone repo during reset: ${cloneResult.error}`);
        }
      } else {
        console.log(`[Agent] GitHub App not installed, skipping repo clone during reset`);
      }
    }

    // Install tools
    const installResult = await ocService.installAgentTools(sandboxKey, provider as ModelProvider);
    if (!installResult.success) {
      console.error(`[Agent] Failed to install tools during reset: ${installResult.error}`);
    }

    // Update session status
    await execute(
      "UPDATE sessions SET sandbox_id = $1, status = 'active', updated_at = NOW() WHERE id = $2",
      [sandboxInfo.id, session.id]
    );

    // Log reset event
    logEvent({
      agentId: session.id,
      eventType: 'sandbox_reset',
      source: 'chat',
      sessionId: session.id,
      success: true,
      metadata: { provider, sandboxId: sandboxInfo.id },
    });

    console.log(`[Agent] Sandbox reset complete for ${session.id}`);

    res.json({ 
      success: true, 
      sandboxId: sandboxInfo.id,
      message: 'Sandbox reset successfully'
    });
  } catch (error) {
    console.error('Reset sandbox error:', error);
    res.status(500).json({ error: 'Failed to reset sandbox' });
  }
});

// Run a task with the agent CLI
router.post('/sessions/:sessionId/tasks/:taskId/run', requireAuth, async (req, res) => {
  try {
    const session = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.sessionId, req.session.userId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status !== 'active' || !session.sandbox_id) {
      return res.status(400).json({ error: 'Session sandbox not active' });
    }
    
    // Generate sandbox key for playground (owner testing)
    const sandboxKey = getSandboxKey({ agentId: session.id, surface: 'playground' });

    const task = await queryOne<Task>(
      'SELECT * FROM tasks WHERE id = $1 AND session_id = $2',
      [req.params.taskId, session.id]
    );

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (task.status === 'running') {
      return res.status(400).json({ error: 'Task already running' });
    }

    const provider = session.agent_provider || 'claude-code';
    const model = session.agent_model;

    // Load agent configuration (system prompt, secrets, etc.)
    const agentConfig = await queryOne<AgentConfig>(
      'SELECT * FROM agent_configs WHERE session_id = $1',
      [session.id]
    );
    
    // Map model provider prefixes to environment variable names
    const PROVIDER_ENV_KEYS: Record<string, string> = {
      'openrouter': 'OPENROUTER_API_KEY',
      'anthropic': 'ANTHROPIC_API_KEY',
      'openai': 'OPENAI_API_KEY',
      'google': 'GOOGLE_API_KEY',
      'groq': 'GROQ_API_KEY',
      'mistral': 'MISTRAL_API_KEY',
      'deepseek': 'DEEPSEEK_API_KEY',
      'together': 'TOGETHER_API_KEY',
      'xai': 'XAI_API_KEY',
      'ollama': 'OLLAMA_HOST',
    };
    
    // Determine API key based on provider and model
    let apiKey: string;
    let apiKeys: Record<string, string> = {}; // All configured keys for OpenCode
    
    if (provider === 'aider') {
      apiKey = process.env.OPENAI_API_KEY!;
    } else if (provider === 'opencode' && model) {
      // Extract provider from model prefix (e.g., "huggingface/meta-llama/..." -> "huggingface")
      const modelProvider = model.split('/')[0].toLowerCase();
      const envKey = PROVIDER_ENV_KEYS[modelProvider] || 'ANTHROPIC_API_KEY';
      apiKey = process.env[envKey] || process.env.ANTHROPIC_API_KEY!;
      
      // Collect all configured API keys for OpenCode
      for (const [prov, key] of Object.entries(PROVIDER_ENV_KEYS)) {
        if (process.env[key]) {
          apiKeys[key] = process.env[key]!;
        }
      }
      
      console.log(`[Agent] Model ${model} -> provider ${modelProvider} -> using ${envKey}`);
      console.log(`[Agent] ${envKey} set: ${!!process.env[envKey]}`);
      console.log(`[Agent] apiKeys collected: ${Object.keys(apiKeys).join(', ')}`);
    } else {
      apiKey = process.env.ANTHROPIC_API_KEY!;
    }

    // Update task status to running
    await execute(
      "UPDATE tasks SET status = 'running', model_provider = $1, model_name = $2, updated_at = NOW() WHERE id = $3",
      [provider, model || null, task.id]
    );
    
    // Log message event
    logEvent({
      agentId: session.id,
      eventType: 'message',
      source: 'chat',
      sessionId: session.id,
      metadata: { taskId: task.id, provider, model },
    });

    // Track timing for latency calculation
    const startTime = Date.now();

    // Return immediately, run agent in background
    res.json({ 
      success: true, 
      message: 'Task started',
      provider,
      model,
    });

    // Run the agent CLI in background
    (async () => {
      try {
        // Fetch conversation history for this session
        const conversationHistory = await query<{ role: string; content: string }>(
          `SELECT m.role, m.content FROM messages m 
           JOIN tasks t ON m.task_id = t.id 
           WHERE t.session_id = $1 AND m.id != $2
           ORDER BY m.created_at ASC`,
          [session.id, task.id]
        );
        
        // Build full prompt with conversation history and system prompt
        // Note: Skill files are loaded natively by oc.ts into CLAUDE.md
        let fullPrompt = '';
        
        // Add system instructions first
        if (agentConfig?.system_prompt) {
          fullPrompt += `[System Instructions]\n${agentConfig.system_prompt}\n\n`;
          console.log(`[Agent] Including system prompt from config for task ${task.id}`);
        }
        
        // Add conversation history if exists
        if (conversationHistory.length > 0) {
          fullPrompt += `[Previous Conversation]\n`;
          for (const msg of conversationHistory) {
            const label = msg.role === 'user' ? 'User' : 'Assistant';
            // Truncate long assistant messages to avoid token limits
            const content = msg.role === 'assistant' && msg.content.length > 2000 
              ? msg.content.slice(0, 2000) + '\n... (truncated)'
              : msg.content;
            fullPrompt += `${label}: ${content}\n\n`;
          }
          fullPrompt += `[Current Request]\n`;
          console.log(`[Agent] Including ${conversationHistory.length} previous messages as context`);
        }
        
        fullPrompt += task.prompt;
        
        console.log(`[Agent] Running ${provider}${model ? ` with model ${model}` : ''} for task ${task.id}`);
        if (agentConfig?.name) {
          console.log(`[Agent] Agent name: ${agentConfig.name}`);
        }
        
        // Parse agent secrets for environment variables
        let customSecrets: Record<string, string> | undefined;
        if (agentConfig?.secrets) {
          try {
            customSecrets = JSON.parse(agentConfig.secrets);
            if (Object.keys(customSecrets || {}).length > 0) {
              console.log(`[Agent] Including ${Object.keys(customSecrets!).length} custom secrets for agent ${session.id}`);
            }
          } catch (e) {
            console.error(`[Agent] Failed to parse secrets for agent ${session.id}:`, e);
          }
        }
        
        // Add GitHub App token to custom secrets if user has GitHub App installed
        // This enables gh CLI and GitHub API access for all agents
        const githubAppToken = await getGitHubTokenForUser(session.user_id, session.repo_url || undefined);
        if (githubAppToken) {
          customSecrets = customSecrets || {};
          customSecrets['GITHUB_TOKEN'] = githubAppToken.token;
          customSecrets['GH_TOKEN'] = githubAppToken.token;
          console.log(`[Agent] Including GitHub App token for agent ${session.id}`);
        }

        // Configure Claude Code with system prompt, MCP servers, and knowledge bases
        let configuredSystemPrompt: string | undefined;
        if (provider === 'claude-code') {
          const mcpServers = agentConfig?.mcp_servers 
            ? JSON.parse(agentConfig.mcp_servers).filter((s: any) => s.type === 'custom')
            : [];
          
          // Check if agent has knowledge bases attached
          const kbAttachments = await query<{ id: string }>(
            'SELECT id FROM agent_knowledge_bases WHERE session_id = $1 LIMIT 1',
            [session.id]
          );
          const hasKnowledgeBases = kbAttachments.length > 0;
          
          // Always configure Claude settings to detect skill files, even if no explicit config
          const gatewayBaseUrl = getGatewayBaseUrl(req);
          console.log(`[Agent] Configuring Claude settings: system_prompt=${!!agentConfig?.system_prompt}, mcp_servers=${mcpServers.length}, knowledge_bases=${hasKnowledgeBases}, gateway=${gatewayBaseUrl}`);
          const configResult = await ocService.configureClaudeSettings(sandboxKey, {
              systemPrompt: agentConfig?.system_prompt,
              mcpServers: mcpServers.map((s: any) => ({
                id: s.id,
                name: s.name,
                transport: s.transport,
                url: s.url,
                headers: s.headers,
              })),
              secrets: customSecrets,
              agentId: session.id,
              hasKnowledgeBases,
              gatewayBaseUrl,
            });
            configuredSystemPrompt = configResult.systemPrompt;
        }
        
        // Build extended thinking config from agent settings
        const extendedThinking = agentConfig?.enable_extended_thinking
          ? { enabled: true, budgetTokens: agentConfig.thinking_budget_tokens || 100000 }
          : undefined;
        
        const result = await ocService.runAgentCommand(
          sandboxKey,
          provider as ModelProvider,
          fullPrompt,
          apiKey,
          model,  // Pass model to oc service
          apiKeys,  // Pass all configured API keys for OpenCode
          customSecrets,  // Pass per-agent custom secrets
          configuredSystemPrompt,  // Pass system prompt for --append-system-prompt
          extendedThinking  // Pass extended thinking configuration
        );

        // Persist any attached-file changes (non-repo agents depend on this).
        try {
          await syncAgentBucketsBackAndIndex({
            sandboxSessionId: sandboxKey,
            agentId: session.id,
            ownerUserId: session.user_id,
          });
        } catch (syncErr) {
          console.error(`[Agent] Sync-back/index failed for session ${session.id}:`, syncErr);
        }

        // Save the output as assistant message
        const msgId = uuidv4();
        const content = result.stdout || result.stderr || 'No output from agent';
        
        await execute(
          "INSERT INTO messages (id, task_id, role, content) VALUES ($1, $2, 'assistant', $3)",
          [msgId, task.id, content]
        );

        // Update task status
        const latencyMs = Date.now() - startTime;
        
        if (result.exitCode === 0) {
          await execute(
            "UPDATE tasks SET status = 'completed', result = $1, updated_at = NOW() WHERE id = $2",
            [content.slice(0, 1000), task.id]
          );
          
          // Notify frontend via WebSocket that task completed
          sendTaskStatus(session.id, task.id, 'completed', content.slice(0, 500));
          
          // Log successful response
          logEvent({
            agentId: session.id,
            eventType: 'response',
            source: 'chat',
            sessionId: session.id,
            latencyMs,
            success: true,
            metadata: { taskId: task.id, responseLength: content.length },
          });
        } else {
          await execute(
            "UPDATE tasks SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2",
            [result.stderr || 'Agent exited with non-zero code', task.id]
          );
          
          // Notify frontend via WebSocket that task failed
          sendTaskStatus(session.id, task.id, 'failed', result.stderr || 'Agent exited with non-zero code');
          
          // Log failed response
          logEvent({
            agentId: session.id,
            eventType: 'error',
            source: 'chat',
            sessionId: session.id,
            latencyMs,
            success: false,
            errorMessage: result.stderr || 'Agent exited with non-zero code',
            metadata: { taskId: task.id },
          });
        }

        // Auto-commit changes if successful
        if (result.exitCode === 0) {
          console.log(`[Agent] Auto-committing changes for task ${task.id}`);
          await ocService.commitChanges(sandboxKey, `Agent task: ${task.prompt.slice(0, 50)}...`);
        }

        console.log(`[Agent] Task ${task.id} completed with exit code ${result.exitCode}`);
      } catch (error) {
        console.error(`[Agent] Task ${task.id} error:`, error);
        await execute(
          "UPDATE tasks SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2",
          [String(error), task.id]
        );
        // Notify frontend via WebSocket that task failed
        sendTaskStatus(session.id, task.id, 'failed', String(error));
      }
    })();

  } catch (error) {
    console.error('Run task error:', error);
    res.status(500).json({ error: 'Failed to run task' });
  }
});

// Create a branch and push changes
router.post('/sessions/:sessionId/branch', requireAuth, async (req, res) => {
  try {
    const { branch_name } = req.body;

    if (!branch_name) {
      return res.status(400).json({ error: 'Branch name required' });
    }

    const session = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.sessionId, req.session.userId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status !== 'active') {
      return res.status(400).json({ error: 'Session not active' });
    }

    // Generate sandbox key for playground
    const sandboxKey = getSandboxKey({ agentId: session.id, surface: 'playground' });
    const result = await ocService.createBranch(sandboxKey, branch_name);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Create branch error:', error);
    res.status(500).json({ error: 'Failed to create branch' });
  }
});

// Push changes to remote
router.post('/sessions/:sessionId/push', requireAuth, async (req, res) => {
  try {
    const { branch } = req.body;

    const session = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.sessionId, req.session.userId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status !== 'active') {
      return res.status(400).json({ error: 'Session not active' });
    }

    // Generate sandbox key for playground
    const sandboxKey = getSandboxKey({ agentId: session.id, surface: 'playground' });
    const result = await ocService.pushChanges(sandboxKey, branch || session.branch);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Push error:', error);
    res.status(500).json({ error: 'Failed to push changes' });
  }
});

// Poll for partial streaming output (simpler than SSE)
router.get('/sessions/:sessionId/output', requireAuth, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.sessionId, req.session.userId]
  );

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const output = getPartialOutput(session.id);
  const combined = output.join('');
  if (combined.length > 0) {
    console.log(`[Output] Session ${session.id}: ${combined.length} chars available`);
  }
  res.json({ output: combined });
});

// Stream terminal output via Server-Sent Events
router.get('/sessions/:sessionId/terminal', requireAuth, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.sessionId, req.session.userId]
  );

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Set up SSE headers (CORS handled by middleware)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId: session.id })}\n\n`);

  // Listen for terminal events
  const eventName = `terminal:${session.id}`;
  const handler = (event: { type: string; data?: string; command?: string; exitCode?: number; elapsed?: string; timestamp: number }) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  terminalEvents.on(eventName, handler);

  // Keep connection alive with heartbeat
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
  }, 30000);

  // Clean up on close
  req.on('close', () => {
    terminalEvents.off(eventName, handler);
    clearInterval(heartbeat);
  });
});

// Execute a command in the sandbox (for debugging/manual operations)
router.post('/sessions/:sessionId/exec', requireAuth, async (req, res) => {
  try {
    const { command, cwd } = req.body;

    if (!command) {
      return res.status(400).json({ error: 'Command required' });
    }

    const session = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.sessionId, req.session.userId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status !== 'active') {
      return res.status(400).json({ error: 'Session not active' });
    }

    // Generate sandbox key for playground
    const sandboxKey = getSandboxKey({ agentId: session.id, surface: 'playground' });
    const result = await ocService.runCommand(sandboxKey, command, cwd);

    res.json(result);
  } catch (error) {
    console.error('Exec error:', error);
    res.status(500).json({ error: 'Failed to execute command' });
  }
});

// Clear chat history for an agent (delete all tasks and messages)
router.delete('/sessions/:sessionId/chat', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Verify session exists and user has access
    const session = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [sessionId, req.session.userId]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Delete all messages for tasks in this session
    await execute(
      `DELETE FROM messages WHERE task_id IN (SELECT id FROM tasks WHERE session_id = $1)`,
      [sessionId]
    );
    
    // Delete all tasks for this session
    await execute(
      'DELETE FROM tasks WHERE session_id = $1',
      [sessionId]
    );
    
    console.log(`[Agent] Cleared chat history for session ${sessionId}`);
    
    res.json({ success: true, message: 'Chat history cleared' });
  } catch (error) {
    console.error('Clear chat error:', error);
    res.status(500).json({ error: 'Failed to clear chat history' });
  }
});

// Warmup sandbox for an agent
router.post('/agents/:agentId/warmup', requireAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    
    // Verify agent exists and user has access
    const agent = await queryOne<AgentConfig>(
      'SELECT * FROM agent_configs WHERE session_id = $1',
      [agentId]
    );
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Check if user owns this agent (via session)
    const session = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [agentId, req.session.userId]
    );
    
    if (!session) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    console.log(`[API] Warming up sandbox for agent ${agentId}`);
    
    const result = await ocService.warmupSandbox(agentId);
    
    if (result.success) {
      const messages = {
        created: 'Sandbox created and warming up',
        extended: 'Sandbox already warm, lifetime extended',
        already_warm: 'Sandbox already warm'
      };
      
      res.json({
        success: true,
        message: messages[result.status || 'created'],
        sandboxId: result.sandboxId,
        status: result.status || 'created'
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to warm up sandbox'
      });
    }
    
  } catch (error) {
    console.error('Warmup error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to warm up sandbox' 
    });
  }
});

// Warmup sandboxes for multiple agents
router.post('/agents/warmup', requireAuth, async (req, res) => {
  try {
    const { agentIds } = req.body;
    
    if (!Array.isArray(agentIds) || agentIds.length === 0) {
      return res.status(400).json({ error: 'agentIds array required' });
    }
    
    if (agentIds.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 agents can be warmed up at once' });
    }
    
    // Verify all agents exist and user has access
    const accessChecks = await Promise.all(
      agentIds.map(async (agentId: string) => {
        const session = await queryOne<Session>(
          'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
          [agentId, req.session.userId]
        );
        return { agentId, hasAccess: !!session };
      })
    );
    
    const unauthorizedAgents = accessChecks.filter(check => !check.hasAccess);
    if (unauthorizedAgents.length > 0) {
      return res.status(403).json({ 
        error: 'Access denied to agents: ' + unauthorizedAgents.map(a => a.agentId).join(', ')
      });
    }
    
    console.log(`[API] Warming up sandboxes for ${agentIds.length} agents`);
    
    const result = await ocService.warmupMultipleSandboxes(agentIds);
    
    res.json({
      success: result.success,
      message: `Warmed up ${result.results.filter(r => r.success).length}/${agentIds.length} sandboxes`,
      results: result.results
    });
    
  } catch (error) {
    console.error('Bulk warmup error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to warm up sandboxes' 
    });
  }
});

export default router;
