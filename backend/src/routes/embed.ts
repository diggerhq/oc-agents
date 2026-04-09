/**
 * Embed Routes
 * 
 * Public-facing embed widget for agent interactions.
 * Supports JWT authentication for secure user context passing.
 * 
 * VM-backed version: Uses E2B sandboxes for full agent capabilities.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { query, queryOne, execute } from '../db/index.js';
import { ocService, terminalEvents } from '../services/oc.js';
import { getBuiltinSkills } from '../config/skills.js';
import { getS3MountConfig } from '../services/storage.js';
import { logEvent } from '../services/analytics.js';
import { syncAgentBucketsBackAndIndex } from '../services/attachedFilesSync.js';

const router = Router();

// Types
interface EmbedUser {
  id: string;
  agent_id: string;
  user_identifier: string;
  user_context: string | null;
  created_at: string;
}

interface EmbedThread {
  id: string;
  embed_user_id: string;
  agent_id: string;
  title: string;
  active_skills: string | null;
  created_at: string;
  updated_at: string;
}

interface EmbedMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

interface AgentConfig {
  id: string;
  session_id: string;
  name: string | null;
  system_prompt: string | null;
  skills: string | null;
  mcp_servers: string | null;
  secrets: string | null;
  portal_jwt_secret: string | null;
  embed_greeting: string | null;
  embed_theme: string | null;
  embed_allowed_domains: string | null;
  embed_user_fields: string | null;
}

interface Session {
  id: string;
  user_id: string;
  status: string;
  agent_provider: string;
  agent_model: string | null;
  repo_url: string | null;
  branch: string | null;
}

interface User {
  id: string;
  github_access_token: string | null;
}

// Verify JWT token
function verifyToken(token: string, secret: string): Record<string, unknown> | null {
  try {
    return jwt.verify(token, secret) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ============================================
// EMBED CONFIGURATION
// ============================================

// Get embed config (public endpoint)
router.get('/:agentId/config', async (req: Request, res: Response) => {
  const { agentId } = req.params;
  
  const session = await queryOne<Session>(
    'SELECT id FROM sessions WHERE id = $1',
    [agentId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [agentId]
  );
  
  // Parse enabled skills
  const enabledSkillIds: string[] = config?.skills ? JSON.parse(config.skills) : [];
  const availableSkills = getBuiltinSkills()
    .filter(s => enabledSkillIds.includes(s.id))
    .map(s => ({ id: s.id, name: s.name, description: s.description, icon: s.icon }));
  
  // Parse theme
  let theme = null;
  if (config?.embed_theme) {
    try {
      theme = JSON.parse(config.embed_theme);
    } catch { /* ignore */ }
  }
  
  // Parse user fields
  let userFields: string[] = [];
  if (config?.embed_user_fields) {
    try {
      userFields = JSON.parse(config.embed_user_fields);
    } catch { /* ignore */ }
  }
  
  res.json({
    config: {
      name: config?.name || 'AI Assistant',
      greeting: config?.embed_greeting || 'Hi! How can I help you today?',
      availableSkills,
      theme,
      userFields,
    },
  });
});

// ============================================
// EMBED SESSIONS (user + threads)
// ============================================

// Create or get embed session (user + initial thread)
router.post('/:agentId/sessions', async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const { userIdentifier, userContext, token } = req.body;
  
  // Verify agent exists
  const session = await queryOne<Session>(
    'SELECT id FROM sessions WHERE id = $1',
    [agentId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const config = await queryOne<AgentConfig>(
    'SELECT portal_jwt_secret FROM agent_configs WHERE session_id = $1',
    [agentId]
  );
  
  // Resolve user context from JWT if provided
  let resolvedUserContext = userContext;
  let resolvedIdentifier = userIdentifier;
  
  if (token && config?.portal_jwt_secret) {
    const decoded = verifyToken(token, config.portal_jwt_secret);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    resolvedUserContext = decoded;
    resolvedIdentifier = (decoded.user_id || decoded.email || decoded.sub || userIdentifier) as string;
  }
  
  if (!resolvedIdentifier) {
    // Generate anonymous identifier
    resolvedIdentifier = `anon_${uuidv4().slice(0, 8)}`;
  }
  
  // Check for existing user
  // Use INSERT ... ON CONFLICT to handle race conditions gracefully
  const userId = uuidv4();
  const userContextJson = resolvedUserContext ? JSON.stringify(resolvedUserContext) : null;
  
  // Insert or update user (idempotent) - handles concurrent requests
  await execute(
    `INSERT INTO embed_users (id, agent_id, user_identifier, user_context) 
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (agent_id, user_identifier) 
     DO UPDATE SET user_context = COALESCE(EXCLUDED.user_context, embed_users.user_context)
     WHERE embed_users.user_context IS DISTINCT FROM EXCLUDED.user_context OR EXCLUDED.user_context IS NOT NULL`,
    [userId, agentId, resolvedIdentifier, userContextJson]
  );
  
  // Get the user (either newly created or existing)
  const embedUser = await queryOne<EmbedUser>(
    'SELECT * FROM embed_users WHERE agent_id = $1 AND user_identifier = $2',
    [agentId, resolvedIdentifier]
  );
  
  if (!embedUser) {
    throw new Error('Failed to create or retrieve embed user');
  }
  
  // Check if user has threads
  let threads = await query<EmbedThread>(
    'SELECT * FROM embed_threads WHERE embed_user_id = $1 ORDER BY updated_at DESC',
    [embedUser.id]
  );
  
  let isNew = false;
  
  // Create initial thread if user has none
  if (threads.length === 0) {
    const threadId = uuidv4();
    await execute(
      'INSERT INTO embed_threads (id, embed_user_id, agent_id, title) VALUES ($1, $2, $3, $4)',
      [threadId, embedUser.id, agentId, 'New conversation']
    );
    
    threads = await query<EmbedThread>(
      'SELECT * FROM embed_threads WHERE embed_user_id = $1',
      [embedUser.id]
    );
    
    isNew = true;
    
    // Log session start event
    logEvent({
      agentId,
      eventType: 'session_start',
      source: 'embed',
      sessionId: embedUser.id,
      metadata: { userIdentifier: resolvedIdentifier },
    });
  }
  
  res.json({
    user: embedUser,
    threads,
    isNew,
  });
});

// ============================================
// HEALTH CHECK
// ============================================

// Check sandbox health for an embed user
router.get('/:agentId/users/:userId/health', async (req: Request, res: Response) => {
  const { agentId, userId } = req.params;
  
  // Verify user exists
  const user = await queryOne<EmbedUser>(
    'SELECT * FROM embed_users WHERE id = $1 AND agent_id = $2',
    [userId, agentId]
  );
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Check if sandbox exists and is healthy
  const embedSandboxId = `embed-${userId}`;
  const sandbox = await ocService.getSandbox(embedSandboxId);
  
  if (!sandbox) {
    return res.json({ 
      healthy: false, 
      status: 'no_sandbox',
      message: 'No active sandbox for this user'
    });
  }
  
  // Try a simple command to verify sandbox is responsive
  try {
    const result = await sandbox.exec.run('echo "health"', { timeout: 5 });
    if (result.exitCode === 0) {
      // Also extend timeout while we're here
      await ocService.keepAlive(embedSandboxId);
      return res.json({ 
        healthy: true, 
        status: 'running',
        message: 'Sandbox is healthy'
      });
    } else {
      return res.json({ 
        healthy: false, 
        status: 'unhealthy',
        message: 'Sandbox command failed'
      });
    }
  } catch (error: any) {
    // Sandbox is dead
    ocService.clearSandbox(embedSandboxId);
    return res.json({ 
      healthy: false, 
      status: 'expired',
      message: 'Sandbox has expired'
    });
  }
});

// Warm up / recreate sandbox for an embed user (includes full context setup)
router.post('/:agentId/users/:userId/warmup', async (req: Request, res: Response) => {
  const { agentId, userId } = req.params;
  
  console.log(`[Embed] Warmup request: agentId=${agentId}, userId=${userId}`);
  
  try {
    // Verify user exists
    const embedUser = await queryOne<EmbedUser>(
      'SELECT * FROM embed_users WHERE id = $1 AND agent_id = $2',
      [userId, agentId]
    );
    
    if (!embedUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get agent config - note: agentId is the session_id, not the agent_config id
    const config = await queryOne<AgentConfig>(
      'SELECT * FROM agent_configs WHERE session_id = $1',
      [agentId]
    );
    
    if (!config) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Get session info for provider
    // agentId IS the session id
    const agentSession = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1',
      [agentId]
    );
    
    if (!agentSession) {
      return res.status(404).json({ error: 'Agent session not found' });
    }
    
    // Get owner user for GitHub token (needed for repo cloning)
    const ownerUser = await queryOne<User>(
      'SELECT * FROM users WHERE id = $1',
      [agentSession.user_id]
    );
    
    const embedSandboxId = `embed-${userId}`;
    
    // Check if sandbox already exists and is healthy
    let sandbox = await ocService.getSandbox(embedSandboxId);
    
    if (sandbox) {
      try {
        const result = await sandbox.exec.run('echo "health"', { timeout: 5 });
        if (result.exitCode === 0) {
          await ocService.keepAlive(embedSandboxId);
          return res.json({ success: true, status: 'already_running' });
        }
      } catch {
        // Sandbox is dead, clear it
        await ocService.clearSandbox(embedSandboxId);
      }
    }
    
    // Create new sandbox
    console.log(`[Embed] Creating sandbox for warmup: ${embedSandboxId}`);
    await ocService.createSandbox(
      embedSandboxId,
      agentSession.agent_provider as 'claude-code' | 'aider' | 'opencode'
    );
    
    // Install tools
    console.log(`[Embed] Installing tools for warmup: ${embedSandboxId}`);
    await ocService.installAgentTools(
      embedSandboxId,
      agentSession.agent_provider as 'claude-code' | 'aider' | 'opencode'
    );
    
    // Sync buckets attached to this agent
    const agentBuckets = await query<{ bucket_id: string; bucket_name: string; mount_path: string }>(
      `SELECT ab.bucket_id, b.name as bucket_name, ab.mount_path 
       FROM agent_buckets ab 
       JOIN buckets b ON ab.bucket_id = b.id 
       WHERE ab.session_id = $1`,
      [agentId]
    );
    
    if (agentBuckets.length > 0) {
      const storageConfig = await getS3MountConfig(agentSession.user_id);
      
      if (storageConfig) {
        console.log(`[Embed] Syncing ${agentBuckets.length} buckets for warmup`);
        
        // Install rclone first
        const rcloneResult = await ocService.installRclone(embedSandboxId);
        if (rcloneResult.success) {
          // Sync each bucket
          for (const bucket of agentBuckets) {
            let basePath = bucket.mount_path;
            if (!basePath.startsWith('/home/')) {
              basePath = `/home/user${basePath.startsWith('/') ? '' : '/'}${basePath}`;
            }
            
            const localPath = `${basePath}/${bucket.bucket_name}`;
            const remotePath = `${agentSession.user_id}/${bucket.bucket_id}`;
            
            const syncResult = await ocService.syncWithRclone(embedSandboxId, {
              provider: storageConfig.provider,
              bucketName: storageConfig.bucketName,
              accessKeyId: storageConfig.accessKeyId,
              secretAccessKey: storageConfig.secretAccessKey,
              endpoint: storageConfig.endpoint,
              region: storageConfig.region,
              remotePath,
              localPath,
            });
            
            if (syncResult.success) {
              console.log(`[Embed] Synced bucket "${bucket.bucket_name}" to ${localPath}`);
            }
          }
        }
      }
    }
    
    // Clone repo if configured
    if (agentSession.repo_url && ownerUser?.github_access_token) {
      console.log(`[Embed] Cloning repo for warmup: ${agentSession.repo_url}`);
      await ocService.cloneRepo(
        embedSandboxId,
        agentSession.repo_url,
        agentSession.branch || 'main',
        ownerUser.github_access_token
      );
    }
    
    // Parse custom secrets from agent config
    const customSecrets: Record<string, string> = config?.secrets ? JSON.parse(config.secrets) : {};

    // Configure Claude Code with system prompt, MCP servers, and knowledge bases
    if (agentSession.agent_provider === 'claude-code') {
      const mcpServers = config?.mcp_servers 
        ? JSON.parse(config.mcp_servers).filter((s: any) => s.type === 'custom')
        : [];
      
      // Check if agent has knowledge bases attached
      const kbAttachments = await query<{ id: string }>(
        'SELECT id FROM agent_knowledge_bases WHERE session_id = $1 LIMIT 1',
        [agentId]
      );
      const hasKnowledgeBases = kbAttachments.length > 0;
      
      console.log(`[Embed] Configuring Claude settings for warmup (MCP: ${mcpServers.length}, KB: ${hasKnowledgeBases})`);
      await ocService.configureClaudeSettings(embedSandboxId, {
        systemPrompt: config?.system_prompt,
        mcpServers: mcpServers.map((s: any) => ({
          id: s.id,
          name: s.name,
          transport: s.transport,
          url: s.url,
          headers: s.headers,
        })),
        secrets: customSecrets,
        agentId,
        hasKnowledgeBases,
      });
    }
    
    console.log(`[Embed] Warmup complete for ${embedSandboxId}`);
    res.json({ success: true, status: 'created' });
    
  } catch (error: any) {
    console.error('[Embed] Warmup error:', error);
    res.status(500).json({ error: 'Failed to warm up sandbox', details: error.message });
  }
});

// ============================================
// THREADS
// ============================================

// List threads
router.get('/:agentId/users/:userId/threads', async (req: Request, res: Response) => {
  const { userId } = req.params;
  
  const threads = await query<EmbedThread>(
    'SELECT * FROM embed_threads WHERE embed_user_id = $1 ORDER BY updated_at DESC',
    [userId]
  );
  
  res.json({ threads });
});

// Create thread
router.post('/:agentId/users/:userId/threads', async (req: Request, res: Response) => {
  const { agentId, userId } = req.params;
  const { title } = req.body;
  
  // Verify user exists
  const user = await queryOne<EmbedUser>(
    'SELECT * FROM embed_users WHERE id = $1 AND agent_id = $2',
    [userId, agentId]
  );
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const threadId = uuidv4();
  await execute(
    'INSERT INTO embed_threads (id, embed_user_id, agent_id, title) VALUES ($1, $2, $3, $4)',
    [threadId, userId, agentId, title || 'New conversation']
  );
  
  const thread = await queryOne<EmbedThread>(
    'SELECT * FROM embed_threads WHERE id = $1',
    [threadId]
  );
  
  res.status(201).json({ thread });
});

// Update thread
router.patch('/:agentId/users/:userId/threads/:threadId', async (req: Request, res: Response) => {
  const { userId, threadId } = req.params;
  const { title, activeSkills } = req.body;
  
  const thread = await queryOne<EmbedThread>(
    'SELECT * FROM embed_threads WHERE id = $1 AND embed_user_id = $2',
    [threadId, userId]
  );
  
  if (!thread) {
    return res.status(404).json({ error: 'Thread not found' });
  }
  
  const updates: string[] = [];
  const values: unknown[] = [];
  const setValue = (column: string, value: unknown) => {
    values.push(value);
    updates.push(`${column} = $${values.length}`);
  };
  
  if (title !== undefined) {
    setValue('title', title);
  }
  if (activeSkills !== undefined) {
    setValue('active_skills', JSON.stringify(activeSkills));
  }
  
  if (updates.length > 0) {
    updates.push('updated_at = NOW()');
    values.push(threadId);
    
    await execute(`UPDATE embed_threads SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
  }
  
  res.json({ success: true });
});

// Delete thread
router.delete('/:agentId/users/:userId/threads/:threadId', async (req: Request, res: Response) => {
  const { userId, threadId } = req.params;
  
  const thread = await queryOne<EmbedThread>(
    'SELECT * FROM embed_threads WHERE id = $1 AND embed_user_id = $2',
    [threadId, userId]
  );
  
  if (!thread) {
    return res.status(404).json({ error: 'Thread not found' });
  }
  
  await execute('DELETE FROM embed_thread_messages WHERE thread_id = $1', [threadId]);
  await execute('DELETE FROM embed_threads WHERE id = $1', [threadId]);
  
  res.json({ success: true });
});

// ============================================
// MESSAGES
// ============================================

// Get messages
router.get('/:agentId/users/:userId/threads/:threadId/messages', async (req: Request, res: Response) => {
  const { threadId } = req.params;
  
  const messages = await query<EmbedMessage>(
    'SELECT * FROM embed_thread_messages WHERE thread_id = $1 ORDER BY created_at ASC',
    [threadId]
  );
  
  res.json({ messages });
});

// Send message and stream response (VM-backed)
router.post('/:agentId/users/:userId/threads/:threadId/stream', async (req: Request, res: Response) => {
  const { agentId, userId, threadId } = req.params;
  const { content } = req.body;
  
  if (!content) {
    return res.status(400).json({ error: 'content is required' });
  }
  
  // Verify thread exists
  const thread = await queryOne<EmbedThread>(
    'SELECT * FROM embed_threads WHERE id = $1 AND embed_user_id = $2',
    [threadId, userId]
  );
  
  if (!thread) {
    return res.status(404).json({ error: 'Thread not found' });
  }
  
  // Get user for context
  const embedUser = await queryOne<EmbedUser>(
    'SELECT * FROM embed_users WHERE id = $1',
    [userId]
  );
  
  // Get agent session and config
  const agentSession = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1',
    [agentId]
  );
  
  if (!agentSession) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [agentId]
  );
  
  // Get owner user for GitHub token
  const ownerUser = await queryOne<User>(
    'SELECT * FROM users WHERE id = $1',
    [agentSession.user_id]
  );
  
  // Get previous messages
  const previousMessages = await query<EmbedMessage>(
    'SELECT * FROM embed_thread_messages WHERE thread_id = $1 ORDER BY created_at ASC LIMIT 50',
    [threadId]
  );
  
  // Save user message
  const userMessageId = uuidv4();
  await execute(
    'INSERT INTO embed_thread_messages (id, thread_id, role, content) VALUES ($1, $2, $3, $4)',
    [userMessageId, threadId, 'user', content]
  );
  
  // Log message event
  logEvent({
    agentId,
    eventType: 'message',
    source: 'embed',
    sessionId: agentUser.id,
    threadId,
    metadata: { messageLength: content.length },
  });
  
  // Track timing for latency calculation
  const startTime = Date.now();
  
  // Update thread
  if (previousMessages.length === 0) {
    const title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
    await execute(
      'UPDATE embed_threads SET title = $1, updated_at = NOW() WHERE id = $2',
      [title, threadId]
    );
  } else {
    await execute(
      'UPDATE embed_threads SET updated_at = NOW() WHERE id = $1',
      [threadId]
    );
  }
  
  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  
  try {
    // Build conversation context
    let conversationContext = '';
    if (previousMessages.length > 0) {
      conversationContext = 'Previous conversation:\n';
      for (const msg of previousMessages.slice(-10)) {
        conversationContext += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
      }
      conversationContext += '\n';
    }
    
    // User context
    let userContextStr = '';
    if (embedUser?.user_context) {
      try {
        const ctx = JSON.parse(embedUser.user_context);
        userContextStr = `\nUser context: ${JSON.stringify(ctx)}\n`;
      } catch { /* ignore */ }
    }
    
    const fullPrompt = `${conversationContext}${userContextStr}User: ${content}`;
    
    // API keys
    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    const allApiKeys: Record<string, string> = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
    };
    
    const customSecrets: Record<string, string> = config?.secrets ? JSON.parse(config.secrets) : {};
    
    // Embed sandbox ID
    const embedSandboxId = `embed-${userId}`;
    
    // Track configured system prompt (enhanced with KB, MCP, secrets, skill files)
    let configuredSystemPrompt: string | undefined;
    
    // Check/create sandbox
    let sandbox = await ocService.getSandbox(embedSandboxId);
    
    if (!sandbox) {
      res.write(`data: ${JSON.stringify({ type: 'status', content: 'Starting agent environment...' })}\n\n`);
      
      await ocService.createSandbox(embedSandboxId, agentSession.agent_provider as 'claude-code' | 'aider' | 'opencode');
      
      res.write(`data: ${JSON.stringify({ type: 'status', content: 'Installing tools...' })}\n\n`);
      await ocService.installAgentTools(embedSandboxId, agentSession.agent_provider as 'claude-code' | 'aider' | 'opencode');
      
      // Sync buckets attached to this agent
      const agentBuckets = await query<{ bucket_id: string; bucket_name: string; mount_path: string }>(
        `SELECT ab.bucket_id, b.name as bucket_name, ab.mount_path 
         FROM agent_buckets ab 
         JOIN buckets b ON ab.bucket_id = b.id 
         WHERE ab.session_id = $1`,
        [agentId]
      );
      
      if (agentBuckets.length > 0) {
        // Get the agent owner's user ID for storage config
        const agentOwner = await queryOne<{ user_id: string }>(
          'SELECT user_id FROM sessions WHERE id = $1',
          [agentId]
        );
        
        if (agentOwner) {
          const storageConfig = await getS3MountConfig(agentOwner.user_id);
          
          if (storageConfig) {
            res.write(`data: ${JSON.stringify({ type: 'status', content: 'Syncing files...' })}\n\n`);
            
            // Install rclone first
            const rcloneResult = await ocService.installRclone(embedSandboxId);
            if (rcloneResult.success) {
              // Sync each bucket
              for (const bucket of agentBuckets) {
                let basePath = bucket.mount_path;
                if (!basePath.startsWith('/home/')) {
                  basePath = `/home/user${basePath.startsWith('/') ? '' : '/'}${basePath}`;
                }
                
                const localPath = `${basePath}/${bucket.bucket_name}`;
                const remotePath = `${agentOwner.user_id}/${bucket.bucket_id}`;
                
                const syncResult = await ocService.syncWithRclone(embedSandboxId, {
                  provider: storageConfig.provider,
                  bucketName: storageConfig.bucketName,
                  accessKeyId: storageConfig.accessKeyId,
                  secretAccessKey: storageConfig.secretAccessKey,
                  endpoint: storageConfig.endpoint,
                  region: storageConfig.region,
                  remotePath,
                  localPath,
                });
                
                if (syncResult.success) {
                  console.log(`[Embed] Synced bucket "${bucket.bucket_name}" to ${localPath}`);
                }
              }
            }
          }
        }
      }
      
      if (agentSession.repo_url && ownerUser?.github_access_token) {
        res.write(`data: ${JSON.stringify({ type: 'status', content: 'Cloning repository...' })}\n\n`);
        await ocService.cloneRepo(
          embedSandboxId,
          agentSession.repo_url,
          agentSession.branch || 'main',
          ownerUser.github_access_token
        );
      }

      // Configure Claude Code with system prompt, MCP servers, and knowledge bases
      if (agentSession.agent_provider === 'claude-code') {
        const mcpServers = config?.mcp_servers 
          ? JSON.parse(config.mcp_servers).filter((s: any) => s.type === 'custom')
          : [];
        
        // Check if agent has knowledge bases attached
        const kbAttachments = await query<{ id: string }>(
          'SELECT id FROM agent_knowledge_bases WHERE session_id = $1 LIMIT 1',
          [agentId]
        );
        const hasKnowledgeBases = kbAttachments.length > 0;
        
        // Always configure to detect skill files, even if no explicit config
        res.write(`data: ${JSON.stringify({ type: 'status', content: 'Configuring agent...' })}\n\n`);
        const configResult = await ocService.configureClaudeSettings(embedSandboxId, {
          systemPrompt: config?.system_prompt,
          mcpServers: mcpServers.map((s: any) => ({
            id: s.id,
            name: s.name,
            transport: s.transport,
            url: s.url,
            headers: s.headers,
          })),
          secrets: customSecrets,
          agentId,
          hasKnowledgeBases,
        });
        configuredSystemPrompt = configResult.systemPrompt;
      }
    } else {
      // Sandbox already exists - still need to get the system prompt for the agent command
      if (agentSession.agent_provider === 'claude-code') {
        console.log(`[Embed] Sandbox exists, fetching system prompt for ${embedSandboxId}`);
        const mcpServers = config?.mcp_servers 
          ? JSON.parse(config.mcp_servers).filter((s: any) => s.type === 'custom')
          : [];
        
        const kbAttachments = await query<{ id: string }>(
          'SELECT id FROM agent_knowledge_bases WHERE session_id = $1 LIMIT 1',
          [agentId]
        );
        const hasKnowledgeBases = kbAttachments.length > 0;
        
        const configResult = await ocService.configureClaudeSettings(embedSandboxId, {
          systemPrompt: config?.system_prompt,
          mcpServers: mcpServers.map((s: any) => ({
            id: s.id,
            name: s.name,
            transport: s.transport,
            url: s.url,
            headers: s.headers,
          })),
          secrets: customSecrets,
          agentId,
          hasKnowledgeBases,
        });
        configuredSystemPrompt = configResult.systemPrompt;
      }
    }
    
    res.write(`data: ${JSON.stringify({ type: 'status', content: 'Processing...' })}\n\n`);
    
    // Track streamed content for real-time display
    let lastStreamedText = '';
    let currentToolStatus = '';
    
    // Track active tools for the thinking panel
    const activeToolsList: Array<{ toolId: string; toolName: string; startTime: number }> = [];
    
    // Subscribe to terminal events for live streaming
    const eventHandler = (event: { 
      type: string; 
      data?: string; 
      timestamp?: number;
      toolId?: string;
      toolName?: string;
      duration?: number;
      detail?: string;
      isError?: boolean;
    }) => {
      try {
        // Handle enhanced event types from oc.ts
        if (event.type === 'tool_start') {
          // Tool started - add to active tools and emit thinking
          activeToolsList.push({ 
            toolId: event.toolId || '', 
            toolName: event.toolName || 'tool',
            startTime: event.timestamp || Date.now(),
            input: event.input // Store input for later
          });
          if (event.data && event.data !== currentToolStatus) {
            currentToolStatus = event.data;
            res.write(`data: ${JSON.stringify({ 
              type: 'thinking', 
              content: event.data,
              detail: event.detail,
              toolName: event.toolName,
              toolId: event.toolId,
              input: event.input // Include tool input for frontend exploration
            })}\n\n`);
          }
        } else if (event.type === 'tool_end') {
          // Tool completed - remove from active and optionally show result
          const idx = activeToolsList.findIndex(t => t.toolId === event.toolId);
          const toolInfo = idx >= 0 ? activeToolsList[idx] : null;
          if (idx >= 0) activeToolsList.splice(idx, 1);
          
          res.write(`data: ${JSON.stringify({ 
            type: 'tool_result', 
            content: event.data,
            toolName: event.toolName,
            toolId: event.toolId,
            duration: event.duration,
            isError: event.isError,
            input: event.input || toolInfo?.input, // Include tool input
            result: event.result // Include tool result for frontend exploration
          })}\n\n`);
          
          // Update current status to show remaining active tools or clear
          if (activeToolsList.length > 0) {
            const latest = activeToolsList.at(-1)!;
            currentToolStatus = `⚙️ ${latest.toolName}...`;
          } else {
            currentToolStatus = '';
          }
        } else if (event.type === 'mcp_tool_call') {
          // MCP tool called via gateway - emit as thinking event with MCP flag
          console.log(`[Embed] MCP tool call: ${event.toolName}`);
          res.write(`data: ${JSON.stringify({ 
            type: 'thinking', 
            content: `🔧 ${event.toolName}...`,
            toolName: event.toolName,
            toolId: `mcp-${Date.now()}`,
            detail: `Calling MCP tool: ${event.toolName}`,
            isMcp: true
          })}\n\n`);
        } else if (event.type === 'mcp_tool_complete') {
          // MCP tool completed
          console.log(`[Embed] MCP tool complete: ${event.toolName} (${event.duration}ms)`);
          res.write(`data: ${JSON.stringify({ 
            type: 'tool_result', 
            content: event.success ? `✓ ${event.toolName}` : `❌ ${event.toolName} failed`,
            toolName: event.toolName,
            toolId: `mcp-${Date.now()}`,
            duration: event.duration,
            isError: !event.success,
            isMcp: true
          })}\n\n`);
        } else if (event.type === 'thinking') {
          // Extended thinking from Claude (internal reasoning)
          res.write(`data: ${JSON.stringify({ 
            type: 'extended_thinking', 
            content: event.data 
          })}\n\n`);
        } else if (event.type === 'stdout' && event.data) {
          // Parse Claude Code's JSON stream output for text content
          for (const line of event.data.trim().split('\n')) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              
              // Handle stream_event wrapper format (newer Claude Code versions)
              if (json.type === 'stream_event' && json.event) {
                const evt = json.event;
                
                // Handle content_block_delta events (streaming text/thinking)
                if (evt.type === 'content_block_delta' && evt.delta) {
                  if (evt.delta.type === 'text_delta' && evt.delta.text) {
                    // Stream text content in real-time
                    res.write(`data: ${JSON.stringify({ type: 'text', content: evt.delta.text })}\n\n`);
                    lastStreamedText += evt.delta.text;
                  } else if (evt.delta.type === 'thinking_delta' && evt.delta.thinking) {
                    // Stream thinking content
                    res.write(`data: ${JSON.stringify({ type: 'extended_thinking', content: evt.delta.thinking })}\n\n`);
                  }
                }
                // Skip other stream events
                continue;
              }
              
              // Handle legacy assistant message format
              if (json.type === 'assistant' && json.message?.content) {
                for (const block of json.message.content) {
                  if (block.type === 'text' && block.text) {
                    // Only send new text (avoid duplicates)
                    if (!lastStreamedText.includes(block.text)) {
                      res.write(`data: ${JSON.stringify({ type: 'text', content: block.text })}\n\n`);
                      lastStreamedText += block.text;
                    }
                  }
                  // tool_use and thinking blocks are now handled via enhanced events above
                }
              }
            } catch {
              // Not JSON or parsing failed - ignore
            }
          }
        }
      } catch (err) {
        console.error('[Embed] Error in event handler:', err);
      }
    };
    
    // Subscribe to live events
    terminalEvents.on(`terminal:${embedSandboxId}`, eventHandler);
    
    let result;
    try {
      // Build extended thinking config from agent settings
      const extendedThinking = config?.enable_extended_thinking
        ? { enabled: true, budgetTokens: config.thinking_budget_tokens || 100000 }
        : undefined;
      
      // Run agent with enhanced system prompt (includes KB, MCP, secrets, skill files)
      result = await ocService.runAgentCommand(
        embedSandboxId,
        agentSession.agent_provider as 'claude-code' | 'aider' | 'opencode',
        fullPrompt,
        apiKey,
        agentSession.agent_model || undefined,
        allApiKeys,
        customSecrets,
        configuredSystemPrompt,  // Use enhanced system prompt with all features
        extendedThinking  // Pass extended thinking configuration
      );
    } finally {
      // Always unsubscribe
      terminalEvents.off(`terminal:${embedSandboxId}`, eventHandler);
    }
    
    // Get the final response content - prefer streamed text over raw stdout
    const rawOutput = result.stdout || '';
    
    // Use the streamed text if we have it, otherwise fall back to the result
    const responseContent = lastStreamedText || rawOutput || 'I apologize, but I encountered an issue processing your request.';
    
    // If we didn't stream any text (fallback for non-Claude providers), send it now
    if (!lastStreamedText && rawOutput) {
      const chunkSize = 50;
      for (let i = 0; i < rawOutput.length; i += chunkSize) {
        const chunk = rawOutput.slice(i, i + chunkSize);
        res.write(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    
    // Save assistant message - use the clean text content
    const assistantMessageId = uuidv4();
    await execute(
      'INSERT INTO embed_thread_messages (id, thread_id, role, content) VALUES ($1, $2, $3, $4)',
      [assistantMessageId, threadId, 'assistant', responseContent]
    );
    
    // Log response event with latency
    const latencyMs = Date.now() - startTime;
    logEvent({
      agentId,
      eventType: 'response',
      source: 'embed',
      sessionId: agentUser.id,
      threadId,
      latencyMs,
      success: true,
      metadata: { responseLength: responseContent.length },
    });
    
    res.write(`data: ${JSON.stringify({ type: 'done', messageId: assistantMessageId })}\n\n`);
    res.end();

    // Best-effort: sync any file-bucket changes back to storage and refresh DB index.
    // Do this after sending the response to avoid delaying the UI.
    (async () => {
      try {
        const agentOwner = await queryOne<{ user_id: string }>(
          'SELECT user_id FROM sessions WHERE id = $1',
          [agentId]
        );
        if (agentOwner?.user_id) {
          await syncAgentBucketsBackAndIndex({
            sandboxSessionId: embedSandboxId,
            agentId,
            ownerUserId: agentOwner.user_id,
          });
        }
      } catch (err) {
        console.error('[Embed] Post-response file sync failed:', err);
      }
    })();
    
  } catch (error) {
    console.error('[Embed] Stream error:', error);
    
    // Log error event
    logEvent({
      agentId,
      eventType: 'error',
      source: 'embed',
      sessionId: agentUser.id,
      threadId,
      latencyMs: Date.now() - startTime,
      success: false,
      errorMessage: String(error),
    });
    
    res.write(`data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`);
    res.end();
  }
});

export default router;
