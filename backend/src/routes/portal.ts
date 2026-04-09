/**
 * Portal Routes
 * 
 * Public-facing portal for agent interactions with threads support.
 * Supports JWT authentication for secure user context passing.
 * 
 * VM-backed version: Uses E2B sandboxes for full agent capabilities.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query, queryOne, execute } from '../db/index.js';
import { ocService, terminalEvents, verifyGatewaySignature } from '../services/oc.js';
import { getBuiltinSkills } from '../config/skills.js';
import { getS3MountConfig } from '../services/storage.js';
import { logEvent } from '../services/analytics.js';
import { syncAgentBucketsBackAndIndex } from '../services/attachedFilesSync.js';
import { handlePortalAgentStream, buildPortalAgentConfig } from '../services/portalAgent.js';

const router = Router();

// Store for active SSE connections (sessionId -> Response[])
const activePortalStreams = new Map<string, Response[]>();

// Generate a secure random secret for JWT signing
function generateJwtSecret(): string {
  return crypto.randomBytes(32).toString('base64');
}

// Verify JWT token and extract user context
function verifyPortalToken(token: string, secret: string): Record<string, unknown> | null {
  try {
    const decoded = jwt.verify(token, secret) as Record<string, unknown>;
    return decoded;
  } catch (error) {
    console.error('[Portal] JWT verification failed:', error);
    return null;
  }
}

// Types
interface PortalSession {
  id: string;
  agent_id: string;
  visitor_id: string | null;
  user_context: string | null;
  active_skills: string | null;
  sandbox_id: string | null;
  created_at: string;
  updated_at: string;
}

interface PortalThread {
  id: string;
  portal_session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface PortalMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking_content?: string;
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
  portal_logo_url: string | null;
  portal_name: string | null;
  portal_custom_css: string | null;
  portal_greeting: string | null;
  portal_suggested_questions: string[] | null;
  created_at?: string;
  updated_at?: string;
}

interface Session {
  id: string;
  user_id: string;
  status: string;
  agent_provider: string;
  agent_type?: 'code' | 'task' | 'portal' | 'portal-sandbox';
  agent_model?: string | null;
  organization_id?: string | null;
  repo_url: string | null;
  branch: string | null;
}

interface User {
  id: string;
  github_access_token: string | null;
}

// ============================================
// PORTAL CONFIGURATION
// ============================================

// Get portal config (public endpoint)
router.get('/:agentId/config', async (req: Request, res: Response) => {
  const { agentId } = req.params;
  
  // Get agent and config
  const session = await queryOne<Session>(
    'SELECT id, user_id, status FROM sessions WHERE id = $1',
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
  
  // Get skill details for enabled builtin skills + custom MCP servers
  const availableSkills: Array<{id: string; name: string; description: string; icon: string; category: string}> = [];
  
  // Add enabled builtin skills
  for (const skill of getBuiltinSkills()) {
    if (enabledSkillIds.includes(skill.id)) {
      availableSkills.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        icon: skill.icon,
        category: skill.category,
      });
    }
  }
  
  // Add custom MCP servers as skills
  if (config?.mcp_servers) {
    try {
      const mcpServers = JSON.parse(config.mcp_servers);
      for (const server of mcpServers) {
        availableSkills.push({
          id: server.id,
          name: server.name,
          description: `Custom MCP server`,
          icon: 'globe',
          category: 'custom',
        });
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
  
  // Parse theme
  let theme = null;
  if (config?.embed_theme) {
    try {
      theme = JSON.parse(config.embed_theme);
    } catch {
      // Ignore
    }
  }
  
  // Build logo URL if logo is set
  const logoVersion = config?.updated_at ? encodeURIComponent(config.updated_at) : `${Date.now()}`;
  const logoUrl = config?.portal_logo_url
    ? `/api/agents/${agentId}/config/logo/image?v=${logoVersion}`
    : null;
  
  // Parse portal active skills
  let portalActiveSkills = null;
  if (config?.portal_active_skills) {
    try {
      portalActiveSkills = typeof config.portal_active_skills === 'string' 
        ? JSON.parse(config.portal_active_skills) 
        : config.portal_active_skills;
    } catch {
      // Ignore parse errors
    }
  }
  
  res.json({
    config: {
      name: config?.portal_name || config?.name || 'AI Assistant',
      portalName: config?.portal_name || null,
      agentName: config?.name || 'AI Assistant',
      greeting: config?.embed_greeting || `Hi! How can I help you today?`,
      portalGreeting: config?.portal_greeting || null,
      suggestedQuestions: config?.portal_suggested_questions || null,
      portalActiveSkills,
      availableSkills,
      theme,
      logoUrl,
      customCSS: (config as any)?.portal_custom_css || null,
    },
  });
});

// ============================================
// JWT SECRET MANAGEMENT (requires auth - called from admin)
// ============================================

// Generate or regenerate JWT secret for an agent
router.post('/:agentId/jwt-secret', async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const userId = (req.session as any)?.userId;
  
  // SECURITY: Require authentication
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // SECURITY: Verify agent ownership
  const agent = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1',
    [agentId]
  );
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  if (agent.user_id !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  // Get agent config
  const config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [agentId]
  );
  
  if (!config) {
    return res.status(404).json({ error: 'Agent config not found' });
  }
  
  // Generate new secret
  const newSecret = generateJwtSecret();
  
  await execute(
    'UPDATE agent_configs SET portal_jwt_secret = $1 WHERE session_id = $2',
    [newSecret, agentId]
  );
  
  res.json({ 
    success: true, 
    secret: newSecret,
    message: 'JWT secret generated. Use this to sign tokens for portal access.',
  });
});

// Get JWT secret (for admin UI)
router.get('/:agentId/jwt-secret', async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const userId = (req.session as any)?.userId;
  
  // SECURITY: Require authentication
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // SECURITY: Verify agent ownership
  const agent = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1',
    [agentId]
  );
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  if (agent.user_id !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  const config = await queryOne<AgentConfig>(
    'SELECT portal_jwt_secret FROM agent_configs WHERE session_id = $1',
    [agentId]
  );
  
  if (!config) {
    return res.status(404).json({ error: 'Agent config not found' });
  }
  
  res.json({ 
    secret: config.portal_jwt_secret,
    hasSecret: !!config.portal_jwt_secret,
  });
});

// ============================================
// PORTAL SESSIONS
// ============================================

// Create or get a portal session
router.post('/:agentId/sessions', async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const { visitorId, userContext, token } = req.body;
  
  // Get agent config for JWT secret
  const agentConfig = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [agentId]
  );
  
  // If token provided, verify it and extract user context
  let resolvedUserContext = userContext;
  let resolvedVisitorId = visitorId;
  
  if (token && agentConfig?.portal_jwt_secret) {
    const decoded = verifyPortalToken(token, agentConfig.portal_jwt_secret);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    // Use decoded token as user context
    resolvedUserContext = decoded;
    // Use user_id or user_email from token as visitor ID
    resolvedVisitorId = (decoded.user_id || decoded.user_email || visitorId) as string;
  }
  
  // Verify agent exists
  const session = await queryOne<Session>(
    'SELECT id FROM sessions WHERE id = $1',
    [agentId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  // Check for existing session with this visitor
  if (resolvedVisitorId) {
    const existingSession = await queryOne<PortalSession>(
      'SELECT * FROM portal_sessions WHERE agent_id = $1 AND visitor_id = $2',
      [agentId, resolvedVisitorId]
    );
    
    if (existingSession) {
      // Update user context if provided
      if (resolvedUserContext) {
        await execute(
          'UPDATE portal_sessions SET user_context = $1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(resolvedUserContext), existingSession.id]
        );
      }
      
      // Get threads for this session
      const threads = await query<PortalThread>(
        'SELECT * FROM portal_threads WHERE portal_session_id = $1 ORDER BY updated_at DESC',
        [existingSession.id]
      );
      
      // Note: sandbox warmup is now triggered by the frontend calling POST /warmup
      // with the correct portal-${sessionId} key, so we don't warmup here.
      
      return res.json({
        session: existingSession,
        threads,
        isExisting: true,
      });
    }
  }
  
  // Create new session
  const sessionId = uuidv4();
  const newVisitorId = resolvedVisitorId || uuidv4();
  
  await execute(
    `INSERT INTO portal_sessions (id, agent_id, visitor_id, user_context)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, agentId, newVisitorId, resolvedUserContext ? JSON.stringify(resolvedUserContext) : null]
  );
  
  // Create initial thread
  const threadId = uuidv4();
  await execute(
    `INSERT INTO portal_threads (id, portal_session_id, title)
     VALUES ($1, $2, $3)`,
    [threadId, sessionId, 'New conversation']
  );
  
  const newSession = await queryOne<PortalSession>(
    'SELECT * FROM portal_sessions WHERE id = $1',
    [sessionId]
  );
  
  const threads = await query<PortalThread>(
    'SELECT * FROM portal_threads WHERE portal_session_id = $1',
    [sessionId]
  );
  
  // Log analytics event
  logEvent({
    agentId,
    eventType: 'session_start',
    source: 'portal',
    sessionId,
    metadata: { visitorId: newVisitorId },
  });
  
  // Note: sandbox warmup is now triggered by the frontend calling POST /warmup
  // with the correct portal-${sessionId} key after session creation.
  
  res.status(201).json({
    session: newSession,
    threads,
    visitorId: newVisitorId,
    isExisting: false,
  });
});

// Get session info
router.get('/:agentId/sessions/:sessionId', async (req: Request, res: Response) => {
  const { agentId, sessionId } = req.params;
  
  const session = await queryOne<PortalSession>(
    'SELECT * FROM portal_sessions WHERE id = $1 AND agent_id = $2',
    [sessionId, agentId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const threads = await query<PortalThread>(
    'SELECT * FROM portal_threads WHERE portal_session_id = $1 ORDER BY updated_at DESC',
    [sessionId]
  );
  
  res.json({ session, threads });
});

// Check sandbox health for a session
router.get('/:agentId/sessions/:sessionId/health', async (req: Request, res: Response) => {
  const { agentId, sessionId } = req.params;
  
  // Verify session exists
  const session = await queryOne<PortalSession>(
    'SELECT * FROM portal_sessions WHERE id = $1 AND agent_id = $2',
    [sessionId, agentId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  // Check if sandbox exists and is healthy
  const portalSandboxId = `portal-${sessionId}`;
  const sandbox = await ocService.getSandbox(portalSandboxId);
  
  if (!sandbox) {
    return res.json({ 
      healthy: false, 
      status: 'no_sandbox',
      message: 'No active sandbox for this session'
    });
  }
  
  // Try a simple command to verify sandbox is responsive
  try {
    const result = await sandbox.exec.run('echo "health"', { timeout: 5 });
    if (result.exitCode === 0) {
      // Also extend timeout while we're here
      await ocService.keepAlive(portalSandboxId);
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
    ocService.clearSandbox(portalSandboxId);
    return res.json({ 
      healthy: false, 
      status: 'expired',
      message: 'Sandbox has expired'
    });
  }
});

// Warm up / recreate sandbox for a session (includes full context setup)
router.post('/:agentId/sessions/:sessionId/warmup', async (req: Request, res: Response) => {
  const { agentId, sessionId } = req.params;
  
  console.log(`[Portal] Warmup request: agentId=${agentId}, sessionId=${sessionId}`);
  
  try {
    // Verify session exists
    const session = await queryOne<PortalSession>(
      'SELECT * FROM portal_sessions WHERE id = $1 AND agent_id = $2',
      [sessionId, agentId]
    );
    
    console.log(`[Portal] Session lookup result:`, session ? 'found' : 'not found');
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Get agent config - note: agentId is the session_id, not the agent_config id
    const config = await queryOne<AgentConfig>(
      'SELECT * FROM agent_configs WHERE session_id = $1',
      [agentId]
    );
    
    if (!config) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Get session info for provider - agentId IS the session id
    const agentSession = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1',
      [agentId]
    );
    
    if (!agentSession) {
      return res.status(404).json({ error: 'Agent session not found' });
    }
    
    // Get user for GitHub token (needed for repo cloning)
    const user = await queryOne<User>(
      'SELECT * FROM users WHERE id = $1',
      [agentSession.user_id]
    );
    
    const portalSandboxId = `portal-${sessionId}`;
    
    // Check if sandbox already exists and is healthy
    let sandbox = await ocService.getSandbox(portalSandboxId);
    
    if (sandbox) {
      try {
        const result = await sandbox.exec.run('echo "health"', { timeout: 5 });
        if (result.exitCode === 0) {
          await ocService.keepAlive(portalSandboxId);
          return res.json({ success: true, status: 'already_running' });
        }
      } catch {
        // Sandbox is dead, clear it
        await ocService.clearSandbox(portalSandboxId);
      }
    }
    
    // Create new sandbox
    console.log(`[Portal] Creating sandbox for warmup: ${portalSandboxId}`);
    await ocService.createSandbox(
      portalSandboxId,
      agentSession.agent_provider as 'claude-code' | 'aider' | 'opencode'
    );
    
    // Install tools
    console.log(`[Portal] Installing tools for warmup: ${portalSandboxId}`);
    await ocService.installAgentTools(
      portalSandboxId,
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
        console.log(`[Portal] Syncing ${agentBuckets.length} buckets for warmup`);
        
        // Install rclone first
        const rcloneResult = await ocService.installRclone(portalSandboxId);
        if (rcloneResult.success) {
          // Sync each bucket
          for (const bucket of agentBuckets) {
            let basePath = bucket.mount_path;
            if (!basePath.startsWith('/home/')) {
              basePath = `/home/user${basePath.startsWith('/') ? '' : '/'}${basePath}`;
            }
            
            // Portal-sandbox agents: use mount_path directly (no subdirectory)
            // Task agents: append bucket_name as subdirectory
            const isPortalSandboxPath = /\/(output|input|skills)$/.test(basePath);
            const localPath = isPortalSandboxPath ? basePath : `${basePath}/${bucket.bucket_name}`;
            const remotePath = `${agentSession.user_id}/${bucket.bucket_id}`;
            
            // Ensure directory exists (rclone won't create it if bucket is empty)
            await ocService.runCommand(portalSandboxId, `mkdir -p "${localPath}"`, '/');
            
            const syncResult = await ocService.syncWithRclone(portalSandboxId, {
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
              console.log(`[Portal] Synced bucket "${bucket.bucket_name}" to ${localPath}`);
            }
          }
        }
      }
    }
    
    // Clone repo if configured
    if (agentSession.repo_url && user?.github_access_token) {
      console.log(`[Portal] Cloning repo for warmup: ${agentSession.repo_url}`);
      await ocService.cloneRepo(
        portalSandboxId,
        agentSession.repo_url,
        agentSession.branch || 'main',
        user.github_access_token
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
      
      console.log(`[Portal] Configuring Claude settings for warmup (MCP: ${mcpServers.length}, KB: ${hasKnowledgeBases})`);
      const gatewayBaseUrl = process.env.GATEWAY_URL || `${req.protocol}://${req.get('host')}`;
      await ocService.configureClaudeSettings(portalSandboxId, {
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
        gatewayBaseUrl,
      });
    }
    
    console.log(`[Portal] Warmup complete for ${portalSandboxId}`);
    res.json({ success: true, status: 'created' });
    
  } catch (error: any) {
    console.error('[Portal] Warmup error:', error);
    res.status(500).json({ error: 'Failed to warm up sandbox', details: error.message });
  }
});

// Update session's active skills
router.patch('/:agentId/sessions/:sessionId/skills', async (req: Request, res: Response) => {
  const { agentId, sessionId } = req.params;
  const { activeSkills } = req.body;
  
  if (!Array.isArray(activeSkills)) {
    return res.status(400).json({ error: 'activeSkills must be an array' });
  }
  
  const session = await queryOne<PortalSession>(
    'SELECT * FROM portal_sessions WHERE id = $1 AND agent_id = $2',
    [sessionId, agentId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  await execute(
    'UPDATE portal_sessions SET active_skills = $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(activeSkills), sessionId]
  );
  
  res.json({ success: true, activeSkills });
});

// ============================================
// THREADS
// ============================================

// List threads for a session
router.get('/:agentId/sessions/:sessionId/threads', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  
  const threads = await query<PortalThread>(
    'SELECT * FROM portal_threads WHERE portal_session_id = $1 ORDER BY updated_at DESC',
    [sessionId]
  );
  
  res.json({ threads });
});

// Create new thread
router.post('/:agentId/sessions/:sessionId/threads', async (req: Request, res: Response) => {
  const { sessionId, agentId } = req.params;
  const { title } = req.body;
  
  // Verify session exists
  const session = await queryOne<PortalSession>(
    'SELECT * FROM portal_sessions WHERE id = $1 AND agent_id = $2',
    [sessionId, agentId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const threadId = uuidv4();
  
  await execute(
    `INSERT INTO portal_threads (id, portal_session_id, title)
     VALUES ($1, $2, $3)`,
    [threadId, sessionId, title || 'New conversation']
  );
  
  const thread = await queryOne<PortalThread>(
    'SELECT * FROM portal_threads WHERE id = $1',
    [threadId]
  );
  
  res.status(201).json({ thread });
});

// Update thread title
router.patch('/:agentId/sessions/:sessionId/threads/:threadId', async (req: Request, res: Response) => {
  const { sessionId, threadId } = req.params;
  const { title } = req.body;
  
  const thread = await queryOne<PortalThread>(
    'SELECT * FROM portal_threads WHERE id = $1 AND portal_session_id = $2',
    [threadId, sessionId]
  );
  
  if (!thread) {
    return res.status(404).json({ error: 'Thread not found' });
  }
  
  await execute(
    'UPDATE portal_threads SET title = $1, updated_at = NOW() WHERE id = $2',
    [title, threadId]
  );
  
  res.json({ success: true });
});

// Delete thread
router.delete('/:agentId/sessions/:sessionId/threads/:threadId', async (req: Request, res: Response) => {
  const { sessionId, threadId } = req.params;
  
  const thread = await queryOne<PortalThread>(
    'SELECT * FROM portal_threads WHERE id = $1 AND portal_session_id = $2',
    [threadId, sessionId]
  );
  
  if (!thread) {
    return res.status(404).json({ error: 'Thread not found' });
  }
  
  // Delete messages first
  await execute('DELETE FROM portal_messages WHERE thread_id = $1', [threadId]);
  await execute('DELETE FROM portal_threads WHERE id = $1', [threadId]);
  
  res.json({ success: true });
});

// ============================================
// THREAD SHARING
// ============================================

// Generate share link for a thread
router.post('/:agentId/sessions/:sessionId/threads/:threadId/share', async (req: Request, res: Response) => {
  const { agentId, sessionId, threadId } = req.params;
  
  try {
    // Verify thread belongs to this session
    const thread = await queryOne<PortalThread>(
      `SELECT pt.* FROM portal_threads pt
       WHERE pt.id = $1 AND pt.portal_session_id = $2`,
      [threadId, sessionId]
    );
    
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    
    // Generate or return existing share token
    let shareToken = thread.share_token;
    if (!shareToken) {
      shareToken = crypto.randomBytes(16).toString('base64url');
      await execute(
        'UPDATE portal_threads SET share_token = $1 WHERE id = $2',
        [shareToken, threadId]
      );
    }
    
    // Use FRONTEND_URL for share links (falls back to request host in production)
    const frontendUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
    const shareUrl = `${frontendUrl}/chat/${agentId}/shared/${shareToken}`;
    
    res.json({ 
      success: true,
      shareToken, 
      shareUrl 
    });
  } catch (error) {
    console.error('[Portal] Error generating share link:', error);
    res.status(500).json({ error: 'Failed to generate share link' });
  }
});

// View shared thread (read-only)
router.get('/:agentId/shared/:shareToken', async (req: Request, res: Response) => {
  const { agentId, shareToken } = req.params;
  
  try {
    // Find thread by share token
    const thread = await queryOne<PortalThread & { agent_id: string }>(
      `SELECT pt.*, ps.agent_id
       FROM portal_threads pt
       JOIN portal_sessions ps ON pt.portal_session_id = ps.id
       WHERE pt.share_token = $1 AND ps.agent_id = $2`,
      [shareToken, agentId]
    );
    
    if (!thread) {
      return res.status(404).json({ error: 'Shared thread not found or link is invalid' });
    }
    
    // Get messages for this thread
    const messages = await query<PortalMessage>(
      `SELECT id, role, content, thinking_content, created_at 
       FROM portal_messages 
       WHERE thread_id = $1 
       ORDER BY created_at ASC`,
      [thread.id]
    );
    
    // Get agent config for styling the shared view
    const agentConfig = await queryOne<AgentConfig>(
      'SELECT * FROM agent_configs WHERE session_id = $1',
      [agentId]
    );
    
    res.json({
      thread: {
        id: thread.id,
        title: thread.title,
        created_at: thread.created_at,
        updated_at: thread.updated_at,
      },
      messages,
      isShared: true,
      // Include portal config for styling
      portalConfig: agentConfig ? {
        name: agentConfig.portal_name || agentConfig.name || 'AI Assistant',
        theme: agentConfig.portal_theme,
        logoUrl: agentConfig.portal_logo_url,
        customCSS: agentConfig.portal_custom_css,
      } : null,
    });
  } catch (error) {
    console.error('[Portal] Error fetching shared thread:', error);
    res.status(500).json({ error: 'Failed to load shared thread' });
  }
});

// Fork shared thread into user's own session
router.post('/:agentId/shared/:shareToken/fork', async (req: Request, res: Response) => {
  const { agentId, shareToken } = req.params;
  const { visitorId } = req.body;
  
  try {
    // Get the shared thread
    const sharedThread = await queryOne<PortalThread>(
      `SELECT pt.*
       FROM portal_threads pt
       JOIN portal_sessions ps ON pt.portal_session_id = ps.id
       WHERE pt.share_token = $1 AND ps.agent_id = $2`,
      [shareToken, agentId]
    );
    
    if (!sharedThread) {
      return res.status(404).json({ error: 'Shared thread not found' });
    }
    
    // Get messages from shared thread
    const sharedMessages = await query<PortalMessage>(
      `SELECT * FROM portal_messages WHERE thread_id = $1 ORDER BY created_at ASC`,
      [sharedThread.id]
    );
    
    // Create or get user's portal session
    const newVisitorId = visitorId || uuidv4();
    let userSession = await queryOne<PortalSession>(
      'SELECT * FROM portal_sessions WHERE agent_id = $1 AND visitor_id = $2',
      [agentId, newVisitorId]
    );
    
    if (!userSession) {
      // Create new session
      const sessionId = uuidv4();
      await execute(
        `INSERT INTO portal_sessions (id, agent_id, visitor_id)
         VALUES ($1, $2, $3)`,
        [sessionId, agentId, newVisitorId]
      );
      
      userSession = await queryOne<PortalSession>(
        'SELECT * FROM portal_sessions WHERE id = $1',
        [sessionId]
      );
    }
    
    // Create new thread in user's session
    const newThreadId = uuidv4();
    await execute(
      `INSERT INTO portal_threads (id, portal_session_id, title)
       VALUES ($1, $2, $3)`,
      [newThreadId, userSession!.id, `${sharedThread.title} (continued)`]
    );
    
    // Copy messages to new thread
    for (const msg of sharedMessages) {
      await execute(
        `INSERT INTO portal_messages (id, thread_id, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), newThreadId, msg.role, msg.content, msg.created_at]
      );
    }
    
    res.json({
      success: true,
      session: userSession,
      threadId: newThreadId,
      visitorId: newVisitorId,
    });
  } catch (error) {
    console.error('[Portal] Error forking thread:', error);
    res.status(500).json({ error: 'Failed to continue conversation' });
  }
});

// Revoke share link (optional)
router.delete('/:agentId/sessions/:sessionId/threads/:threadId/share', async (req: Request, res: Response) => {
  const { sessionId, threadId } = req.params;
  
  try {
    // Verify ownership
    const thread = await queryOne<PortalThread>(
      'SELECT * FROM portal_threads WHERE id = $1 AND portal_session_id = $2',
      [threadId, sessionId]
    );
    
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    
    // Remove share token
    await execute(
      'UPDATE portal_threads SET share_token = NULL WHERE id = $1',
      [threadId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Portal] Error revoking share link:', error);
    res.status(500).json({ error: 'Failed to revoke share link' });
  }
});

// ============================================
// MESSAGES
// ============================================

// Get messages for a thread
router.get('/:agentId/sessions/:sessionId/threads/:threadId/messages', async (req: Request, res: Response) => {
  const { threadId } = req.params;
  
  const messages = await query<PortalMessage>(
    'SELECT * FROM portal_messages WHERE thread_id = $1 ORDER BY created_at ASC',
    [threadId]
  );
  
  console.log('[Portal] Loading messages for thread:', {
    threadId,
    messageCount: messages.length,
    messagesWithThinking: messages.filter(m => m.thinking_content).length,
  });
  
  res.json({ messages });
});

// Send message and stream response (VM-backed)
router.post('/:agentId/sessions/:sessionId/threads/:threadId/stream', async (req: Request, res: Response) => {
  const { agentId, sessionId, threadId } = req.params;
  const { content } = req.body;
  
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'content is required and cannot be empty' });
  }
  
  // Verify thread exists
  const thread = await queryOne<PortalThread>(
    'SELECT * FROM portal_threads WHERE id = $1 AND portal_session_id = $2',
    [threadId, sessionId]
  );
  
  if (!thread) {
    return res.status(404).json({ error: 'Thread not found' });
  }
  
  // Get session for user context
  const portalSession = await queryOne<PortalSession>(
    'SELECT * FROM portal_sessions WHERE id = $1',
    [sessionId]
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
  
  // Get user for GitHub token (needed for repo cloning)
  const user = await queryOne<User>(
    'SELECT * FROM users WHERE id = $1',
    [agentSession.user_id]
  );
  
  // Get previous messages for context
  const previousMessages = await query<PortalMessage>(
    'SELECT * FROM portal_messages WHERE thread_id = $1 ORDER BY created_at ASC LIMIT 50',
    [threadId]
  );
  
  // ==========================================
  // PORTAL AGENT BRANCH — Direct Anthropic API (original 'portal' type only)
  // ==========================================
  if (agentSession.agent_type === 'portal') {
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    if (res.socket) res.socket.setNoDelay(true);

    // Log message event
    logEvent({
      agentId,
      eventType: 'message',
      source: 'portal',
      sessionId,
      threadId,
      metadata: { messageLength: content.length, agentType: 'portal' },
    });

    // Build portal agent config from DB config
    const portalConfig = config ? buildPortalAgentConfig(config) : {
      model: 'claude-sonnet-4-5-20250929',
      systemPrompt: 'You are a helpful AI assistant.',
      sandboxEnabled: false,
    };

    // Override system prompt from config if set
    if (config?.system_prompt) {
      portalConfig.systemPrompt = config.system_prompt;
    }

    try {
      await handlePortalAgentStream(res, {
        agentId,
        sessionId,
        threadId,
        userId: agentSession.user_id,
        portalUserId: portalSession?.visitor_id || null,
        organizationId: agentSession.organization_id,
        content,
        previousMessages: previousMessages.map(m => ({
          role: m.role,
          content: m.content,
          thinking_content: (m as any).thinking_content,
        })),
        config: portalConfig,
        portalSession: portalSession || undefined,
      });
    } catch (err: any) {
      console.error('[Portal] Portal agent stream error:', err);
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
        res.end();
      } catch { /* connection already closed */ }
    }
    return;
  }
  
  // ==========================================
  // E2B SANDBOX FLOW — For code/task/portal-sandbox agents
  // ==========================================
  
  // Save user message
  const userMessageId = uuidv4();
  await execute(
    `INSERT INTO portal_messages (id, thread_id, role, content)
     VALUES ($1, $2, $3, $4)`,
    [userMessageId, threadId, 'user', content]
  );
  
  // Log message event
  logEvent({
    agentId,
    eventType: 'message',
    source: 'portal',
    sessionId,
    threadId,
    metadata: { messageLength: content.length },
  });
  
  // Track timing for latency calculation
  const startTime = Date.now();
  
  // Update thread timestamp and title if first message
  if (previousMessages.length === 0) {
    // Generate title from first message
    const title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
    await execute(
      'UPDATE portal_threads SET title = $1, updated_at = NOW() WHERE id = $2',
      [title, threadId]
    );
  } else {
    await execute(
      'UPDATE portal_threads SET updated_at = NOW() WHERE id = $1',
      [threadId]
    );
  }
  
  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx/proxy buffering
  res.flushHeaders();
  
  // Disable Nagle's algorithm for immediate writes
  if (res.socket) {
    res.socket.setNoDelay(true);
  }
  
  // Simple write helper
  const writeSSE = (data: string) => {
    res.write(data);
  };
  
  // Register this stream for file notifications
  const portalSandboxId = `portal-${sessionId}`;
  if (!activePortalStreams.has(portalSandboxId)) {
    activePortalStreams.set(portalSandboxId, []);
  }
  activePortalStreams.get(portalSandboxId)!.push(res);
  
  // Clean up on disconnect
  req.on('close', () => {
    const streams = activePortalStreams.get(portalSandboxId);
    if (streams) {
      const index = streams.indexOf(res);
      if (index > -1) {
        streams.splice(index, 1);
      }
      if (streams.length === 0) {
        activePortalStreams.delete(portalSandboxId);
      }
    }
  });
  
  try {
    // Build conversation context for the prompt
    let conversationContext = '';
    if (previousMessages.length > 0) {
      conversationContext = 'Previous conversation:\n';
      for (const msg of previousMessages.slice(-10)) { // Last 10 messages
        conversationContext += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
      }
      conversationContext += '\n';
    }
    
    // User context from session
    let userContextStr = '';
    if (portalSession?.user_context) {
      try {
        const ctx = JSON.parse(portalSession.user_context);
        userContextStr = `\nUser context: ${JSON.stringify(ctx)}\n`;
      } catch {}
    }
    
    // Build the full prompt
    const fullPrompt = `${conversationContext}${userContextStr}User: ${content}`;
    
    // Get API keys from environment
    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    const allApiKeys: Record<string, string> = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
    };
    
    // Parse custom secrets from agent config
    const customSecrets: Record<string, string> = config?.secrets ? JSON.parse(config.secrets) : {};
    
    // For portal, we create a temporary sandbox session
    // Use a portal-specific session ID to track the sandbox
    const portalSandboxId = `portal-${sessionId}`;
    
    // Track configured system prompt (enhanced with KB, MCP, secrets, skill files)
    let configuredSystemPrompt: string | undefined;
    
    // Check if sandbox already exists for this portal session
    let sandbox = await ocService.getSandbox(portalSandboxId);
    
    if (!sandbox) {
      // Create new sandbox
      res.write(`data: ${JSON.stringify({ type: 'status', content: 'Starting agent environment...' })}\n\n`);
      
      await ocService.createSandbox(portalSandboxId, agentSession.agent_provider as 'claude-code' | 'aider' | 'opencode');
      
      // Install agent tools
      res.write(`data: ${JSON.stringify({ type: 'status', content: 'Installing tools...' })}\n\n`);
      await ocService.installAgentTools(portalSandboxId, agentSession.agent_provider as 'claude-code' | 'aider' | 'opencode');
      
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
            const rcloneResult = await ocService.installRclone(portalSandboxId);
            if (rcloneResult.success) {
              // Sync each bucket
              for (const bucket of agentBuckets) {
                let basePath = bucket.mount_path;
                if (!basePath.startsWith('/home/')) {
                  basePath = `/home/user${basePath.startsWith('/') ? '' : '/'}${basePath}`;
                }
                
                // Portal-sandbox agents: use mount_path directly (no subdirectory)
                const isPortalSandboxPath = /\/(output|input|skills)$/.test(basePath);
                const localPath = isPortalSandboxPath ? basePath : `${basePath}/${bucket.bucket_name}`;
                const remotePath = `${agentOwner.user_id}/${bucket.bucket_id}`;
                
                // Ensure directory exists (rclone won't create it if bucket is empty)
                await ocService.runCommand(portalSandboxId, `mkdir -p "${localPath}"`, '/');
                
                const syncResult = await ocService.syncWithRclone(portalSandboxId, {
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
                  console.log(`[Portal] Synced bucket "${bucket.bucket_name}" to ${localPath}`);
                }
              }
            }
          }
        }
      }
      
      // Clone repo if configured
      if (agentSession.repo_url && user?.github_access_token) {
        res.write(`data: ${JSON.stringify({ type: 'status', content: 'Cloning repository...' })}\n\n`);
        await ocService.cloneRepo(
          portalSandboxId,
          agentSession.repo_url,
          agentSession.branch || 'main',
          user.github_access_token
        );
      }

      // Configure Claude Code with system prompt, MCP servers, and knowledge bases (when sandbox is new)
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
        const gatewayBaseUrl = process.env.GATEWAY_URL || `${req.protocol}://${req.get('host')}`;
        const configResult = await ocService.configureClaudeSettings(portalSandboxId, {
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
          gatewayBaseUrl,
        });
        configuredSystemPrompt = configResult.systemPrompt;
      }
    } else {
      // Sandbox already exists — CLAUDE.md, skills, MCP, and Python libs were already
      // configured during warmup/first-message setup. We only need to rebuild the
      // system prompt STRING to pass via --append-system-prompt (no filesystem I/O).
      if (agentSession.agent_provider === 'claude-code') {
        console.log(`[Portal] Sandbox exists, rebuilding system prompt only for ${portalSandboxId}`);
        const mcpServers = config?.mcp_servers 
          ? JSON.parse(config.mcp_servers).filter((s: any) => s.type === 'custom')
          : [];
        
        const kbAttachments = await query<{ id: string }>(
          'SELECT id FROM agent_knowledge_bases WHERE session_id = $1 LIMIT 1',
          [agentId]
        );
        const hasKnowledgeBases = kbAttachments.length > 0;
        
        const gatewayBaseUrl = process.env.GATEWAY_URL || `${req.protocol}://${req.get('host')}`;
        const configResult = await ocService.configureClaudeSettings(portalSandboxId, {
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
          gatewayBaseUrl,
          skipFileSystemSetup: true,  // Skip all sandbox commands — already configured
        });
        configuredSystemPrompt = configResult.systemPrompt;
      }
    }
    
    res.write(`data: ${JSON.stringify({ type: 'status', content: 'Processing...' })}\n\n`);
    
    // Track streamed content for real-time display
    let lastStreamedText = '';
    let currentToolStatus = '';
    
    // Collect all thinking/tool/text events for persistence (audit trail)
    const collectedThinkingEntries: Array<{
      type: 'thinking' | 'tool' | 'tool_result' | 'extended_thinking' | 'status' | 'text';
      content: string;
      timestamp: number;
      toolName?: string;
      toolId?: string;
      duration?: number;
      isError?: boolean;
      input?: unknown;
      result?: unknown;
      isMcp?: boolean;
    }> = [];
    
    // Accumulate text deltas between tool calls so we can save as interleaved text blocks
    let pendingTextContent = '';
    
    // Flush accumulated text into collectedThinkingEntries as a text block
    const flushPendingText = () => {
      if (pendingTextContent.trim()) {
        collectedThinkingEntries.push({
          type: 'text',
          content: pendingTextContent,
          timestamp: Date.now(),
        });
        pendingTextContent = '';
      }
    };
    
    // Subscribe to terminal events for live streaming
    console.log(`[Portal] Subscribing to terminal:${portalSandboxId} for live streaming`);
    
    // Track active tools for the thinking panel
    const activeToolsList: Array<{ toolId: string; toolName: string; startTime: number }> = [];
    
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
        // Handle new enhanced event types from oc.ts
        if (event.type === 'tool_start') {
          // Flush any pending text before a tool call starts
          flushPendingText();
          // Tool started - add to active tools and emit live SSE
          activeToolsList.push({ 
            toolId: event.toolId || '', 
            toolName: event.toolName || 'tool',
            startTime: event.timestamp || Date.now(),
            input: event.input // Store input for later
          });
          if (event.data && event.data !== currentToolStatus) {
            currentToolStatus = event.data;
            const ssePayload = { 
              type: 'thinking', 
              content: event.data,
              detail: event.detail,
              toolName: event.toolName,
              toolId: event.toolId,
              input: event.input
            };
            writeSSE(`data: ${JSON.stringify(ssePayload)}\n\n`);
            // NOTE: Do NOT persist tool_start entries — only tool_result has complete info
          }
        } else if (event.type === 'tool_end') {
          // Tool completed - remove from active and optionally show result
          const idx = activeToolsList.findIndex(t => t.toolId === event.toolId);
          const toolInfo = idx >= 0 ? activeToolsList[idx] : null;
          if (idx >= 0) activeToolsList.splice(idx, 1);
          
          const ssePayload = { 
            type: 'tool_result', 
            content: event.data,
            toolName: event.toolName,
            toolId: event.toolId,
            duration: event.duration,
            isError: event.isError,
            input: event.input || toolInfo?.input,
            result: event.result
          };
          writeSSE(`data: ${JSON.stringify(ssePayload)}\n\n`);
          // Collect for persistence
          collectedThinkingEntries.push({
            type: 'tool_result',
            content: event.data || '',
            timestamp: Date.now(),
            toolName: event.toolName,
            toolId: event.toolId,
            duration: event.duration,
            isError: event.isError,
            input: event.input || toolInfo?.input,
            result: event.result,
          });
          
          // Update current status to show remaining active tools or clear
          if (activeToolsList.length > 0) {
            const latest = activeToolsList.at(-1)!;
            currentToolStatus = `⚙️ ${latest.toolName}...`;
          } else {
            currentToolStatus = '';
          }
        } else if (event.type === 'mcp_tool_call') {
          // MCP tool called via gateway - emit as thinking event with MCP flag
          const mcpToolId = `mcp-${event.toolName}-${Date.now()}`;
          writeSSE(`data: ${JSON.stringify({ 
            type: 'thinking', 
            content: `🔧 ${event.toolName}...`,
            toolName: event.toolName,
            toolId: mcpToolId,
            detail: `Calling MCP tool: ${event.toolName}`,
            isMcp: true
          })}\n\n`);
          // NOTE: Do NOT persist tool_start entries — only tool_result has complete info
        } else if (event.type === 'mcp_tool_complete') {
          // MCP tool completed
          const mcpToolId = `mcp-${Date.now()}`;
          writeSSE(`data: ${JSON.stringify({ 
            type: 'tool_result', 
            content: event.success ? `✓ ${event.toolName}` : `❌ ${event.toolName} failed`,
            toolName: event.toolName,
            toolId: mcpToolId,
            duration: event.duration,
            isError: !event.success,
            isMcp: true
          })}\n\n`);
          // Collect for persistence
          collectedThinkingEntries.push({
            type: 'tool_result',
            content: event.success ? `✓ ${event.toolName}` : `❌ ${event.toolName} failed`,
            timestamp: Date.now(),
            toolName: event.toolName,
            toolId: mcpToolId,
            duration: event.duration,
            isError: !event.success,
            isMcp: true,
          });
        } else if (event.type === 'thinking') {
          // Flush any pending text before thinking starts
          flushPendingText();
          // Extended thinking from Claude (internal reasoning)
          writeSSE(`data: ${JSON.stringify({ 
            type: 'extended_thinking', 
            content: event.data 
          })}\n\n`);
          // Collect for persistence
          collectedThinkingEntries.push({
            type: 'extended_thinking',
            content: event.data || '',
            timestamp: Date.now(),
          });
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
                    writeSSE(`data: ${JSON.stringify({ type: 'text', content: evt.delta.text })}\n\n`);
                    lastStreamedText += evt.delta.text;
                    // Accumulate for persistence as interleaved text block
                    pendingTextContent += evt.delta.text;
                  } else if (evt.delta.type === 'thinking_delta' && evt.delta.thinking) {
                    // Stream thinking content
                    writeSSE(`data: ${JSON.stringify({ type: 'extended_thinking', content: evt.delta.thinking })}\n\n`);
                    // Collect for persistence
                    collectedThinkingEntries.push({
                      type: 'extended_thinking',
                      content: evt.delta.thinking,
                      timestamp: Date.now(),
                    });
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
                      writeSSE(`data: ${JSON.stringify({ type: 'text', content: block.text })}\n\n`);
                      lastStreamedText += block.text;
                      // Accumulate for persistence
                      pendingTextContent += block.text;
                    }
                  }
                }
              }
            } catch {
              // Skip non-JSON lines silently
            }
          }
        }
      } catch (err) {
        console.error('[Portal] Error in event handler:', err);
      }
    };
    
    // Subscribe to live events
    console.log(`[Portal] Subscribing to terminal events on: terminal:${portalSandboxId}`);
    terminalEvents.on(`terminal:${portalSandboxId}`, eventHandler);
    
    let result;
    try {
      // Build extended thinking config from agent settings
      // Portal-sandbox agents always have thinking enabled
      const extendedThinking = (config?.enable_extended_thinking || agentSession.agent_type === 'portal-sandbox')
        ? { enabled: true, budgetTokens: config?.thinking_budget_tokens || 100000 }
        : undefined;
      
      // Run the agent command - use configuredSystemPrompt which includes KB, MCP, secrets, and skill file instructions
      result = await ocService.runAgentCommand(
        portalSandboxId,
        agentSession.agent_provider as 'claude-code' | 'aider' | 'opencode',
        fullPrompt,
        apiKey,
        agentSession.agent_model || undefined,
        allApiKeys,
        customSecrets,
        configuredSystemPrompt,  // Use enhanced system prompt with all features
        extendedThinking  // Pass extended thinking configuration
      );
    } catch (commandError: unknown) {
      // Check if sandbox expired/died
      const errMessage = commandError instanceof Error ? commandError.message : String(commandError);
      if (errMessage.includes('not running') || errMessage.includes('NotFoundError')) {
        console.log(`[Portal] Sandbox expired, recreating for ${portalSandboxId}`);
        
        // Clear dead sandbox and notify user
        ocService.clearSandbox(portalSandboxId);
        res.write(`data: ${JSON.stringify({ type: 'status', content: 'Session expired, restarting agent...' })}\n\n`);
        
        // Recreate sandbox
        await ocService.createSandbox(portalSandboxId, agentSession.agent_provider as 'claude-code' | 'aider' | 'opencode');
        await ocService.installAgentTools(portalSandboxId, agentSession.agent_provider as 'claude-code' | 'aider' | 'opencode');
        
        // Re-sync buckets after sandbox recreation
        const agentBucketsRetry = await query<{ bucket_id: string; bucket_name: string; mount_path: string }>(
          `SELECT ab.bucket_id, b.name as bucket_name, ab.mount_path 
           FROM agent_buckets ab 
           JOIN buckets b ON ab.bucket_id = b.id 
           WHERE ab.session_id = $1`,
          [agentId]
        );
        
        if (agentBucketsRetry.length > 0) {
          const agentOwnerRetry = await queryOne<{ user_id: string }>(
            'SELECT user_id FROM sessions WHERE id = $1',
            [agentId]
          );
          
          if (agentOwnerRetry) {
            const storageConfigRetry = await getS3MountConfig(agentOwnerRetry.user_id);
            
            if (storageConfigRetry) {
              res.write(`data: ${JSON.stringify({ type: 'status', content: 'Syncing files...' })}\n\n`);
              
              const rcloneResultRetry = await ocService.installRclone(portalSandboxId);
              if (rcloneResultRetry.success) {
                for (const bucket of agentBucketsRetry) {
                  let basePath = bucket.mount_path;
                  if (!basePath.startsWith('/home/')) {
                    basePath = `/home/user${basePath.startsWith('/') ? '' : '/'}${basePath}`;
                  }
                  
                  const localPath = `${basePath}/${bucket.bucket_name}`;
                  const remotePath = `${agentOwnerRetry.user_id}/${bucket.bucket_id}`;
                  
                  await ocService.syncWithRclone(portalSandboxId, {
                    provider: storageConfigRetry.provider,
                    bucketName: storageConfigRetry.bucketName,
                    accessKeyId: storageConfigRetry.accessKeyId,
                    secretAccessKey: storageConfigRetry.secretAccessKey,
                    endpoint: storageConfigRetry.endpoint,
                    region: storageConfigRetry.region,
                    remotePath,
                    localPath,
                  });
                }
              }
            }
          }
        }
        
        // Always reconfigure after sandbox recreation (to get bucket info, python libs, etc.)
        const mcpServersRetry = config?.mcp_servers ? JSON.parse(config.mcp_servers).filter((s: any) => s.type === 'custom') : [];
        const kbAttachmentsRetry = await query<{ id: string }>('SELECT id FROM agent_knowledge_bases WHERE session_id = $1 LIMIT 1', [agentId]);
        const gatewayBaseUrlRetry = process.env.GATEWAY_URL || `${req.protocol}://${req.get('host')}`;
        
        const configResultRetry = await ocService.configureClaudeSettings(portalSandboxId, {
          systemPrompt: config?.system_prompt,
          mcpServers: mcpServersRetry,
          secrets: customSecrets,
          agentId,
          hasKnowledgeBases: kbAttachmentsRetry.length > 0,
          gatewayBaseUrl: gatewayBaseUrlRetry,
        });
        configuredSystemPrompt = configResultRetry.systemPrompt;
        
        res.write(`data: ${JSON.stringify({ type: 'status', content: 'Configuring agent...' })}\n\n`);
        
        // Reset lastStreamedText for the retry
        lastStreamedText = '';
        
        res.write(`data: ${JSON.stringify({ type: 'status', content: 'Reprocessing your request...' })}\n\n`);
        
        // Retry the command (reuse the extendedThinking config from above)
        result = await ocService.runAgentCommand(
          portalSandboxId,
          agentSession.agent_provider as 'claude-code' | 'aider' | 'opencode',
          fullPrompt,
          apiKey,
          agentSession.agent_model || undefined,
          allApiKeys,
          customSecrets,
          configuredSystemPrompt,
          extendedThinking
        );
      } else if (lastStreamedText) {
        // Command failed but we already streamed content to the user.
        // This happens when Claude Code exits with code 1 after doing work
        // (e.g., a tool error during execution). Use the streamed content.
        console.log(`[Portal] Command failed but we have streamed text (${lastStreamedText.length} chars), using that as response`);
        result = { stdout: lastStreamedText, stderr: '', exitCode: 1 };
      } else {
        throw commandError; // Re-throw if not a sandbox expiration error and no streamed content
      }
    } finally {
      // Always unsubscribe
      terminalEvents.off(`terminal:${portalSandboxId}`, eventHandler);
    }
    
    // Get the final response content - prefer streamed text over raw stdout
    // result.stdout from oc should already be the extracted text for Claude Code
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
    
    // SYNC FILES BEFORE ENDING RESPONSE - so we can notify the UI
    res.write(`data: ${JSON.stringify({ type: 'status', content: 'Syncing files...' })}\n\n`);
    
    let newFilesCreated: Array<{
      id: string;
      name: string;
      path: string;
      bucket_id: string;
      bucket_name: string;
      mime_type: string | null;
      size: number;
    }> = [];
    
    try {
      const agentOwner = await queryOne<{ user_id: string }>(
        'SELECT user_id FROM sessions WHERE id = $1',
        [agentId]
      );
      
      if (agentOwner?.user_id) {
        // Get file count before sync
        const beforeFiles = await query<{ bucket_id: string; file_count: number }>(
          `SELECT ab.bucket_id, COUNT(f.id) as file_count
           FROM agent_buckets ab
           LEFT JOIN files f ON f.bucket_id = ab.bucket_id AND f.is_folder = FALSE
           WHERE ab.session_id = $1
           GROUP BY ab.bucket_id`,
          [agentId]
        );
        
        await syncAgentBucketsBackAndIndex({
          sandboxSessionId: portalSandboxId,
          agentId,
          ownerUserId: agentOwner.user_id,
          portalVisitorId: portalSession?.visitor_id || undefined, // Scope new files to this visitor (works across sessions for JWT users)
        });
        
        // Get file count after sync and detect new files
        const afterFiles = await query<{ bucket_id: string; file_count: number }>(
          `SELECT ab.bucket_id, COUNT(f.id) as file_count
           FROM agent_buckets ab
           LEFT JOIN files f ON f.bucket_id = ab.bucket_id AND f.is_folder = FALSE
           WHERE ab.session_id = $1
           GROUP BY ab.bucket_id`,
          [agentId]
        );
        
        // Compare and get newly created files
        for (const after of afterFiles) {
          const before = beforeFiles.find(b => b.bucket_id === after.bucket_id);
          const beforeCount = before ? Number(before.file_count) : 0;
          const afterCount = Number(after.file_count);
          
          if (afterCount > beforeCount) {
            // Get the newly created files
            const files = await query<{
              id: string;
              name: string;
              path: string;
              mime_type: string | null;
              size: number;
              bucket_id: string;
              bucket_name: string;
            }>(
              `SELECT f.id, f.name, f.path, f.mime_type, f.size, f.bucket_id, b.name as bucket_name
               FROM files f
               JOIN buckets b ON f.bucket_id = b.id
               WHERE f.bucket_id = $1 AND f.is_folder = FALSE
               ORDER BY f.created_at DESC
               LIMIT $2`,
              [after.bucket_id, afterCount - beforeCount]
            );
            
            newFilesCreated.push(...files);
          }
        }
      }
    } catch (err) {
      console.error('[Portal] File sync error:', err);
    }
    
    // Send file creation events to UI
    if (newFilesCreated.length > 0) {
      console.log(`[Portal] Detected ${newFilesCreated.length} new files`);
      for (const file of newFilesCreated) {
        res.write(`data: ${JSON.stringify({ 
          type: 'file_created',
          file: {
            id: file.id,
            name: file.name,
            path: file.path,
            bucket_id: file.bucket_id,
            bucket_name: file.bucket_name,
            mime_type: file.mime_type,
            size: Number(file.size),
          }
        })}\n\n`);
      }
    }
    
    // Save assistant message - use the clean text content and include thinking/tool audit trail
    const assistantMessageId = uuidv4();
    
    // Build the persisted thinking content:
    // - If we collected structured thinking/tool entries, save them as JSON
    // - Fall back to result.thinking (raw text) if no structured entries collected
    let thinkingToSave: string | null = null;
    
    // Flush any remaining pending text
    flushPendingText();
    
    if (collectedThinkingEntries.length > 0) {
      // Consolidate extended_thinking entries into a single entry to save space
      // but keep text/tool/tool_result blocks as-is for proper interleaving
      const consolidated: typeof collectedThinkingEntries = [];
      let accumulatedThinking = '';
      for (const entry of collectedThinkingEntries) {
        if (entry.type === 'extended_thinking') {
          accumulatedThinking += entry.content;
        } else {
          // Flush accumulated thinking before non-thinking entry
          if (accumulatedThinking) {
            consolidated.push({
              type: 'thinking',
              content: accumulatedThinking,
              timestamp: entry.timestamp,
            });
            accumulatedThinking = '';
          }
          consolidated.push(entry);
        }
      }
      // Flush remaining thinking
      if (accumulatedThinking) {
        consolidated.push({
          type: 'thinking',
          content: accumulatedThinking,
          timestamp: Date.now(),
        });
      }
      thinkingToSave = JSON.stringify(consolidated);
    } else if (result.thinking) {
      // Legacy fallback: wrap raw thinking text in a simple array
      thinkingToSave = JSON.stringify([{
        type: 'thinking',
        content: result.thinking,
        timestamp: Date.now(),
      }]);
    }
    
    await execute(
      `INSERT INTO portal_messages (id, thread_id, role, content, thinking_content)
       VALUES ($1, $2, $3, $4, $5)`,
      [assistantMessageId, threadId, 'assistant', responseContent, thinkingToSave]
    );
    
    // Log response event with latency
    const latencyMs = Date.now() - startTime;
    logEvent({
      agentId,
      eventType: 'response',
      source: 'portal',
      sessionId,
      threadId,
      latencyMs,
      success: true,
      metadata: { responseLength: responseContent.length, filesCreated: newFilesCreated.length },
    });
    
    res.write(`data: ${JSON.stringify({ type: 'done', messageId: assistantMessageId })}\n\n`);
    res.end();
    
  } catch (error) {
    console.error('[Portal] Stream error:', error);
    
    // Log error event
    logEvent({
      agentId,
      eventType: 'error',
      source: 'portal',
      sessionId,
      threadId,
      latencyMs: Date.now() - startTime,
      success: false,
      errorMessage: String(error),
    });
    
    res.write(`data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`);
    res.end();
  }
});

// ============================================
// PORTAL FILE OPERATIONS
// ============================================

// Get accessible buckets for portal (filtered by portal_bucket_access)
router.get('/:agentId/sessions/:sessionId/buckets', async (req: Request, res: Response) => {
  const { agentId, sessionId } = req.params;
  
  console.log('[Portal] Fetching buckets for agent:', agentId, 'portal session:', sessionId);
  
  try {
    // Verify session exists
    const session = await queryOne<PortalSession>(
      'SELECT * FROM portal_sessions WHERE id = $1 AND agent_id = $2',
      [sessionId, agentId]
    );
    
    if (!session) {
      console.log('[Portal] Portal session not found');
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // First check what buckets exist for this agent at all
    const allAgentBuckets = await query<{ bucket_id: string; bucket_name: string }>(
      `SELECT ab.bucket_id, b.name as bucket_name
       FROM agent_buckets ab
       JOIN buckets b ON ab.bucket_id = b.id
       WHERE ab.session_id = $1`,
      [agentId]
    );
    console.log('[Portal] All agent buckets:', allAgentBuckets);
    
    // Get agent config to check for portal_bucket_id and portal_files_hidden
    const agentConfig = await queryOne<{ portal_bucket_id: string | null; portal_files_hidden: boolean | null; agent_type: string | null }>(
      `SELECT ac.portal_bucket_id, ac.portal_files_hidden, s.agent_type 
       FROM agent_configs ac
       JOIN sessions s ON s.id = ac.session_id
       WHERE ac.session_id = $1`,
      [agentId]
    );
    
    // Get portal bucket - either hidden, the configured one, or default to first
    let portalBuckets: { bucket_id: string; bucket_name: string; access_type: string; storage_used: number; }[];
    
    if (agentConfig?.portal_files_hidden) {
      // Files section explicitly hidden - return empty array
      portalBuckets = [];
    } else if (agentConfig?.portal_bucket_id) {
      // Specific bucket configured - only return that one
      portalBuckets = await query<{
        bucket_id: string;
        bucket_name: string;
        access_type: string;
        storage_used: number;
      }>(
        `SELECT 
          ab.bucket_id,
          b.name as bucket_name,
          'output' as access_type,
          b.storage_used
         FROM agent_buckets ab
         JOIN buckets b ON ab.bucket_id = b.id
         WHERE ab.session_id = $1 AND ab.bucket_id = $2`,
        [agentId, agentConfig.portal_bucket_id]
      );
    } else {
      // No specific bucket - return first bucket only (simplified)
      portalBuckets = await query<{
        bucket_id: string;
        bucket_name: string;
        access_type: string;
        storage_used: number;
      }>(
        `SELECT 
          ab.bucket_id,
          b.name as bucket_name,
          'output' as access_type,
          b.storage_used
         FROM agent_buckets ab
         JOIN buckets b ON ab.bucket_id = b.id
         WHERE ab.session_id = $1
         ORDER BY ab.created_at ASC
         LIMIT 1`,
        [agentId]
      );
    }
    
    // For portal-sandbox agents, also include the Skills and Input buckets
    if (agentConfig?.agent_type === 'portal-sandbox') {
      const skillsBucket = await queryOne<{
        bucket_id: string;
        bucket_name: string;
        storage_used: number;
      }>(
        `SELECT 
          ab.bucket_id,
          b.name as bucket_name,
          b.storage_used
         FROM agent_buckets ab
         JOIN buckets b ON ab.bucket_id = b.id
         WHERE ab.session_id = $1 AND (b.name LIKE '%- Skills' OR b.name LIKE '%_skills')`,
        [agentId]
      );
      
      if (skillsBucket && !portalBuckets.find(b => b.bucket_id === skillsBucket.bucket_id)) {
        portalBuckets.push({
          bucket_id: skillsBucket.bucket_id,
          bucket_name: skillsBucket.bucket_name,
          access_type: 'skills',
          storage_used: skillsBucket.storage_used
        });
      }
      
      const inputBucket = await queryOne<{
        bucket_id: string;
        bucket_name: string;
        storage_used: number;
      }>(
        `SELECT 
          ab.bucket_id,
          b.name as bucket_name,
          b.storage_used
         FROM agent_buckets ab
         JOIN buckets b ON ab.bucket_id = b.id
         WHERE ab.session_id = $1 AND (b.name LIKE '%- Input' OR b.name LIKE '%_input')`,
        [agentId]
      );
      
      if (inputBucket && !portalBuckets.find(b => b.bucket_id === inputBucket.bucket_id)) {
        portalBuckets.push({
          bucket_id: inputBucket.bucket_id,
          bucket_name: inputBucket.bucket_name,
          access_type: 'input',
          storage_used: inputBucket.storage_used
        });
      }
    }
    
    console.log('[Portal] Portal bucket:', portalBuckets, 'configured:', agentConfig?.portal_bucket_id);
    
    res.json({ 
      buckets: portalBuckets.map(b => ({
        id: b.bucket_id,
        name: b.bucket_name,
        access_type: b.access_type,
        storage_used: Number(b.storage_used) || 0,
      }))
    });
  } catch (error) {
    console.error('[Portal] Error fetching buckets:', error);
    res.status(500).json({ error: 'Failed to fetch buckets' });
  }
});

// List files in a bucket (portal view)
router.get('/:agentId/sessions/:sessionId/buckets/:bucketId/files', async (req: Request, res: Response) => {
  const { agentId, sessionId, bucketId } = req.params;
  const { path = '/' } = req.query;
  
  try {
    // Verify session exists
    const session = await queryOne<PortalSession>(
      'SELECT * FROM portal_sessions WHERE id = $1 AND agent_id = $2',
      [sessionId, agentId]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Verify bucket is accessible in portal
    // Check if bucket is attached to this agent
    const bucketAttached = await queryOne<{ bucket_id: string }>(
      `SELECT ab.bucket_id FROM agent_buckets ab WHERE ab.session_id = $1 AND ab.bucket_id = $2`,
      [agentId, bucketId]
    );
    
    if (!bucketAttached) {
      return res.status(403).json({ error: 'Bucket not attached to this agent' });
    }
    
    // Get parent folder if not root
    let parentId: string | null = null;
    if (path !== '/') {
      const parent = await queryOne<{ id: string }>(
        `SELECT id FROM files WHERE bucket_id = $1 AND path = $2 AND is_folder = $3`,
        [bucketId, path, true]
      );
      parentId = parent?.id || null;
    }
    
    // Get visitor_id from session for file visibility filtering
    const visitorId = session.visitor_id;
    
    // Get files in this folder
    // Filter to show: shared files (portal_visitor_id IS NULL) OR files created by this visitor
    const files = parentId
      ? await query<{
          id: string;
          name: string;
          path: string;
          is_folder: boolean;
          mime_type: string | null;
          size: number;
          friendly_name: string | null;
          created_at: string;
          updated_at: string;
        }>(
          `SELECT id, name, path, is_folder, mime_type, size, friendly_name, created_at, updated_at
           FROM files 
           WHERE bucket_id = $1 AND parent_id = $2
             AND (portal_visitor_id IS NULL OR portal_visitor_id = $3)
           ORDER BY is_folder DESC, name ASC`,
          [bucketId, parentId, visitorId]
        )
      : await query<{
          id: string;
          name: string;
          path: string;
          is_folder: boolean;
          mime_type: string | null;
          size: number;
          friendly_name: string | null;
          created_at: string;
          updated_at: string;
        }>(
          `SELECT id, name, path, is_folder, mime_type, size, friendly_name, created_at, updated_at
           FROM files 
           WHERE bucket_id = $1 AND parent_id IS NULL
             AND (portal_visitor_id IS NULL OR portal_visitor_id = $2)
           ORDER BY is_folder DESC, name ASC`,
          [bucketId, visitorId]
        );
    
    console.log('[Portal] Files found in bucket', bucketId, ':', files.length);
    
    res.json({
      files: files.map(f => ({
        ...f,
        is_folder: f.is_folder === true || f.is_folder === 1,
        size: Number(f.size) || 0,
      })),
      path,
    });
  } catch (error) {
    console.error('[Portal] Error listing files:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// Download a file (portal view)
router.get('/:agentId/sessions/:sessionId/files/:fileId/download', async (req: Request, res: Response) => {
  const { agentId, sessionId, fileId } = req.params;
  
  try {
    // Verify session exists
    const session = await queryOne<PortalSession>(
      'SELECT * FROM portal_sessions WHERE id = $1 AND agent_id = $2',
      [sessionId, agentId]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Get file and verify bucket access
    // Only allow access to shared files (portal_visitor_id IS NULL) or files from this visitor
    const file = await queryOne<{
      id: string;
      bucket_id: string;
      name: string;
      mime_type: string | null;
      storage_key: string | null;
      is_folder: boolean;
      user_id: string;
      portal_visitor_id: string | null;
    }>(
      `SELECT f.id, f.bucket_id, f.name, f.mime_type, f.storage_key, f.is_folder, f.portal_visitor_id, b.user_id
       FROM files f
       JOIN buckets b ON f.bucket_id = b.id
       WHERE f.id = $1 AND (f.portal_visitor_id IS NULL OR f.portal_visitor_id = $2)`,
      [fileId, session.visitor_id]
    );
    
    if (!file) {
      return res.status(404).json({ error: 'File not found or not accessible' });
    }
    
    if (file.is_folder) {
      return res.status(400).json({ error: 'Cannot download a folder' });
    }
    
    // Verify bucket is attached to this agent
    const bucketAttachedDownload = await queryOne<{ bucket_id: string }>(
      `SELECT ab.bucket_id FROM agent_buckets ab WHERE ab.session_id = $1 AND ab.bucket_id = $2`,
      [agentId, file.bucket_id]
    );
    
    if (!bucketAttachedDownload) {
      return res.status(403).json({ error: 'File not accessible in portal' });
    }
    
    // If storage_key is null, file hasn't been synced yet - fetch directly from E2B sandbox
    if (!file.storage_key) {
      console.log(`[Portal] File ${file.name} not synced yet, fetching from sandbox`);
      
      // Find the bucket and construct sandbox path
      const bucket = await queryOne<{ name: string }>(
        'SELECT name FROM buckets WHERE id = $1',
        [file.bucket_id]
      );
      
      if (!bucket) {
        return res.status(404).json({ error: 'Bucket not found' });
      }
      
      // Get the portal sandbox for this session
      const portalSandboxId = `portal-${sessionId}`;
      const sandbox = await ocService.getSandbox(portalSandboxId);
      
      if (!sandbox) {
        return res.status(503).json({ error: 'Sandbox not available - file will be accessible after sync completes' });
      }
      
      try {
        // Construct the sandbox path: ~/workspace/files/{bucket_name}/{file_path}
        const sandboxPath = `/home/user/workspace/files/${bucket.name}${file.path}`;
        console.log(`[Portal] Reading from sandbox path: ${sandboxPath}`);
        
        const content = await ocService.readFile(portalSandboxId, sandboxPath);
        
        res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
        res.setHeader('Content-Length', Buffer.byteLength(content));
        
        return res.send(content);
      } catch (error) {
        console.error(`[Portal] Failed to read from sandbox:`, error);
        return res.status(500).json({ error: 'File not yet available - please try again in a moment' });
      }
    }
    
    // Stream download from storage (normal path after sync)
    const { streamDownloadFromR2 } = await import('../services/storage.js');
    const downloadResult = await streamDownloadFromR2(file.storage_key, file.user_id);
    
    if (!downloadResult.success || !downloadResult.stream) {
      console.error(`[Portal] Download failed for ${file.name}:`, downloadResult.error);
      return res.status(500).json({ error: 'Failed to download file' });
    }
    
    res.setHeader('Content-Type', downloadResult.contentType || file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    if (downloadResult.contentLength) {
      res.setHeader('Content-Length', downloadResult.contentLength);
    }
    
    downloadResult.stream.pipe(res);
  } catch (error) {
    console.error('[Portal] Error downloading file:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Get a signed URL for Office Online preview (portal view)
// Used by Microsoft Office Online viewer to access PPTX, DOCX, XLSX files
router.get('/:agentId/sessions/:sessionId/files/:fileId/signed-url', async (req: Request, res: Response) => {
  const { agentId, sessionId, fileId } = req.params;
  
  try {
    // Verify session exists
    const session = await queryOne<PortalSession>(
      'SELECT * FROM portal_sessions WHERE id = $1 AND agent_id = $2',
      [sessionId, agentId]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Get file and verify bucket access
    const file = await queryOne<{
      id: string;
      bucket_id: string;
      name: string;
      mime_type: string | null;
      storage_key: string | null;
      is_folder: boolean;
      user_id: string;
      portal_visitor_id: string | null;
    }>(
      `SELECT f.id, f.bucket_id, f.name, f.mime_type, f.storage_key, f.is_folder, f.portal_visitor_id, b.user_id
       FROM files f
       JOIN buckets b ON f.bucket_id = b.id
       WHERE f.id = $1 AND (f.portal_visitor_id IS NULL OR f.portal_visitor_id = $2)`,
      [fileId, session.visitor_id]
    );
    
    if (!file) {
      return res.status(404).json({ error: 'File not found or not accessible' });
    }
    
    if (file.is_folder) {
      return res.status(400).json({ error: 'Cannot get URL for a folder' });
    }
    
    // Verify bucket is attached to this agent
    const bucketAttached = await queryOne<{ bucket_id: string }>(
      `SELECT ab.bucket_id FROM agent_buckets ab WHERE ab.session_id = $1 AND ab.bucket_id = $2`,
      [agentId, file.bucket_id]
    );
    
    if (!bucketAttached) {
      return res.status(403).json({ error: 'File not accessible in portal' });
    }
    
    // If file hasn't been synced yet, we can't generate a signed URL
    if (!file.storage_key) {
      return res.status(503).json({ 
        error: 'File not yet synced to storage - please wait a moment and try again',
        fallback: true
      });
    }
    
    // Generate signed URL (1 hour expiry for Office Online viewer)
    const { getSignedUrlForFile } = await import('../services/storage.js');
    const urlResult = await getSignedUrlForFile(file.storage_key, file.user_id, 3600);
    
    if (!urlResult.success || !urlResult.url) {
      console.error(`[Portal] Signed URL generation failed for ${file.name}:`, urlResult.error);
      return res.status(500).json({ error: 'Failed to generate signed URL', fallback: true });
    }
    
    res.json({ 
      url: urlResult.url,
      fileName: file.name,
      mimeType: file.mime_type,
      expiresIn: 3600
    });
  } catch (error) {
    console.error('[Portal] Error generating signed URL:', error);
    res.status(500).json({ error: 'Failed to generate signed URL', fallback: true });
  }
});

// Get file content for preview (portal view)
router.get('/:agentId/sessions/:sessionId/files/:fileId/content', async (req: Request, res: Response) => {
  const { agentId, sessionId, fileId } = req.params;
  
  try {
    // Verify session exists
    const session = await queryOne<PortalSession>(
      'SELECT * FROM portal_sessions WHERE id = $1 AND agent_id = $2',
      [sessionId, agentId]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Get file and verify bucket access
    const file = await queryOne<{
      id: string;
      bucket_id: string;
      name: string;
      path: string;
      mime_type: string | null;
      size: number;
      storage_key: string | null;
      is_folder: boolean;
      user_id: string;
    }>(
      `SELECT f.*, b.user_id
       FROM files f
       JOIN buckets b ON f.bucket_id = b.id
       WHERE f.id = $1`,
      [fileId]
    );
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    if (file.is_folder) {
      return res.status(400).json({ error: 'Cannot preview a folder' });
    }
    
    // Verify bucket is attached to this agent
    const bucketAttachedContent = await queryOne<{ bucket_id: string }>(
      `SELECT ab.bucket_id FROM agent_buckets ab WHERE ab.session_id = $1 AND ab.bucket_id = $2`,
      [agentId, file.bucket_id]
    );
    
    if (!bucketAttachedContent) {
      return res.status(403).json({ error: 'File not accessible in portal' });
    }
    
    // Limit preview to reasonable file sizes (5MB)
    const MAX_PREVIEW_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_PREVIEW_SIZE) {
      return res.status(400).json({ 
        error: 'File too large for preview',
        size: file.size,
        maxSize: MAX_PREVIEW_SIZE
      });
    }
    
    let content: string;
    
    // If storage_key is null, file hasn't been synced yet - fetch directly from E2B sandbox
    if (!file.storage_key) {
      console.log(`[Portal] File ${file.name} not synced yet, fetching from sandbox for preview`);
      
      // Find the bucket and construct sandbox path
      const bucket = await queryOne<{ name: string }>(
        'SELECT name FROM buckets WHERE id = $1',
        [file.bucket_id]
      );
      
      if (!bucket) {
        return res.status(404).json({ error: 'Bucket not found' });
      }
      
      // Get the portal sandbox for this session
      const portalSandboxId = `portal-${sessionId}`;
      const sandbox = await ocService.getSandbox(portalSandboxId);
      
      if (!sandbox) {
        return res.status(503).json({ error: 'Sandbox not available - file will be accessible after sync completes' });
      }
      
      try {
        // Construct the sandbox path: ~/workspace/files/{bucket_name}/{file_path}
        const sandboxPath = `/home/user/workspace/files/${bucket.name}${file.path}`;
        console.log(`[Portal] Reading from sandbox path for preview: ${sandboxPath}`);
        
        content = await ocService.readFile(portalSandboxId, sandboxPath);
        
        // Check size after reading
        if (Buffer.byteLength(content) > MAX_PREVIEW_SIZE) {
          return res.status(400).json({ 
            error: 'File too large for preview',
            size: Buffer.byteLength(content),
            maxSize: MAX_PREVIEW_SIZE
          });
        }
      } catch (error) {
        console.error(`[Portal] Failed to read from sandbox for preview:`, error);
        return res.status(500).json({ error: 'File not yet available - please try again in a moment' });
      }
    } else {
      // Download file content from storage (normal path after sync)
      const { downloadFromR2 } = await import('../services/storage.js');
      const downloadResult = await downloadFromR2(file.storage_key, file.user_id);
      
      if (!downloadResult.success) {
        console.error(`[Portal] Content fetch failed for ${file.name}:`, downloadResult.error);
        return res.status(500).json({ error: 'Failed to fetch file content' });
      }
      
      // Convert buffer to string
      content = downloadResult.content instanceof Buffer 
        ? downloadResult.content.toString('utf-8')
        : String(downloadResult.content);
    }
    
    res.json({ 
      content,
      file: {
        id: file.id,
        name: file.name,
        path: file.path,
        mime_type: file.mime_type,
        size: file.size || Buffer.byteLength(content),
      }
    });
  } catch (error) {
    console.error('[Portal] Error fetching file content:', error);
    res.status(500).json({ error: 'Failed to fetch file content' });
  }
});

// ============================================
// FILE NOTIFICATION GATEWAY
// ============================================
// This endpoint allows Claude Code in the sandbox to immediately notify
// the backend when it creates files, bypassing the sync delay

router.post('/file-gateway/notify', async (req: Request, res: Response) => {
  const { sessionId, sig, files } = req.body;
  
  // Verify signature
  if (!sessionId || !sig || !verifyGatewaySignature(sessionId, sig)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files provided' });
  }
  
  console.log(`[Portal] File notification from sandbox ${sessionId}:`, files);
  
  try {
    // sessionId is in format "portal-{portalSessionId}"
    // Extract the actual portal session ID
    const portalSessionId = sessionId.replace('portal-', '');
    
    // Get the portal session to find the agent
    const portalSession = await queryOne<any>(
      `SELECT ps.*, s.user_id as agent_owner_id
       FROM portal_sessions ps
       JOIN sessions s ON ps.agent_id = s.id
       WHERE ps.id = $1`,
      [portalSessionId]
    );
    
    if (!portalSession) {
      console.warn(`[Portal] No portal session found for ${portalSessionId}`);
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const agentId = portalSession.agent_id;
    const ownerUserId = portalSession.agent_owner_id;
    const visitorId = portalSession.visitor_id; // For file visibility scoping
    
    // Process each file notification
    const processedFiles = [];
    
    for (const fileNotification of files) {
      const { path: filePath, bucketName } = fileNotification;
      
      if (!filePath || !bucketName) {
        console.warn('[Portal] Invalid file notification:', fileNotification);
        continue;
      }
      
      // Find the bucket by name attached to this agent
      // Try exact match first, then partial match, then fall back to writable output bucket
      let bucket = await queryOne<any>(
        `SELECT b.id, b.name
         FROM buckets b
         JOIN agent_buckets ab ON b.id = ab.bucket_id
         WHERE ab.session_id = $1 AND b.name = $2`,
        [agentId, bucketName]
      );
      
      if (!bucket) {
        // Try partial match (agent might send "sk5" but bucket is "sk5_output")
        bucket = await queryOne<any>(
          `SELECT b.id, b.name
           FROM buckets b
           JOIN agent_buckets ab ON b.id = ab.bucket_id
           WHERE ab.session_id = $1 AND (b.name LIKE $2 OR b.name LIKE $3)`,
          [agentId, `${bucketName}%`, `%${bucketName}%`]
        );
      }
      
      if (!bucket) {
        // Fall back to the writable output bucket for this agent
        bucket = await queryOne<any>(
          `SELECT b.id, b.name
           FROM buckets b
           JOIN agent_buckets ab ON b.id = ab.bucket_id
           WHERE ab.session_id = $1 AND ab.read_only = false`,
          [agentId]
        );
        if (bucket) {
          console.log(`[Portal] Using fallback output bucket "${bucket.name}" for agent ${agentId}`);
        }
      }
      
      if (!bucket) {
        console.warn(`[Portal] No bucket found for agent ${agentId} (tried: ${bucketName})`);
        continue;
      }
      
      // Normalize the file path (remove bucket name prefix if present)
      let normalizedPath = filePath;
      if (filePath.startsWith(`/${bucketName}/`)) {
        normalizedPath = filePath.substring(bucketName.length + 1);
      } else if (filePath.startsWith(bucketName + '/')) {
        normalizedPath = filePath.substring(bucketName.length);
      }
      
      if (!normalizedPath.startsWith('/')) {
        normalizedPath = '/' + normalizedPath;
      }
      
      // Check if file already exists in DB
      const existingFile = await queryOne<any>(
        `SELECT id FROM files WHERE bucket_id = $1 AND path = $2`,
        [bucket.id, normalizedPath]
      );
      
      if (existingFile) {
        console.log(`[Portal] File already indexed: ${normalizedPath}`);
        processedFiles.push({
          id: existingFile.id,
          name: normalizedPath.split('/').pop(),
          path: normalizedPath,
          bucket_id: bucket.id,
          bucket_name: bucket.name,
        });
        continue;
      }
      
      // Create a placeholder file record (will be updated by sync later)
      const fileId = uuidv4();
      const fileName = normalizedPath.split('/').filter(Boolean).pop() || 'file';
      const mimeType = getMimeTypeFromPath(normalizedPath);
      
      await execute(
        `INSERT INTO files (id, bucket_id, user_id, name, path, is_folder, mime_type, size, portal_visitor_id)
         VALUES ($1, $2, $3, $4, $5, FALSE, $6, 0, $7)`,
        [fileId, bucket.id, ownerUserId, fileName, normalizedPath, mimeType, visitorId]
      );
      
      console.log(`[Portal] Created placeholder file record: ${normalizedPath}`);
      
      processedFiles.push({
        id: fileId,
        name: fileName,
        path: normalizedPath,
        bucket_id: bucket.id,
        bucket_name: bucket.name,
        mime_type: mimeType,
        size: 0,
      });
    }
    
    // Broadcast file notifications to active SSE streams for this session
    const streams = activePortalStreams.get(sessionId) || [];
    console.log(`[Portal] Broadcasting ${processedFiles.length} files to ${streams.length} active streams`);
    
    for (const stream of streams) {
      for (const file of processedFiles) {
        try {
          stream.write(`data: ${JSON.stringify({
            type: 'file_created',
            file
          })}\n\n`);
        } catch (err) {
          console.error('[Portal] Error writing to stream:', err);
        }
      }
    }
    
    res.json({ 
      success: true, 
      filesProcessed: processedFiles.length,
      files: processedFiles
    });
  } catch (error) {
    console.error('[Portal] Error processing file notification:', error);
    res.status(500).json({ error: 'Failed to process file notification' });
  }
});

// Helper function to determine MIME type from file path
function getMimeTypeFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    yaml: 'application/x-yaml',
    yml: 'application/x-yaml',
    py: 'text/x-python',
    ts: 'text/typescript',
    js: 'text/javascript',
    jsx: 'text/javascript',
    tsx: 'text/typescript',
    html: 'text/html',
    css: 'text/css',
    sh: 'application/x-sh',
    bash: 'application/x-sh',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Summarize thinking content using Claude Haiku 4.5 for speed and quality
router.post('/:agentId/sessions/:sessionId/summarize-thinking', async (req: Request, res: Response) => {
  const { content } = req.body;

  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Content is required' });
  }

  try {
    const Anthropic = await import('@anthropic-ai/sdk');
    const anthropic = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 30,
      system: `Generate a 2-4 word title for this AI reasoning trace. Be extremely concise. Use a verb (e.g. "Analyzing", "Setting up", "Running").

Examples:
"The user wants to know when two trains meet..." → "Solving collision physics"
"I need to analyze the codebase to find..." → "Searching codebase"
"Let me try with python3" → "Switching to Python 3"
"I need to install numpy and matplotlib" → "Installing dependencies"
"Good, now let me run the simulation again" → "Re-running simulation"
"Now I need to run the simulation and then call the notification API" → "Running simulation"`,
      messages: [{
        role: 'user',
        content: content
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : 'Thinking...';
    const title = text.trim().replace(/^["']|["']$/g, ''); // Remove quotes if any

    console.log('[Portal] Generated thinking title:', {
      inputLength: content.length,
      rawResponse: text,
      title,
      titleLength: title.length,
      wordCount: title.split(/\s+/).length,
      model: 'claude-3-5-haiku-20241022'
    });

    res.json({ title });
  } catch (error) {
    console.error('[Portal] Failed to summarize thinking:', error);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// Debug catch-all to see what's being requested
router.all('*', (req, res) => {
  console.log(`[Portal] CATCH-ALL: ${req.method} ${req.path} - no route matched`);
  res.status(404).json({ error: 'Route not found', method: req.method, path: req.path });
});

export default router;
