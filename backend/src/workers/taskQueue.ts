import { v4 as uuidv4 } from 'uuid';
import { queryOne, query, execute } from '../db/index.js';
import { ocService, getSandboxKey } from '../services/oc.js';
import { getS3MountConfig } from '../services/storage.js';
import { indexBucketFromSandboxDir } from '../services/attachedFilesSync.js';
import {
  sendTaskStarted,
  sendTaskStdout,
  sendTaskStderr,
  sendTaskToolStart,
  sendTaskToolEnd,
  sendTaskCompleted,
  sendTaskFailed,
  sendTaskCancelled,
  hasTaskSubscribers,
} from '../services/taskWebsocket.js';
import { getGitHubTokenForUser } from '../routes/githubApp.js';
import type { Session, QueuedTask, AgentConfig, ModelProvider, AgentBucket } from '../types/index.js';

// Note: Skill detection is handled natively by oc.ts when configuring Claude settings.
// Files in skills/ folders are concatenated into CLAUDE.md which Claude Code reads automatically.

// Track which sandbox keys are currently processing
// We track by sandbox key (not agent ID) to allow parallel processing of different SDK sessions
const processingSandboxes = new Set<string>();

// Track if rclone is installed in a sandbox (keyed by sandbox key)
const rcloneInstalled = new Set<string>();

/**
 * Sync a user's bucket to the sandbox using rclone
 * Copies files from cloud storage to the sandbox filesystem
 */
async function syncBucketWithRclone(
  sandboxKey: string, 
  bucketId: string, 
  localPath: string, 
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get S3 mount configuration for this user
    const storageConfig = await getS3MountConfig(userId);
    
    if (!storageConfig) {
      return { 
        success: false, 
        error: 'No object storage configured. Please configure S3/R2 storage in Settings.' 
      };
    }

    // Install rclone if not already installed in this sandbox
    if (!rcloneInstalled.has(sandboxKey)) {
      console.log(`[Queue] Installing rclone in sandbox ${sandboxKey}...`);
      const installResult = await ocService.installRclone(sandboxKey);
      if (!installResult.success) {
        return { success: false, error: `Failed to install rclone: ${installResult.error}` };
      }
      rcloneInstalled.add(sandboxKey);
    }

    // Sync the bucket
    // The remote path within the bucket is: userId/bucketId
    const remotePath = `${userId}/${bucketId}`;
    
    console.log(`[Queue] Syncing bucket via rclone: ${storageConfig.bucketName}/${remotePath} -> ${localPath}`);
    
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
      return { success: false, error: `Failed to sync bucket: ${syncResult.error}` };
    }

    console.log(`[Queue] Successfully synced bucket ${bucketId} to ${localPath}`);
    return { success: true };
  } catch (error) {
    console.error(`[Queue] Failed to sync bucket:`, error);
    return { success: false, error: String(error) };
  }
}

/**
 * Sync files from sandbox back to S3/R2 after task completion
 * This persists any files created by the agent
 */
async function syncBucketBackWithRclone(
  sandboxKey: string, 
  bucketId: string, 
  localPath: string, 
  userId: string
): Promise<{ success: boolean; error?: string; filesUploaded?: number }> {
  try {
    const storageConfig = await getS3MountConfig(userId);
    
    if (!storageConfig) {
      return { 
        success: false, 
        error: 'No object storage configured.' 
      };
    }

    // rclone should already be installed from the initial sync
    const remotePath = `${userId}/${bucketId}`;
    
    console.log(`[Queue] Syncing back bucket via rclone: ${localPath} -> ${storageConfig.bucketName}/${remotePath}`);
    
    const syncResult = await ocService.syncBackWithRclone(sandboxKey, {
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
      return { success: false, error: `Failed to sync bucket back: ${syncResult.error}` };
    }

    console.log(`[Queue] Successfully synced back ${syncResult.filesUploaded || 0} file(s) from ${localPath} to bucket ${bucketId}`);
    return { success: true, filesUploaded: syncResult.filesUploaded };
  } catch (error) {
    console.error(`[Queue] Failed to sync bucket back:`, error);
    return { success: false, error: String(error) };
  }
}

// Track mounted bucket paths per sandbox for sync-back (keyed by sandboxKey)
const sessionBucketPaths = new Map<string, Array<{ bucketId: string; localPath: string; userId: string }>>();

/**
 * Check if a task has been cancelled
 */
async function isTaskCancelled(taskId: string): Promise<boolean> {
  const task = await queryOne<{ status: string }>(
    'SELECT status FROM task_queue WHERE id = $1',
    [taskId]
  );
  return task?.status === 'cancelling' || task?.status === 'cancelled';
}

// Process a single queued task
async function processTask(task: QueuedTask): Promise<void> {
  console.log(`[Queue] Processing task ${task.id} for agent ${task.agent_id}`);
  
  // Check for cancellation before starting
  if (await isTaskCancelled(task.id)) {
    console.log(`[Queue] Task ${task.id} was cancelled before processing`);
    await execute(
      "UPDATE task_queue SET status = 'cancelled', completed_at = NOW() WHERE id = $1",
      [task.id]
    );
    sendTaskCancelled(task.id);
    return;
  }
  
  // Mark as processing
  await execute(
    "UPDATE task_queue SET status = 'processing', started_at = NOW() WHERE id = $1",
    [task.id]
  );
  
  // Notify WebSocket subscribers that task started
  sendTaskStarted(task.id);
  
  try {
    // Get the session/agent
    const session = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1',
      [task.agent_id]
    );
    
    if (!session) {
      throw new Error('Agent not found');
    }
    
    // Determine sandbox key based on SDK session or default shared
    // If task has sdk_session_id, use that for isolation; otherwise use default shared sandbox
    const sandboxKey = task.sdk_session_id
      ? getSandboxKey({ agentId: task.agent_id, surface: 'sdk', sdkSessionId: task.sdk_session_id })
      : task.agent_id;  // Default shared sandbox for backward compatibility
    
    console.log(`[Queue] Using sandbox key: ${sandboxKey} (sdk_session_id: ${task.sdk_session_id || 'none'})`);
    
    // Get agent config
    const config = await queryOne<AgentConfig>(
      'SELECT * FROM agent_configs WHERE session_id = $1',
      [session.id]
    );
    
    // Check for attached buckets
    const agentBuckets = await query<AgentBucket & { bucket_name: string }>(
      `SELECT ab.*, b.name as bucket_name FROM agent_buckets ab 
       JOIN buckets b ON ab.bucket_id = b.id 
       WHERE ab.session_id = $1`,
      [session.id]
    );
    
    const hasBuckets = agentBuckets.length > 0;
    
    // Get GitHub App token if repo URL is provided
    let githubToken: string | undefined;
    if (session.repo_url) {
      const appToken = await getGitHubTokenForUser(task.user_id, session.repo_url);
      if (appToken) {
        githubToken = appToken.token;
        console.log(`[Queue] Using GitHub App token for repo access`);
      }
    }
    const hasRepo = session.repo_url && githubToken;
    
    // Code agents now work with either repo OR files (or both)
    if (session.agent_type === 'code' && !hasRepo && !hasBuckets) {
      throw new Error('Agent needs either a GitHub repo (with GitHub App installed) or files bucket attached');
    }
    
    const provider = session.agent_provider || 'claude-code';
    
    // Check if sandbox is already running for this sandbox key
    let sandbox = await ocService.getSandbox(sandboxKey);
    const isNewSandbox = !sandbox;
    
    if (isNewSandbox) {
      // Need to spin up a new sandbox
      console.log(`[Queue] Starting sandbox with key ${sandboxKey}`);
      
      await ocService.createSandbox(sandboxKey, provider as ModelProvider);
      
      // Clone repo if available (using GitHub App token)
      if (session.repo_url && githubToken) {
        const cloneResult = await ocService.cloneRepo(
          sandboxKey,
          session.repo_url,
          session.branch || 'main',
          githubToken
        );
        
        if (!cloneResult.success) {
          throw new Error(`Failed to clone repo: ${cloneResult.error}`);
        }
      } else if (!session.repo_url) {
        console.log(`[Queue] No repo to clone - using files only`);
      }
      
      // Install tools
      const installResult = await ocService.installAgentTools(sandboxKey, provider as ModelProvider);
      if (!installResult.success) {
        throw new Error(`Failed to install tools: ${installResult.error}`);
      }
      
      // Update session status
      await execute(
        "UPDATE sessions SET status = 'active', updated_at = NOW() WHERE id = $1",
        [session.id]
      );
    }
    
    // Mount bucket files (always check - handles new buckets added after sandbox creation)
    if (hasBuckets) {
      console.log(`[Queue] Mounting ${agentBuckets.length} bucket(s) for sandbox ${sandboxKey}`);
      for (const bucket of agentBuckets) {
        // Resolve base path - if relative, prefix with /home/user
        let basePath = bucket.mount_path;
        if (!basePath.startsWith('/home/')) {
          // Convert paths like /workspace/files to /home/user/workspace/files
          basePath = `/home/user${basePath.startsWith('/') ? '' : '/'}${basePath}`;
        }
        
        // Mount to a subdirectory named after the bucket (friendly name)
        const localPath = `${basePath}/${bucket.bucket_name}`;
        
        const syncResult = await syncBucketWithRclone(sandboxKey, bucket.bucket_id, localPath, task.user_id);
        if (!syncResult.success) {
          console.warn(`[Queue] Bucket sync skipped for ${bucket.bucket_name}: ${syncResult.error} (continuing without bucket)`);
        }
        // Track for sync-back after task completes (only if not read-only)
        const isReadOnly = bucket.read_only === true || bucket.read_only === 1;
        if (!isReadOnly) {
          const existing = sessionBucketPaths.get(sandboxKey) || [];
          existing.push({ bucketId: bucket.bucket_id, localPath, userId: task.user_id });
          sessionBucketPaths.set(sandboxKey, existing);
        }
      }
    }
    
    // If this task is from a workflow, also mount workflow buckets
    if (task.source === 'workflow') {
      // Find the workflow from the node run linked to this task
      const nodeRun = await queryOne<{ workflow_run_id: string }>(
        'SELECT workflow_run_id FROM workflow_node_runs WHERE task_id = $1',
        [task.id]
      );

      if (nodeRun) {
        const workflowRun = await queryOne<{ workflow_id: string }>(
          'SELECT workflow_id FROM workflow_runs WHERE id = $1',
          [nodeRun.workflow_run_id]
        );
        
        if (workflowRun) {
          // Get workflow buckets
          const workflowBuckets = await query<{
            bucket_id: string;
            mount_path: string;
            read_only: number | boolean;
            bucket_name: string;
          }>(
            `SELECT wb.bucket_id, wb.mount_path, wb.read_only, b.name as bucket_name
             FROM workflow_buckets wb
             JOIN buckets b ON b.id = wb.bucket_id
             WHERE wb.workflow_id = $1`,
            [workflowRun.workflow_id]
          );
          
          if (workflowBuckets.length > 0) {
            console.log(`[Queue] Mounting ${workflowBuckets.length} workflow bucket(s) for task ${task.id}`);
            
            for (const bucket of workflowBuckets) {
              // Resolve base path
              let basePath = bucket.mount_path;
              if (!basePath.startsWith('/home/')) {
                basePath = `/home/user${basePath.startsWith('/') ? '' : '/'}${basePath}`;
              }
              
              // Mount to a subdirectory named after the bucket
              const localPath = `${basePath}/${bucket.bucket_name}`;
              
              const syncResult = await syncBucketWithRclone(sandboxKey, bucket.bucket_id, localPath, task.user_id);
              if (!syncResult.success) {
                console.error(`[Queue] Failed to sync workflow bucket ${bucket.bucket_name}: ${syncResult.error}`);
                // Don't fail the task, just log the error - workflow can continue without files
              } else {
                console.log(`[Queue] Mounted workflow bucket ${bucket.bucket_name} to ${localPath}`);
                // Track for sync-back after task completes (only if not read-only)
                const isReadOnly = bucket.read_only === true || bucket.read_only === 1;
                if (!isReadOnly) {
                  const existing = sessionBucketPaths.get(sandboxKey) || [];
                  existing.push({ bucketId: bucket.bucket_id, localPath, userId: task.user_id });
                  sessionBucketPaths.set(sandboxKey, existing);
                }
              }
            }
          }
        }
      }
    }
    
    // Build all API keys for OpenCode multi-provider support
    const allApiKeys: Record<string, string> = {};
    const API_KEY_ENV_VARS = [
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'GOOGLE_API_KEY',
      'GROQ_API_KEY',
      'MISTRAL_API_KEY',
      'DEEPSEEK_API_KEY',
      'TOGETHER_API_KEY',
      'HUGGINGFACE_API_KEY',
      'XAI_API_KEY',
    ];
    
    for (const envKey of API_KEY_ENV_VARS) {
      if (process.env[envKey]) {
        allApiKeys[envKey] = process.env[envKey]!;
      }
    }
    
    // Determine primary API key based on model provider
    let apiKey: string;
    const modelProvider = session.agent_model?.split('/')[0]?.toLowerCase();
    
    if (provider === 'aider') {
      apiKey = process.env.OPENAI_API_KEY!;
    } else if (modelProvider === 'huggingface') {
      apiKey = process.env.HUGGINGFACE_API_KEY || process.env.ANTHROPIC_API_KEY!;
    } else if (modelProvider === 'openai') {
      apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY!;
    } else if (modelProvider === 'google') {
      apiKey = process.env.GOOGLE_API_KEY || process.env.ANTHROPIC_API_KEY!;
    } else if (modelProvider === 'groq') {
      apiKey = process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY!;
    } else if (modelProvider === 'together') {
      apiKey = process.env.TOGETHER_API_KEY || process.env.ANTHROPIC_API_KEY!;
    } else if (modelProvider === 'deepseek') {
      apiKey = process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_API_KEY!;
    } else {
      apiKey = process.env.ANTHROPIC_API_KEY!;
    }
    
    console.log(`[Queue] Model: ${session.agent_model}, Provider: ${modelProvider}, API keys available: ${Object.keys(allApiKeys).join(', ')}`);
    
    // Fetch conversation history for multi-turn context
    // Fetch last 10 conversation turns for multi-turn context (limit to avoid prompt bloat)
    console.log(`[Queue] Fetching conversation history for session ${session.id}, excluding task ${task.id}`);
    const conversationHistory = await query<{ prompt: string; result: string }>(
      `SELECT prompt, result FROM task_queue
       WHERE agent_id = $1 AND id != $2 AND status = 'completed' AND result IS NOT NULL
       ORDER BY created_at DESC LIMIT 10`,
      [session.id, task.id]
    );
    conversationHistory.reverse(); // Oldest first
    console.log(`[Queue] Found ${conversationHistory.length} previous messages for session ${session.id}`);

    // Build the full prompt with system prompt + history if configured
    // Note: Skill files are loaded natively by oc.ts into CLAUDE.md
    let fullPrompt = '';
    if (config?.system_prompt) {
      fullPrompt += `[System Instructions]\n${config.system_prompt}\n\n`;
    }
    if (conversationHistory.length > 0) {
      fullPrompt += `[Previous Conversation]\n`;
      for (const msg of conversationHistory) {
        const result = msg.result.length > 2000
          ? msg.result.slice(0, 2000) + '\n... (truncated)'
          : msg.result;
        fullPrompt += `User: ${msg.prompt}\nAssistant: ${result}\n\n`;
      }
      fullPrompt += `[Current Request]\n`;
      console.log(`[Queue] Including ${conversationHistory.length} previous messages for agent ${session.id}`);
    }
    fullPrompt += task.prompt;
    
    // Add structured output instructions if output_schema is defined
    if (config?.output_schema) {
      try {
        const schema = JSON.parse(config.output_schema);
        const schemaStr = JSON.stringify(schema, null, 2);
        const structuredOutputInstructions = `

[IMPORTANT: Structured Output Required]
When you have completed this task, you MUST provide your final response as valid JSON that matches this schema:

\`\`\`json
${schemaStr}
\`\`\`

Your final response should be ONLY the JSON object, wrapped in a code block marked with \`\`\`json.
Do not include any text before or after the JSON code block in your final response.
`;
        fullPrompt = fullPrompt + structuredOutputInstructions;
        console.log(`[Queue] Added structured output instructions for agent ${session.id}`);
      } catch (e) {
        console.error(`[Queue] Failed to parse output_schema for agent ${session.id}:`, e);
      }
    }
    
    // Parse agent secrets for environment variables
    let customSecrets: Record<string, string> | undefined;
    if (config?.secrets) {
      try {
        customSecrets = JSON.parse(config.secrets);
        if (Object.keys(customSecrets || {}).length > 0) {
          console.log(`[Queue] Including ${Object.keys(customSecrets!).length} custom secrets for agent ${session.id}`);
        }
      } catch (e) {
        console.error(`[Queue] Failed to parse secrets for agent ${session.id}:`, e);
      }
    }
    
    // Add GitHub App token to custom secrets if user has GitHub App installed
    // This enables gh CLI and GitHub API access for all agents
    const githubAppToken = await getGitHubTokenForUser(task.user_id, session.repo_url || undefined);
    if (githubAppToken) {
      customSecrets = customSecrets || {};
      customSecrets['GITHUB_TOKEN'] = githubAppToken.token;
      customSecrets['GH_TOKEN'] = githubAppToken.token; // gh CLI uses this
      console.log(`[Queue] Including GitHub App token for agent ${session.id}`);
    }
    
    // Build extended thinking config from agent settings
    const extendedThinking = config?.enable_extended_thinking
      ? { enabled: true, budgetTokens: config.thinking_budget_tokens || 100000 }
      : undefined;
    
    // Bridge terminal events to SDK WebSocket for real-time streaming
    const { terminalEvents } = await import('../services/oc.js');
    const terminalKey = `terminal:${sandboxKey}`;
    const onTerminalEvent = (event: any) => {
      if (!hasTaskSubscribers(task.id)) return;
      if (event.type === 'stdout' && event.data) {
        sendTaskStdout(task.id, event.data);
      } else if (event.type === 'stderr' && event.data) {
        sendTaskStderr(task.id, event.data);
      } else if (event.type === 'tool_start') {
        sendTaskToolStart(task.id, event.toolName || event.data, event.input);
      } else if (event.type === 'tool_end') {
        sendTaskToolEnd(task.id, event.toolName || event.data, undefined, event.duration);
      }
    };
    terminalEvents.on(terminalKey, onTerminalEvent);

    // Run the agent command
    let result;
    try {
      result = await ocService.runAgentCommand(
        sandboxKey,
        provider as ModelProvider,
        fullPrompt,
        apiKey,
        session.agent_model,
        allApiKeys, // Pass all API keys for OpenCode
        customSecrets, // Pass per-agent custom secrets
        undefined, // system prompt (already configured)
        extendedThinking // Extended thinking configuration
      );
    } finally {
      terminalEvents.off(terminalKey, onTerminalEvent);
    }
    
    // Get existing metadata (may contain Slack callback URL)
    const existingTask = await queryOne<{ debug_log: string }>(
      'SELECT debug_log FROM task_queue WHERE id = $1',
      [task.id]
    );
    
    let slackMetadata: { slack_response_url?: string; channel_id?: string; user_name?: string } | null = null;
    if (existingTask?.debug_log) {
      try {
        slackMetadata = JSON.parse(existingTask.debug_log);
      } catch {
        // Not JSON, ignore
      }
    }
    
    // Serialize debug log for storage, merging with existing metadata
    const debugLogJson = result.debugLog 
      ? JSON.stringify({ ...slackMetadata, agentDebug: result.debugLog }) 
      : existingTask?.debug_log || null;
    
    // Check for cancellation after execution
    if (await isTaskCancelled(task.id)) {
      console.log(`[Queue] Task ${task.id} was cancelled during execution`);
      await execute(
        "UPDATE task_queue SET status = 'cancelled', completed_at = NOW() WHERE id = $1",
        [task.id]
      );
      sendTaskCancelled(task.id);
      return;
    }
    
    // Extract structured output if output_schema was defined
    let structuredOutput: any = undefined;
    if (config?.output_schema && result.stdout) {
      try {
        // Look for JSON in code blocks or as the entire response
        const jsonBlockMatch = result.stdout.match(/```json\s*([\s\S]*?)\s*```/);
        const jsonStr = jsonBlockMatch ? jsonBlockMatch[1] : result.stdout;
        
        // Try to parse as JSON
        const parsed = JSON.parse(jsonStr.trim());
        structuredOutput = parsed;
        console.log(`[Queue] Extracted structured output for task ${task.id}`);
      } catch (e) {
        console.log(`[Queue] Could not parse structured output from response for task ${task.id}`);
        // Don't fail the task, just don't set structured output
      }
    }
    
    // Update task with result and debug log
    await execute(
      "UPDATE task_queue SET status = 'completed', result = $1, debug_log = $2, structured_output = $3, completed_at = NOW() WHERE id = $4",
      [result.stdout || 'Task completed', debugLogJson, structuredOutput ? JSON.stringify(structuredOutput) : null, task.id]
    );
    
    // Notify WebSocket subscribers
    sendTaskCompleted(task.id, result.stdout, structuredOutput);
    
    // Post result back to Slack if callback URL exists
    if (slackMetadata?.slack_response_url) {
      try {
        const truncatedResult = (result.stdout || 'Task completed').slice(0, 2500);
        await fetch(slackMetadata.slack_response_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            response_type: 'in_channel',
            text: `✅ *Task Completed*`,
            attachments: [{
              color: '#36a64f',
              text: `\`\`\`${truncatedResult}${result.stdout && result.stdout.length > 2500 ? '\n...(truncated)' : ''}\`\`\``,
              footer: `Task ID: ${task.id.slice(0, 8)}`,
            }],
          }),
        });
        console.log(`[Queue] Posted result to Slack for task ${task.id}`);
      } catch (slackErr) {
        console.error(`[Queue] Slack callback failed for task ${task.id}:`, slackErr);
      }
    }
    
    // Call webhook if configured
    if (config?.webhook_url) {
      try {
        await fetch(config.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task_id: task.id,
            agent_id: task.agent_id,
            status: 'completed',
            result: result.stdout,
          }),
        });
      } catch (webhookErr) {
        console.error(`[Queue] Webhook failed for task ${task.id}:`, webhookErr);
      }
    }
    
    // Handle chaining - trigger next agent on success
    if (config?.chain_to_agent_id && 
        (config.chain_condition === 'on_success' || config.chain_condition === 'always')) {
      await triggerChainedAgent(config.chain_to_agent_id, task, result.stdout || '', 'success');
    }
    
    // Sync files back to cloud storage after task completes and update the files DB index
    const bucketPaths = sessionBucketPaths.get(sandboxKey);
    if (bucketPaths && bucketPaths.length > 0) {
      console.log(`[Queue] Syncing ${bucketPaths.length} bucket(s) back to cloud storage...`);
      for (const bp of bucketPaths) {
        try {
          const syncBackResult = await syncBucketBackWithRclone(sandboxKey, bp.bucketId, bp.localPath, bp.userId);
          if (syncBackResult.success) {
            console.log(`[Queue] Synced back ${syncBackResult.filesUploaded || 0} file(s) from ${bp.localPath}`);
            // Update DB index so Files UI reflects changes made by the agent
            try {
              const indexResult = await indexBucketFromSandboxDir({
                sandboxSessionId: sandboxKey,
                bucketId: bp.bucketId,
                ownerUserId: bp.userId,
                localPath: bp.localPath,
              });
              console.log(`[Queue] Indexed ${indexResult.filesIndexed} files for bucket ${bp.bucketId}`);
            } catch (indexErr) {
              console.error(`[Queue] Index error for bucket ${bp.bucketId}:`, indexErr);
            }
          } else {
            console.error(`[Queue] Failed to sync back bucket ${bp.bucketId}: ${syncBackResult.error}`);
          }
        } catch (syncErr) {
          console.error(`[Queue] Sync-back error for bucket ${bp.bucketId}:`, syncErr);
        }
      }
      // Clear the tracked paths for this sandbox key
      sessionBucketPaths.delete(sandboxKey);
    }
    
    console.log(`[Queue] Task ${task.id} completed`);
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Queue] Task ${task.id} failed:`, errorMsg);
    
    // Check if this was a cancellation
    if (await isTaskCancelled(task.id)) {
      console.log(`[Queue] Task ${task.id} was cancelled`);
      await execute(
        "UPDATE task_queue SET status = 'cancelled', completed_at = NOW() WHERE id = $1",
        [task.id]
      );
      sendTaskCancelled(task.id);
      return;
    }
    
    // Get existing metadata (may contain Slack callback URL)
    const existingTask = await queryOne<{ debug_log: string }>(
      'SELECT debug_log FROM task_queue WHERE id = $1',
      [task.id]
    );
    
    let slackMetadata: { slack_response_url?: string; channel_id?: string; user_name?: string } | null = null;
    if (existingTask?.debug_log) {
      try {
        slackMetadata = JSON.parse(existingTask.debug_log);
      } catch {
        // Not JSON, ignore
      }
    }
    
    await execute(
      "UPDATE task_queue SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2",
      [errorMsg, task.id]
    );
    
    // Notify WebSocket subscribers
    sendTaskFailed(task.id, errorMsg);
    
    // Post failure back to Slack if callback URL exists
    if (slackMetadata?.slack_response_url) {
      try {
        await fetch(slackMetadata.slack_response_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            response_type: 'in_channel',
            text: `❌ *Task Failed*`,
            attachments: [{
              color: '#dc3545',
              text: `\`\`\`${errorMsg.slice(0, 1000)}\`\`\``,
              footer: `Task ID: ${task.id.slice(0, 8)}`,
            }],
          }),
        });
        console.log(`[Queue] Posted failure to Slack for task ${task.id}`);
      } catch (slackErr) {
        console.error(`[Queue] Slack callback failed for task ${task.id}:`, slackErr);
      }
    }
    
    // Handle chaining - trigger next agent on failure if configured
    const config = await queryOne<AgentConfig>(
      'SELECT * FROM agent_configs WHERE session_id = $1',
      [task.agent_id]
    );
    
    if (config?.chain_to_agent_id && 
        (config.chain_condition === 'on_failure' || config.chain_condition === 'always')) {
      await triggerChainedAgent(config.chain_to_agent_id, task, errorMsg, 'failure');
    }
  }
}

// Trigger a chained agent with context from the previous task
async function triggerChainedAgent(
  nextAgentId: string, 
  previousTask: QueuedTask, 
  resultOrError: string,
  status: 'success' | 'failure'
): Promise<void> {
  console.log(`[Queue] Chaining to agent ${nextAgentId} after ${status}`);
  
  const chainPrompt = status === 'success'
    ? `[Chained from previous agent]\n\nPrevious task: ${previousTask.prompt}\n\nPrevious result:\n${resultOrError}\n\nContinue the work based on the above context.`
    : `[Chained from previous agent - FAILED]\n\nPrevious task: ${previousTask.prompt}\n\nError:\n${resultOrError}\n\nHandle or recover from the above error.`;
  
  const newTaskId = uuidv4();
  
  await execute(
    `INSERT INTO task_queue (id, agent_id, user_id, prompt, priority, source) 
     VALUES ($1, $2, $3, $4, $5, 'chain')`,
    [newTaskId, nextAgentId, previousTask.user_id, chainPrompt, previousTask.priority + 1]
  );
  
  console.log(`[Queue] Chained task ${newTaskId} created for agent ${nextAgentId}`);
}

/**
 * Get the sandbox key for a task.
 * This determines which sandbox the task will run in.
 */
function getTaskSandboxKey(task: QueuedTask): string {
  if (task.sdk_session_id) {
    return getSandboxKey({ 
      agentId: task.agent_id, 
      surface: 'sdk', 
      sdkSessionId: task.sdk_session_id 
    });
  }
  // Default shared sandbox for backward compatibility
  return task.agent_id;
}

// Process pending tasks for a specific sandbox key
async function processSandboxQueue(sandboxKey: string, task: QueuedTask): Promise<void> {
  if (processingSandboxes.has(sandboxKey)) {
    return; // Already processing this sandbox
  }
  
  processingSandboxes.add(sandboxKey);
  
  try {
    await processTask(task);
  } finally {
    processingSandboxes.delete(sandboxKey);
  }
}

// Main queue worker loop
export function startQueueWorker(intervalMs: number = 5000): NodeJS.Timeout {
  console.log(`[Queue] Worker started, polling every ${intervalMs}ms`);
  
  const interval = setInterval(async () => {
    try {
      // Get all pending tasks, ordered by priority and creation time
      const pendingTasks = await query<QueuedTask>(
        "SELECT * FROM task_queue WHERE status = 'pending' ORDER BY priority DESC, created_at ASC",
        []
      );
      
      // Group tasks by sandbox key, taking only the first task per sandbox
      const tasksToProcess: QueuedTask[] = [];
      const seenSandboxKeys = new Set<string>();
      
      for (const task of pendingTasks) {
        const sandboxKey = getTaskSandboxKey(task);
        
        // Skip if we're already processing this sandbox or already picked a task for it
        if (processingSandboxes.has(sandboxKey) || seenSandboxKeys.has(sandboxKey)) {
          continue;
        }
        
        seenSandboxKeys.add(sandboxKey);
        tasksToProcess.push(task);
      }
      
      // Process each sandbox's task in parallel
      // Different SDK sessions can now run concurrently for the same agent
      await Promise.all(
        tasksToProcess.map((task) => {
          const sandboxKey = getTaskSandboxKey(task);
          return processSandboxQueue(sandboxKey, task);
        })
      );
    } catch (error) {
      console.error('[Queue] Worker error:', error);
    }
  }, intervalMs);
  
  return interval;
}
