import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { queryOne, query, execute } from '../db/index.js';
import { uploadToR2, deleteFromR2, isObjectStorageConfigured } from '../services/storage.js';
import type { Session, AgentConfig, QueuedTask } from '../types/index.js';

const router = Router();

// Configure multer for logo uploads
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PNG, JPEG, GIF, WebP, and SVG are allowed.'));
    }
  },
});

// Wrapper to handle multer errors with user-friendly messages
const handleLogoUpload = (req: any, res: any, next: any) => {
  logoUpload.single('logo')(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File is too large. Maximum size is 10MB.' });
      }
      if (err.message?.includes('Invalid file type')) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: 'Failed to upload file: ' + err.message });
    }
    next();
  });
};

// Get agent config for a session
router.get('/:sessionId/config', requireAuth, async (req, res) => {
  // Verify session belongs to user
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.sessionId, req.session.userId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  // Get or create config
  let config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [session.id]
  );
  
  if (!config) {
    // Create default config
    const id = uuidv4();
    await execute(
      'INSERT INTO agent_configs (id, session_id) VALUES ($1, $2)',
      [id, session.id]
    );
    config = await queryOne<AgentConfig>(
      'SELECT * FROM agent_configs WHERE id = $1',
      [id]
    );
  }
  
  res.json({ config });
});

// Update agent config
router.patch('/:sessionId/config', requireAuth, async (req, res) => {
  // Verify session belongs to user
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.sessionId, req.session.userId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  console.log('[AgentConfig] Received update request:', JSON.stringify(req.body, null, 2));
  
  const { 
    name, 
    system_prompt, 
    allowed_tools, 
    secrets,
    oc_template,
    api_enabled, 
    webhook_url,
    chain_to_agent_id,
    chain_condition,
    portal_enabled,
    embed_theme,
    embed_greeting,
    portal_name,
    portal_custom_css,
    portal_greeting,
    portal_suggested_questions,
    portal_bucket_id,
    portal_files_hidden,
    portal_active_skills,
    output_schema,
    enable_extended_thinking,
    thinking_budget_tokens,
    portal_agent_model,
    portal_agent_thinking_budget,
    portal_agent_max_tokens,
    portal_agent_tools,
    portal_agent_sandbox_enabled,
    setup_wizard_completed
  } = req.body;
  
  // Ensure config exists
  let config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [session.id]
  );
  
  if (!config) {
    const id = uuidv4();
    await execute(
      'INSERT INTO agent_configs (id, session_id) VALUES ($1, $2)',
      [id, session.id]
    );
  }
  
  // Build update query
  const updates: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  const setValue = (column: string, value: string | number | boolean | null) => {
    values.push(value);
    updates.push(`${column} = $${values.length}`);
  };
  
  if (name !== undefined) {
    setValue('name', name || null);
  }
  if (system_prompt !== undefined) {
    setValue('system_prompt', system_prompt);
  }
  if (allowed_tools !== undefined) {
    setValue('allowed_tools', typeof allowed_tools === 'string' ? allowed_tools : JSON.stringify(allowed_tools));
  }
  if (secrets !== undefined) {
    setValue('secrets', typeof secrets === 'string' ? secrets : JSON.stringify(secrets));
  }
  if (oc_template !== undefined) {
    setValue('oc_template', oc_template || null);
  }
  if (api_enabled !== undefined) {
    setValue('api_enabled', Boolean(api_enabled));
  }
  if (webhook_url !== undefined) {
    setValue('webhook_url', webhook_url || null);
  }
  if (chain_to_agent_id !== undefined) {
    // Verify the target agent exists and belongs to user
    if (chain_to_agent_id) {
      const targetAgent = await queryOne<Session>(
        'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
        [chain_to_agent_id, req.session.userId]
      );
      if (!targetAgent) {
        return res.status(400).json({ error: 'Chain target agent not found' });
      }
    }
    setValue('chain_to_agent_id', chain_to_agent_id || null);
  }
  if (chain_condition !== undefined) {
    setValue('chain_condition', chain_condition || 'on_success');
  }
  if (portal_enabled !== undefined) {
    setValue('portal_enabled', Boolean(portal_enabled));
  }
  if (embed_theme !== undefined) {
    setValue('embed_theme', typeof embed_theme === 'string' ? embed_theme : JSON.stringify(embed_theme));
  }
  if (embed_greeting !== undefined) {
    setValue('embed_greeting', embed_greeting || null);
  }
  if (portal_name !== undefined) {
    setValue('portal_name', portal_name || null);
  }
  if (portal_custom_css !== undefined) {
    setValue('portal_custom_css', portal_custom_css || null);
  }
  if (portal_greeting !== undefined) {
    console.log('[AgentConfig] Setting portal_greeting to:', portal_greeting, '-> stored as:', portal_greeting || null);
    setValue('portal_greeting', portal_greeting || null);
  }
  if (portal_suggested_questions !== undefined) {
    setValue('portal_suggested_questions', 
      portal_suggested_questions 
        ? (typeof portal_suggested_questions === 'string' 
            ? portal_suggested_questions 
            : JSON.stringify(portal_suggested_questions))
        : null
    );
  }
  if (portal_bucket_id !== undefined) {
    // Don't save "none" - use portal_files_hidden instead
    setValue('portal_bucket_id', (portal_bucket_id && portal_bucket_id !== 'none') ? portal_bucket_id : null);
  }
  if (portal_files_hidden !== undefined) {
    setValue('portal_files_hidden', Boolean(portal_files_hidden));
  }
  if (portal_active_skills !== undefined) {
    setValue('portal_active_skills', typeof portal_active_skills === 'string' ? portal_active_skills : JSON.stringify(portal_active_skills));
  }
  if (output_schema !== undefined) {
    // Validate JSON schema if provided
    if (output_schema) {
      try {
        JSON.parse(output_schema);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON schema format' });
      }
    }
    setValue('output_schema', output_schema || null);
  }
  if (enable_extended_thinking !== undefined) {
    setValue('enable_extended_thinking', Boolean(enable_extended_thinking));
  }
  if (thinking_budget_tokens !== undefined) {
    // Validate and clamp to reasonable range
    const budget = Math.max(1000, Math.min(128000, parseInt(thinking_budget_tokens) || 100000));
    setValue('thinking_budget_tokens', budget);
  }
  // Portal agent fields
  if (portal_agent_model !== undefined) {
    setValue('portal_agent_model', portal_agent_model || null);
  }
  if (portal_agent_thinking_budget !== undefined) {
    const budget = Math.max(1000, Math.min(128000, parseInt(portal_agent_thinking_budget) || 128000));
    setValue('portal_agent_thinking_budget', budget);
  }
  if (portal_agent_max_tokens !== undefined) {
    const tokens = Math.max(1024, Math.min(128000, parseInt(portal_agent_max_tokens) || 128000));
    setValue('portal_agent_max_tokens', tokens);
  }
  if (portal_agent_tools !== undefined) {
    setValue('portal_agent_tools', typeof portal_agent_tools === 'string' ? portal_agent_tools : JSON.stringify(portal_agent_tools));
  }
  if (portal_agent_sandbox_enabled !== undefined) {
    setValue('portal_agent_sandbox_enabled', Boolean(portal_agent_sandbox_enabled));
  }
  if (setup_wizard_completed !== undefined) {
    setValue('setup_wizard_completed', Boolean(setup_wizard_completed));
  }
  
  if (updates.length > 0) {
    updates.push('updated_at = NOW()');
    values.push(session.id);
    
    await execute(
      `UPDATE agent_configs SET ${updates.join(', ')} WHERE session_id = $${values.length}`,
      values
    );
  }
  
  // Return updated config
  config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [session.id]
  );
  
  res.json({ config });
});

// Get all agents (for chaining dropdown)
router.get('/', requireAuth, async (req, res) => {
  const agents = await query<Session & { config_name?: string }>(
    `SELECT s.*, ac.name as config_name 
     FROM sessions s 
     LEFT JOIN agent_configs ac ON s.id = ac.session_id 
     WHERE s.user_id = $1 
     ORDER BY s.created_at DESC`,
    [req.session.userId]
  );
  
  res.json({ agents });
});

// Get runs (task history) for an agent
router.get('/:sessionId/runs', requireAuth, async (req, res) => {
  // Verify session belongs to user
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.sessionId, req.session.userId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  
  const runs = await query<QueuedTask>(
    `SELECT id, prompt, status, result, error, debug_log, source, created_at, started_at, completed_at 
     FROM task_queue 
     WHERE agent_id = $1 
     ORDER BY created_at DESC 
     LIMIT $2 OFFSET $3`,
    [session.id, limit, offset]
  );
  
  // Get total count
  const countResult = await queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM task_queue WHERE agent_id = $1',
    [session.id]
  );
  
  res.json({ 
    runs,
    total: countResult?.count || 0,
    limit,
    offset,
  });
});

// Get a single run with full debug log
router.get('/:sessionId/runs/:runId', requireAuth, async (req, res) => {
  // Verify session belongs to user
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.sessionId, req.session.userId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const runData = await queryOne<QueuedTask>(
    'SELECT * FROM task_queue WHERE id = $1 AND agent_id = $2',
    [req.params.runId, session.id]
  );
  
  if (!runData) {
    return res.status(404).json({ error: 'Run not found' });
  }
  
  res.json({ run: runData });
});

// Upload portal logo
router.post('/:sessionId/config/logo', requireAuth, handleLogoUpload, async (req, res) => {
  try {
    // Verify session belongs to user
    const session = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.sessionId, req.session.userId]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Check if object storage is configured
    if (!isObjectStorageConfigured()) {
      return res.status(400).json({ error: 'Object storage not configured. Cannot upload logo.' });
    }
    
    // Generate storage key for logo
    const fileExt = req.file.originalname.split('.').pop() || 'png';
    const storageKey = `logos/${req.session.userId}/${session.id}/portal-logo.${fileExt}`;
    
    // Upload to storage
    const uploadResult = await uploadToR2(storageKey, req.file.buffer, req.file.mimetype, req.session.userId);
    
    if (!uploadResult.success) {
      return res.status(500).json({ error: 'Failed to upload logo', details: uploadResult.error });
    }
    
    // Build the logo URL
    // For R2, we'll use a path-based URL that the frontend can use
    const logoUrl = `/api/agents/${session.id}/config/logo/image`;
    
    // Update agent config with logo URL
    await execute(
      'UPDATE agent_configs SET portal_logo_url = $1, updated_at = NOW() WHERE session_id = $2',
      [storageKey, session.id]
    );
    
    res.json({ success: true, logoUrl });
  } catch (error: any) {
    console.error('[AgentConfig] Logo upload error:', error);
    res.status(500).json({ error: 'Failed to upload logo', details: error.message });
  }
});

// Serve portal logo image
router.get('/:sessionId/config/logo/image', async (req, res) => {
  try {
    const session = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1',
      [req.params.sessionId]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const config = await queryOne<AgentConfig & { portal_logo_url?: string }>(
      'SELECT portal_logo_url FROM agent_configs WHERE session_id = $1',
      [session.id]
    );
    
    if (!config?.portal_logo_url) {
      return res.status(404).json({ error: 'No logo found' });
    }
    
    // Import dynamically to avoid circular dependencies
    const { downloadFromR2 } = await import('../services/storage.js');
    const result = await downloadFromR2(config.portal_logo_url, session.user_id);
    
    if (!result.success || !result.content) {
      return res.status(404).json({ error: 'Logo not found in storage' });
    }
    
    res.setHeader('Content-Type', result.contentType || 'image/png');
    // Avoid stale logos when users replace/delete/re-upload.
    // (Browsers can aggressively cache identical URLs.)
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(result.content);
  } catch (error: any) {
    console.error('[AgentConfig] Logo fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch logo' });
  }
});

// Delete portal logo
router.delete('/:sessionId/config/logo', requireAuth, async (req, res) => {
  try {
    // Verify session belongs to user
    const session = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.sessionId, req.session.userId]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Get current logo URL
    const config = await queryOne<AgentConfig & { portal_logo_url?: string }>(
      'SELECT portal_logo_url FROM agent_configs WHERE session_id = $1',
      [session.id]
    );
    
    if (config?.portal_logo_url) {
      // Delete from storage
      await deleteFromR2(config.portal_logo_url, req.session.userId);
    }
    
    // Clear logo URL in config
    await execute(
      'UPDATE agent_configs SET portal_logo_url = NULL, updated_at = NOW() WHERE session_id = $1',
      [session.id]
    );
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('[AgentConfig] Logo delete error:', error);
    res.status(500).json({ error: 'Failed to delete logo', details: error.message });
  }
});

// Get agent runs (task history from task_queue)
router.get('/:agentId/runs', requireAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const userId = req.session.userId!;

    // Verify agent exists and belongs to user
    const agent = await queryOne<{ id: string }>(
      'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
      [agentId, userId]
    );

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Get runs from task_queue
    const runs = await query<{
      id: string;
      prompt: string;
      status: string;
      source?: string;
      sdk_session_id?: string;
      result?: string;
      error?: string;
      structured_output?: string;
      created_at: string;
      started_at?: string;
      completed_at?: string;
    }>(
      `SELECT id, prompt, status, source, sdk_session_id, result, error, structured_output, created_at, started_at, completed_at
       FROM task_queue 
       WHERE session_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );

    // Get total count
    const { count } = await queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM task_queue WHERE session_id = $1',
      [agentId]
    );

    // Transform to match AgentRun interface expected by frontend
    const transformedRuns = runs.map(run => ({
      id: run.id,
      agent_id: agentId,
      user_id: userId,
      prompt: run.prompt,
      status: run.status as 'pending' | 'processing' | 'completed' | 'failed',
      priority: 0, // Default priority for SDK tasks
      source: (run.source || 'api') as 'web' | 'api' | 'chain' | 'workflow',
      sdk_session_id: run.sdk_session_id || undefined,
      result: run.result || undefined,
      error: run.error || undefined,
      debug_log: undefined, // Could be enhanced later with actual debug logs
      created_at: run.created_at,
      started_at: run.started_at || undefined,
      completed_at: run.completed_at || undefined
    }));

    res.json({
      runs: transformedRuns,
      total: count,
      limit,
      offset
    });

  } catch (error) {
    console.error('Failed to get agent runs:', error);
    res.status(500).json({ error: 'Failed to get agent runs' });
  }
});

// Get individual agent run details
router.get('/:agentId/runs/:runId', requireAuth, async (req, res) => {
  try {
    const { agentId, runId } = req.params;
    const userId = req.session.userId!;

    // Verify agent exists and belongs to user
    const agent = await queryOne<{ id: string }>(
      'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
      [agentId, userId]
    );

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Get specific run from task_queue
    const run = await queryOne<{
      id: string;
      prompt: string;
      status: string;
      result?: string;
      error?: string;
      structured_output?: string;
      created_at: string;
      started_at?: string;
      completed_at?: string;
    }>(
      `SELECT id, prompt, status, result, error, structured_output, created_at, started_at, completed_at
       FROM task_queue 
       WHERE id = $1 AND session_id = $2`,
      [runId, agentId]
    );

    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    // Transform to match AgentRun interface
    const transformedRun = {
      id: run.id,
      agent_id: agentId,
      user_id: userId,
      prompt: run.prompt,
      status: run.status as 'pending' | 'processing' | 'completed' | 'failed',
      priority: 0,
      source: 'api' as const,
      result: run.result || undefined,
      error: run.error || undefined,
      debug_log: undefined,
      created_at: run.created_at,
      started_at: run.started_at || undefined,
      completed_at: run.completed_at || undefined
    };

    res.json({ run: transformedRun });

  } catch (error) {
    console.error('Failed to get agent run:', error);
    res.status(500).json({ error: 'Failed to get agent run' });
  }
});

export default router;
