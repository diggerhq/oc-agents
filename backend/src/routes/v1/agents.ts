import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireApiKey } from '../../middleware/apiKeyAuth.js';
import { queryOne, query, execute } from '../../db/index.js';
import { ocService, getSandboxKey } from '../../services/oc.js';
import type { Session, AgentConfig, QueuedTask, SdkSession } from '../../types/index.js';

const router = Router();

// ==========================================
// Agent Management (CRUD)
// ==========================================

// List all agents for the user
router.get('/', requireApiKey, async (req, res) => {
  const agents = await query<Session & { config_name?: string; api_enabled?: number }>(
    `SELECT s.*, ac.name as config_name, ac.api_enabled 
     FROM sessions s 
     LEFT JOIN agent_configs ac ON s.id = ac.session_id 
     WHERE s.user_id = $1 
     ORDER BY s.created_at DESC`,
    [req.apiUserId]
  );
  
  res.json({
    agents: agents.map(a => ({
      id: a.id,
      name: a.config_name || a.repo_name,
      agent_type: a.agent_type,
      status: a.status,
      provider: a.agent_provider,
      model: a.agent_model,
      api_enabled: a.api_enabled === 1 || a.api_enabled === true,
      created_at: a.created_at,
    })),
  });
});

// Create a new agent
router.post('/', requireApiKey, async (req, res) => {
  const { 
    name,
    agent_type = 'task',
    agent_provider = 'claude-code',
    agent_model,
    system_prompt,
    secrets,
    api_enabled = true,
    repo_url,
    repo_name,
    branch = 'main',
  } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  // Validate agent_type
  if (!['code', 'task', 'portal'].includes(agent_type)) {
    return res.status(400).json({ error: 'agent_type must be one of: code, task, portal' });
  }
  
  // For code agents, require repo info
  if (agent_type === 'code' && !repo_url) {
    return res.status(400).json({ error: 'repo_url is required for code agents' });
  }
  
  const sessionId = uuidv4();
  const configId = uuidv4();
  
  // Create the session/agent
  await execute(
    `INSERT INTO sessions (id, user_id, agent_type, repo_url, repo_name, branch, status, agent_provider, agent_model)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)`,
    [sessionId, req.apiUserId, agent_type, repo_url || null, repo_name || name, branch, agent_provider, agent_model || null]
  );
  
  // Create the agent config
  const secretsStr = secrets ? (typeof secrets === 'string' ? secrets : JSON.stringify(secrets)) : null;
  await execute(
    `INSERT INTO agent_configs (id, session_id, name, system_prompt, api_enabled, secrets)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [configId, sessionId, name, system_prompt || null, Boolean(api_enabled), secretsStr]
  );
  
  console.log(`[API] Created agent ${sessionId}: ${name}`);
  
  res.status(201).json({
    id: sessionId,
    name,
    agent_type,
    status: 'pending',
    provider: agent_provider,
    model: agent_model,
    api_enabled,
    created_at: new Date().toISOString(),
  });
});

// Update an agent's configuration
router.patch('/:agentId', requireApiKey, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.agentId, req.apiUserId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const { name, system_prompt, api_enabled, allowed_tools, webhook_url, chain_to_agent_id, chain_condition, secrets } = req.body;
  
  // Ensure config exists
  let config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [session.id]
  );
  
  if (!config) {
    const configId = uuidv4();
    await execute(
      'INSERT INTO agent_configs (id, session_id) VALUES ($1, $2)',
      [configId, session.id]
    );
  }
  
  // Update config
  const updates: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  const setValue = (col: string, val: string | number | boolean | null) => {
    values.push(val);
    updates.push(`${col} = $${values.length}`);
  };
  
  if (name !== undefined) setValue('name', name);
  if (system_prompt !== undefined) setValue('system_prompt', system_prompt);
  if (api_enabled !== undefined) setValue('api_enabled', Boolean(api_enabled));
  if (allowed_tools !== undefined) setValue('allowed_tools', typeof allowed_tools === 'string' ? allowed_tools : JSON.stringify(allowed_tools));
  if (webhook_url !== undefined) setValue('webhook_url', webhook_url || null);
  if (chain_to_agent_id !== undefined) setValue('chain_to_agent_id', chain_to_agent_id || null);
  if (chain_condition !== undefined) setValue('chain_condition', chain_condition);
  if (secrets !== undefined) setValue('secrets', typeof secrets === 'string' ? secrets : JSON.stringify(secrets));
  
  if (updates.length > 0) {
    updates.push('updated_at = NOW()');
    values.push(session.id);
    await execute(
      `UPDATE agent_configs SET ${updates.join(', ')} WHERE session_id = $${values.length}`,
      values
    );
  }
  
  // Get updated config
  config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [session.id]
  );
  
  res.json({
    id: session.id,
    name: config?.name || session.repo_name,
    system_prompt: config?.system_prompt,
    api_enabled: config?.api_enabled === 1 || config?.api_enabled === true,
    webhook_url: config?.webhook_url,
    chain_to_agent_id: config?.chain_to_agent_id,
    chain_condition: config?.chain_condition,
  });
});

// Delete an agent
router.delete('/:agentId', requireApiKey, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.agentId, req.apiUserId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  // Delete related data
  await execute('DELETE FROM workflow_steps WHERE agent_id = $1', [session.id]);
  await execute('DELETE FROM prompt_templates WHERE agent_id = $1', [session.id]);
  await execute('DELETE FROM task_queue WHERE agent_id = $1', [session.id]);
  await execute('DELETE FROM agent_configs WHERE session_id = $1', [session.id]);
  await execute('DELETE FROM messages WHERE task_id IN (SELECT id FROM tasks WHERE session_id = $1)', [session.id]);
  await execute('DELETE FROM tasks WHERE session_id = $1', [session.id]);
  await execute('DELETE FROM sessions WHERE id = $1', [session.id]);
  
  console.log(`[API] Deleted agent ${session.id}`);
  
  res.json({ success: true, deleted_id: session.id });
});

// ==========================================
// Agent Info & Tasks
// ==========================================

// Get agent info (if api_enabled)
router.get('/:agentId', requireApiKey, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.agentId, req.apiUserId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [session.id]
  );
  
  if (!config?.api_enabled) {
    return res.status(403).json({ error: 'API access not enabled for this agent' });
  }
  
  res.json({
    id: session.id,
    name: session.repo_name,
    status: session.status,
    provider: session.agent_provider,
    model: session.agent_model,
    repo_url: session.repo_url,
    branch: session.branch,
  });
});

// Submit a task to an agent
router.post('/:agentId/tasks', requireApiKey, async (req, res) => {
  const { prompt, priority, sessionId, provision } = req.body;
  
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Prompt is required' });
  }
  
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.agentId, req.apiUserId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [session.id]
  );
  
  if (!config?.api_enabled) {
    return res.status(403).json({ error: 'API access not enabled for this agent' });
  }
  
  // Handle SDK session for isolation
  let finalSdkSessionId = sessionId;
  
  // If provision is true, create a new SDK session automatically
  if (provision && !sessionId) {
    finalSdkSessionId = uuidv4();
    await execute(
      `INSERT INTO sdk_sessions (id, agent_id, api_key_id, status, created_at, last_used_at)
       VALUES ($1, $2, $3, 'active', NOW(), NOW())`,
      [finalSdkSessionId, session.id, req.apiKey?.id || null]
    );
    console.log(`[API] Created new SDK session ${finalSdkSessionId} for agent ${session.id}`);
  }
  
  // If sessionId provided, verify it exists, is active, and belongs to this API key
  if (finalSdkSessionId) {
    const sdkSession = await queryOne<{ id: string; status: string; api_key_id: string }>(
      'SELECT id, status, api_key_id FROM sdk_sessions WHERE id = $1 AND agent_id = $2',
      [finalSdkSessionId, session.id]
    );
    
    if (!sdkSession) {
      return res.status(404).json({ error: 'SDK session not found' });
    }
    
    // Verify API key ownership (unless it was just created by provision)
    if (!provision && sdkSession.api_key_id !== req.apiKey?.id) {
      return res.status(403).json({ error: 'SDK session belongs to a different API key' });
    }
    
    if (sdkSession.status !== 'active') {
      return res.status(400).json({ error: 'SDK session is closed' });
    }
    
    // Update last_used_at
    await execute(
      'UPDATE sdk_sessions SET last_used_at = NOW() WHERE id = $1',
      [finalSdkSessionId]
    );
  }
  
  // Create queued task with optional SDK session ID
  const taskId = uuidv4();
  
  await execute(
    `INSERT INTO task_queue (id, agent_id, user_id, prompt, priority, source, api_key_id, sdk_session_id) 
     VALUES ($1, $2, $3, $4, $5, 'api', $6, $7)`,
    [taskId, session.id, req.apiUserId, prompt, priority || 0, req.apiKey?.id, finalSdkSessionId || null]
  );
  
  console.log(`[API] Task ${taskId} queued for agent ${session.id}${finalSdkSessionId ? ` (session: ${finalSdkSessionId})` : ''}`);
  
  res.status(202).json({
    id: taskId,
    status: 'pending',
    agent_id: session.id,
    sdk_session_id: finalSdkSessionId || undefined,
    created_at: new Date().toISOString(),
  });
});

// Get task status
router.get('/:agentId/tasks/:taskId', requireApiKey, async (req, res) => {
  const task = await queryOne<QueuedTask>(
    'SELECT * FROM task_queue WHERE id = $1 AND agent_id = $2 AND user_id = $3',
    [req.params.taskId, req.params.agentId, req.apiUserId]
  );
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  res.json({
    id: task.id,
    status: task.status,
    result: task.result,
    error: task.error,
    created_at: task.created_at,
    started_at: task.started_at,
    completed_at: task.completed_at,
  });
});

// List tasks for an agent
router.get('/:agentId/tasks', requireApiKey, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.agentId, req.apiUserId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [session.id]
  );
  
  if (!config?.api_enabled) {
    return res.status(403).json({ error: 'API access not enabled for this agent' });
  }
  
  const tasks = await query<QueuedTask>(
    'SELECT id, status, created_at, started_at, completed_at FROM task_queue WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 50',
    [session.id]
  );
  
  res.json({ tasks });
});

// ==========================================
// Templates (via API)
// ==========================================

// Add a template to an agent
router.post('/:agentId/templates', requireApiKey, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.agentId, req.apiUserId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const { name, template, variables } = req.body;
  
  if (!name || !template) {
    return res.status(400).json({ error: 'Name and template are required' });
  }
  
  const id = uuidv4();
  const variablesJson = variables ? JSON.stringify(variables) : null;
  
  await execute(
    'INSERT INTO prompt_templates (id, agent_id, name, template, variables) VALUES ($1, $2, $3, $4, $5)',
    [id, session.id, name, template, variablesJson]
  );
  
  res.status(201).json({
    id,
    name,
    template,
    variables,
    created_at: new Date().toISOString(),
  });
});

// List templates for an agent
router.get('/:agentId/templates', requireApiKey, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.agentId, req.apiUserId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const templates = await query<{ id: string; name: string; template: string; variables: string | null }>(
    'SELECT id, name, template, variables FROM prompt_templates WHERE agent_id = $1',
    [session.id]
  );
  
  res.json({
    templates: templates.map(t => ({
      ...t,
      variables: t.variables ? JSON.parse(t.variables) : [],
    })),
  });
});

// ==========================================
// Workflow (via API)
// ==========================================

// Set workflow for an agent
router.put('/:agentId/workflow', requireApiKey, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.agentId, req.apiUserId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const { steps } = req.body;
  
  if (!Array.isArray(steps)) {
    return res.status(400).json({ error: 'Steps must be an array' });
  }
  
  // Delete existing steps
  await execute('DELETE FROM workflow_steps WHERE agent_id = $1', [session.id]);
  
  // Insert new steps
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index] as { action_type: string; config: Record<string, unknown> };
    const id = uuidv4();
    await execute(
      'INSERT INTO workflow_steps (id, agent_id, step_order, action_type, config) VALUES ($1, $2, $3, $4, $5)',
      [id, session.id, index, step.action_type, JSON.stringify(step.config)]
    );
  }
  
  res.json({ success: true, step_count: steps.length });
});

// Get workflow for an agent
router.get('/:agentId/workflow', requireApiKey, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.agentId, req.apiUserId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const steps = await query<{ id: string; step_order: number; action_type: string; config: string }>(
    'SELECT id, step_order, action_type, config FROM workflow_steps WHERE agent_id = $1 ORDER BY step_order',
    [session.id]
  );
  
  res.json({
    steps: steps.map(s => ({
      ...s,
      config: JSON.parse(s.config),
    })),
  });
});

// ==========================================
// SDK Session Management
// ==========================================

/**
 * Create a new SDK session for isolated sandbox access.
 * This allows SDK users to create their own sandbox instances
 * that are isolated from other SDK sessions and from the playground.
 */
router.post('/:agentId/sessions', requireApiKey, async (req, res) => {
  try {
    const session = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.agentId, req.apiUserId]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const config = await queryOne<AgentConfig>(
      'SELECT * FROM agent_configs WHERE session_id = $1',
      [session.id]
    );
    
    if (!config?.api_enabled) {
      return res.status(403).json({ error: 'API access not enabled for this agent' });
    }
    
    // Create SDK session
    const sdkSessionId = uuidv4();
    await execute(
      `INSERT INTO sdk_sessions (id, agent_id, api_key_id, status, created_at, last_used_at)
       VALUES ($1, $2, $3, 'active', NOW(), NOW())`,
      [sdkSessionId, session.id, req.apiKey?.id || null]
    );
    
    // Generate sandbox key for this SDK session
    const sandboxKey = getSandboxKey({ 
      agentId: session.id, 
      surface: 'sdk', 
      sdkSessionId 
    });
    
    // Optionally warm up the sandbox (create it immediately)
    const { warmup } = req.body;
    let sandboxId: string | undefined;
    
    if (warmup) {
      const provider = session.agent_provider || 'claude-code';
      await ocService.createSandbox(sandboxKey, provider as any);
      await ocService.installAgentTools(sandboxKey, provider as any);
      
      // Store sandbox ID
      const sandbox = await ocService.getSandbox(sandboxKey);
      sandboxId = sandbox?.sandboxId;
      
      await execute(
        'UPDATE sdk_sessions SET sandbox_id = $1 WHERE id = $2',
        [sandboxId || null, sdkSessionId]
      );
    }
    
    console.log(`[API] Created SDK session ${sdkSessionId} for agent ${session.id} (warmup: ${warmup})`);
    
    res.status(201).json({
      sessionId: sdkSessionId,
      agentId: session.id,
      sandboxId,
      status: 'active',
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] Failed to create SDK session:', error);
    res.status(500).json({ error: 'Failed to create SDK session' });
  }
});

/**
 * List SDK sessions for an agent
 */
router.get('/:agentId/sessions', requireApiKey, async (req, res) => {
  try {
    const session = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.agentId, req.apiUserId]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const sdkSessions = await query<SdkSession>(
      `SELECT * FROM sdk_sessions 
       WHERE agent_id = $1 AND api_key_id = $2 
       ORDER BY created_at DESC`,
      [session.id, req.apiKey?.id || '']
    );
    
    res.json({
      sessions: sdkSessions.map(s => ({
        sessionId: s.id,
        agentId: s.agent_id,
        sandboxId: s.sandbox_id,
        status: s.status,
        createdAt: s.created_at,
        lastUsedAt: s.last_used_at,
        closedAt: s.closed_at,
      })),
    });
  } catch (error) {
    console.error('[API] Failed to list SDK sessions:', error);
    res.status(500).json({ error: 'Failed to list SDK sessions' });
  }
});

/**
 * Close an SDK session and cleanup its sandbox.
 * This will:
 * 1. Mark the session as 'closed'
 * 2. Destroy the sandbox if it exists
 * 3. Set the closed_at timestamp
 */
router.delete('/:agentId/sessions/:sessionId', requireApiKey, async (req, res) => {
  try {
    const { agentId, sessionId } = req.params;
    
    // Verify agent exists and user has access
    const session = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [agentId, req.apiUserId]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Verify SDK session exists and belongs to this API key
    const sdkSession = await queryOne<SdkSession>(
      'SELECT * FROM sdk_sessions WHERE id = $1 AND agent_id = $2',
      [sessionId, agentId]
    );
    
    if (!sdkSession) {
      return res.status(404).json({ error: 'SDK session not found' });
    }
    
    // Verify API key ownership
    if (sdkSession.api_key_id !== req.apiKey?.id) {
      return res.status(403).json({ error: 'SDK session belongs to a different API key' });
    }
    
    if (sdkSession.status === 'closed') {
      return res.json({ success: true, message: 'Session already closed' });
    }
    
    // Close the sandbox if it exists
    const sandboxKey = getSandboxKey({
      agentId,
      surface: 'sdk',
      sdkSessionId: sessionId,
    });
    
    try {
      await ocService.closeSandbox(sandboxKey);
      console.log(`[API] Closed sandbox ${sandboxKey} for SDK session ${sessionId}`);
    } catch (sandboxError) {
      // Sandbox may not exist, which is fine
      console.log(`[API] Sandbox ${sandboxKey} not found or already closed`);
    }
    
    // Mark session as closed
    await execute(
      `UPDATE sdk_sessions SET status = 'closed', closed_at = NOW() WHERE id = $1`,
      [sessionId]
    );
    
    console.log(`[API] Closed SDK session ${sessionId} for agent ${agentId}`);
    
    res.json({ success: true, sessionId });
  } catch (error) {
    console.error('[API] Failed to close SDK session:', error);
    res.status(500).json({ error: 'Failed to close SDK session' });
  }
});

export default router;
