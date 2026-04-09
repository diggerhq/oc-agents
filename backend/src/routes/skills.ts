/**
 * Skills & MCP Routes
 * 
 * API endpoints for managing skills and custom MCP servers on agents.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';
import { queryOne, query, execute } from '../db/index.js';
import { BUILTIN_SKILLS, getBuiltinSkills, checkSkillSecrets } from '../config/skills.js';
import { mcpService, type MCPServerConfig } from '../services/mcp.js';
import type { Session, AgentConfig, MCPConnection, Skill } from '../types/index.js';

interface AuthenticatedRequest extends Request {
  session: Request['session'] & { userId?: string };
}

const router = Router();

// ============================================
// BUILTIN SKILLS
// ============================================

// List all available builtin skills
router.get('/builtin', requireAuth, (_req: Request, res: Response) => {
  const skills = getBuiltinSkills();
  
  res.json({
    skills: skills.map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      icon: skill.icon,
      category: skill.category,
      requiredSecrets: skill.requiredSecrets,
      docsUrl: skill.docsUrl,
    })),
  });
});

// Get a single builtin skill details
router.get('/builtin/:skillId', requireAuth, (req: Request, res: Response) => {
  const skill = BUILTIN_SKILLS[req.params.skillId];
  
  if (!skill) {
    return res.status(404).json({ error: 'Skill not found' });
  }
  
  res.json({
    skill: {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      icon: skill.icon,
      category: skill.category,
      requiredSecrets: skill.requiredSecrets,
      optionalSecrets: skill.optionalSecrets,
      docsUrl: skill.docsUrl,
    },
  });
});

// ============================================
// AGENT SKILLS CONFIGURATION
// ============================================

// Get skills and MCP servers configured for an agent
router.get('/agents/:sessionId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.session.userId;
  
  // Verify agent belongs to user
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.sessionId, userId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  // Get agent config
  const config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [session.id]
  );
  
  // Parse skills and MCP servers
  const enabledSkills: string[] = config?.skills ? JSON.parse(config.skills) : [];
  const mcpServers: MCPServerConfig[] = config?.mcp_servers ? JSON.parse(config.mcp_servers) : [];
  const secrets: Record<string, string> = config?.secrets ? JSON.parse(config.secrets) : {};
  
  // Get builtin skills with their status
  const builtinSkills = getBuiltinSkills().map(skill => {
    const isEnabled = enabledSkills.includes(skill.id);
    const secretCheck = checkSkillSecrets(skill.id, secrets);
    
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      icon: skill.icon,
      category: skill.category,
      requiredSecrets: skill.requiredSecrets,
      enabled: isEnabled,
      configured: secretCheck.configured,
      missingSecrets: secretCheck.missing,
    };
  });
  
  // Get MCP connection status
  const connections = await query<MCPConnection>(
    'SELECT * FROM mcp_connections WHERE session_id = $1',
    [session.id]
  );
  
  res.json({
    builtinSkills,
    customServers: mcpServers.map(server => {
      const conn = connections.find(c => c.server_id === server.id);
      return {
        ...server,
        status: conn?.status || 'disconnected',
        toolsDiscovered: conn?.tools_discovered ? JSON.parse(conn.tools_discovered) : [],
        error: conn?.error,
      };
    }),
    connections,
  });
});

// Enable/disable builtin skills for an agent
router.patch('/agents/:sessionId/skills', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.session.userId;
  const { skills } = req.body; // Array of skill IDs to enable
  
  if (!Array.isArray(skills)) {
    return res.status(400).json({ error: 'skills must be an array of skill IDs' });
  }
  
  // Validate all skill IDs
  for (const skillId of skills) {
    if (!BUILTIN_SKILLS[skillId]) {
      return res.status(400).json({ error: `Unknown skill: ${skillId}` });
    }
  }
  
  // Verify agent belongs to user
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.sessionId, userId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  // Ensure config exists
  let config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [session.id]
  );
  
  if (!config) {
    const id = uuidv4();
    await execute(
      'INSERT INTO agent_configs (id, session_id, skills) VALUES ($1, $2, $3)',
      [id, session.id, JSON.stringify(skills)]
    );
  } else {
    await execute(
      'UPDATE agent_configs SET skills = $1, updated_at = NOW() WHERE session_id = $2',
      [JSON.stringify(skills), session.id]
    );
  }
  
  res.json({ success: true, skills });
});

// ============================================
// CUSTOM MCP SERVERS
// ============================================

// Add a custom MCP server to an agent
router.post('/agents/:sessionId/mcp-servers', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.session.userId;
  const { name, transport, url, headers } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  
  if (!transport || !['sse', 'streamable-http'].includes(transport)) {
    return res.status(400).json({ error: 'transport must be "sse" or "streamable-http"' });
  }
  
  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }
  
  // Verify agent belongs to user
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.sessionId, userId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  // Build MCP server config
  const serverId = uuidv4().slice(0, 8); // Short ID for namespacing tools
  const serverConfig: MCPServerConfig = {
    id: serverId,
    type: 'custom',
    name,
    transport,
    url,
    headers: headers || undefined,
  } as MCPServerConfig;
  
  // Get existing config
  let config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [session.id]
  );
  
  const existingServers: MCPServerConfig[] = config?.mcp_servers 
    ? JSON.parse(config.mcp_servers) 
    : [];
  
  existingServers.push(serverConfig);
  
  if (!config) {
    const id = uuidv4();
    await execute(
      'INSERT INTO agent_configs (id, session_id, mcp_servers) VALUES ($1, $2, $3)',
      [id, session.id, JSON.stringify(existingServers)]
    );
  } else {
    await execute(
      'UPDATE agent_configs SET mcp_servers = $1, updated_at = NOW() WHERE session_id = $2',
      [JSON.stringify(existingServers), session.id]
    );
  }
  
  res.status(201).json({ success: true, server: serverConfig });
});

// Update a custom MCP server
router.patch('/agents/:sessionId/mcp-servers/:serverId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.session.userId;
  const { serverId } = req.params;
  const updates = req.body;
  
  // Verify agent belongs to user
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.sessionId, userId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  // Get existing config
  const config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [session.id]
  );
  
  if (!config?.mcp_servers) {
    return res.status(404).json({ error: 'MCP server not found' });
  }
  
  const servers: MCPServerConfig[] = JSON.parse(config.mcp_servers);
  const serverIndex = servers.findIndex(s => s.id === serverId);
  
  if (serverIndex === -1) {
    return res.status(404).json({ error: 'MCP server not found' });
  }
  
  // Update server config (preserve type and id)
  const existingServer = servers[serverIndex];
  servers[serverIndex] = { ...existingServer, ...updates, id: serverId, type: existingServer.type };
  
  await execute(
    'UPDATE agent_configs SET mcp_servers = $1, updated_at = NOW() WHERE session_id = $2',
    [JSON.stringify(servers), session.id]
  );
  
  // Disconnect existing connection if any (will reconnect on next use)
  await mcpService.disconnect(session.id, serverId);
  
  res.json({ success: true, server: servers[serverIndex] });
});

// Delete a custom MCP server
router.delete('/agents/:sessionId/mcp-servers/:serverId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.session.userId;
  const { serverId } = req.params;
  
  // Verify agent belongs to user
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.sessionId, userId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  // Get existing config
  const config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [session.id]
  );
  
  if (!config?.mcp_servers) {
    return res.status(404).json({ error: 'MCP server not found' });
  }
  
  const servers: MCPServerConfig[] = JSON.parse(config.mcp_servers);
  const filteredServers = servers.filter(s => s.id !== serverId);
  
  if (filteredServers.length === servers.length) {
    return res.status(404).json({ error: 'MCP server not found' });
  }
  
  await execute(
    'UPDATE agent_configs SET mcp_servers = $1, updated_at = NOW() WHERE session_id = $2',
    [JSON.stringify(filteredServers), session.id]
  );
  
  // Disconnect
  await mcpService.disconnect(session.id, serverId);
  
  // Remove connection record
  await execute(
    'DELETE FROM mcp_connections WHERE session_id = $1 AND server_id = $2',
    [session.id, serverId]
  );
  
  res.json({ success: true });
});

// ============================================
// MCP SERVER TESTING
// ============================================

// Test connection to an MCP server
router.post('/agents/:sessionId/mcp-servers/:serverId/test', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.session.userId;
  const { serverId } = req.params;
  
  // Verify agent belongs to user
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.sessionId, userId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  // Get agent config
  const config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [session.id]
  );
  
  if (!config) {
    return res.status(404).json({ error: 'Agent config not found' });
  }
  
  const secrets: Record<string, string> = config.secrets ? JSON.parse(config.secrets) : {};
  
  // Find the server config
  let serverConfig: MCPServerConfig | undefined;
  
  // Check if it's a builtin skill
  if (BUILTIN_SKILLS[serverId]) {
    serverConfig = { id: serverId, type: 'builtin', skillId: serverId };
  } else if (config.mcp_servers) {
    const servers: MCPServerConfig[] = JSON.parse(config.mcp_servers);
    serverConfig = servers.find(s => s.id === serverId);
  }
  
  if (!serverConfig) {
    return res.status(404).json({ error: 'MCP server not found' });
  }
  
  // Test connection
  const result = await mcpService.connect(session.id, serverConfig, secrets);
  
  if (result.success) {
    res.json({
      success: true,
      tools: result.tools.map(t => ({
        name: t.name,
        description: t.description,
      })),
    });
  } else {
    res.status(400).json({
      success: false,
      error: result.error,
    });
  }
});

// Disconnect an MCP server
router.post('/agents/:sessionId/mcp-servers/:serverId/disconnect', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.session.userId;
  const { serverId } = req.params;
  
  // Verify agent belongs to user
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.sessionId, userId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  await mcpService.disconnect(session.id, serverId);
  
  res.json({ success: true });
});

// ============================================
// CUSTOM SKILLS (User-created, shareable)
// ============================================

// List user's custom skills
router.get('/custom', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.session.userId;
  
  const skills = await query<Skill>(
    'SELECT * FROM skills WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  
  res.json({
    skills: skills.map(s => ({
      ...s,
      mcp_config: JSON.parse(s.mcp_config),
      required_env: s.required_env ? JSON.parse(s.required_env) : [],
    })),
  });
});

// Create a custom skill
router.post('/custom', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.session.userId;
  const { name, description, icon, category, mcp_config, required_env } = req.body;
  
  if (!name || !mcp_config) {
    return res.status(400).json({ error: 'name and mcp_config are required' });
  }
  
  const id = uuidv4();
  
  await execute(
    `INSERT INTO skills (id, user_id, name, description, icon, category, mcp_config, required_env)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      userId,
      name,
      description || null,
      icon || 'puzzle',
      category || 'custom',
      typeof mcp_config === 'string' ? mcp_config : JSON.stringify(mcp_config),
      required_env ? JSON.stringify(required_env) : null,
    ]
  );
  
  const skill = await queryOne<Skill>('SELECT * FROM skills WHERE id = $1', [id]);
  
  res.status(201).json({
    skill: {
      ...skill,
      mcp_config: JSON.parse(skill!.mcp_config),
      required_env: skill!.required_env ? JSON.parse(skill!.required_env) : [],
    },
  });
});

// Delete a custom skill
router.delete('/custom/:skillId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.session.userId;
  
  const skill = await queryOne<Skill>(
    'SELECT * FROM skills WHERE id = $1 AND user_id = $2',
    [req.params.skillId, userId]
  );
  
  if (!skill) {
    return res.status(404).json({ error: 'Skill not found' });
  }
  
  await execute('DELETE FROM skills WHERE id = $1', [req.params.skillId]);
  
  res.json({ success: true });
});

export default router;
