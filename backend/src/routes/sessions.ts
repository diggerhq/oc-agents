import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { queryOne, query, execute } from '../db/index.js';
import { canAccessResource, getOrgMembership, getUserOrgRole } from '../middleware/orgAuth.js';
import { getGitHubTokenForUser } from './githubApp.js';
import type { Session, Task, Message, OrgRole } from '../types/index.js';
import { attachDefaultBucketToSession } from '../utils/defaultBucket.js';

// Role hierarchy for filtering
const ROLE_LEVEL: Record<OrgRole, number> = { owner: 3, admin: 2, member: 1 };

const router = Router();

const createSessionSchema = z.object({
  agent_type: z.enum(['code', 'task', 'portal', 'portal-sandbox']).default('code'),
  name: z.string().optional(),  // For task/portal agents, display name
  repo_url: z.string().url().optional(),  // Required for code agents
  repo_name: z.string().optional(),  // Required for code agents
  branch: z.string().default('main'),
  agent_provider: z.enum(['claude-code', 'aider', 'opencode']).default('claude-code'),
  agent_model: z.string().optional(),  // e.g., "anthropic/claude-sonnet-4-20250514"
  system_prompt: z.string().optional(),
}).refine(
  (data) => {
    // Code agents require repo_url and repo_name
    if (data.agent_type === 'code') {
      return !!data.repo_url && !!data.repo_name;
    }
    return true;
  },
  { message: 'Code agents require repo_url and repo_name' }
);

const createTaskSchema = z.object({
  prompt: z.string().min(1),
});

// List sessions in user's current organization, filtered by visibility
router.get('/', requireAuth, async (req, res) => {
  const orgId = (req as any).organizationId;
  const userId = req.session.userId!;
  
  if (!orgId) {
    // Fall back to user's own sessions (no org context)
    const sessions = await query<Session & { config_name?: string }>(
      `SELECT s.*, ac.name as config_name 
       FROM sessions s 
       LEFT JOIN agent_configs ac ON s.id = ac.session_id 
       WHERE s.user_id = $1 
       ORDER BY s.created_at DESC`,
      [userId]
    );
    
    const sessionsWithNames = sessions.map(s => ({
      ...s,
      display_name: s.config_name || s.repo_name || `Agent ${s.id.slice(0, 8)}`,
    }));
    
    return res.json({ sessions: sessionsWithNames });
  }
  
  // Get user's role in the org and check if it's personal
  const userRole = await getUserOrgRole(userId, orgId);
  if (!userRole) {
    return res.json({ sessions: [] });
  }
  const userRoleLevel = ROLE_LEVEL[userRole];
  
  // Check if this is a personal org (legacy resources only show in personal org)
  const org = await queryOne<{ is_personal: boolean }>('SELECT is_personal FROM organizations WHERE id = $1', [orgId]);
  const isPersonalOrg = org?.is_personal === true;
  
  // Query sessions with visibility filtering:
  // - 'org' or no permission record: all members can see
  // - 'private': only the creator can see
  // - 'role': only users with role >= min_role can see
  // Legacy resources (no org_id) only show in personal org
  const sessions = await query<Session & { config_name?: string; visibility?: string; min_role?: string }>(
    `SELECT s.*, ac.name as config_name, rp.visibility, rp.min_role
     FROM sessions s 
     LEFT JOIN agent_configs ac ON s.id = ac.session_id 
     LEFT JOIN resource_permissions rp ON rp.resource_type = 'session' AND rp.resource_id = s.id
     WHERE (
       s.organization_id = $1 
       OR ($4 = true AND s.organization_id IS NULL AND s.user_id = $2)
     )
       AND (
         -- No permission record = default 'org' visibility (all members see)
         rp.id IS NULL
         -- Explicitly 'org' visibility = all members see
         OR rp.visibility = 'org'
         -- 'private' visibility = only creator sees
         OR (rp.visibility = 'private' AND s.user_id = $2)
         -- 'role' visibility = check role hierarchy
         OR (rp.visibility = 'role' AND $3 >= CASE rp.min_role 
           WHEN 'owner' THEN 3 
           WHEN 'admin' THEN 2 
           WHEN 'member' THEN 1 
           ELSE 1 
         END)
       )
     ORDER BY s.created_at DESC`,
    [orgId, userId, userRoleLevel, isPersonalOrg]
  );

  // Add a display_name field for convenience
  const sessionsWithNames = sessions.map(s => ({
    ...s,
    display_name: s.config_name || s.repo_name || `Agent ${s.id.slice(0, 8)}`,
  }));

  res.json({ sessions: sessionsWithNames });
});

// Create a new session (agent)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { agent_type, name, repo_url, repo_name, branch, agent_provider, agent_model, system_prompt } = createSessionSchema.parse(req.body);

    // Code agents require GitHub App installation (for repo access)
    if (agent_type === 'code' && repo_url) {
      const githubToken = await getGitHubTokenForUser(req.session.userId!, repo_url);
      if (!githubToken) {
        return res.status(400).json({ error: 'GitHub App not installed. Install the GitHub App in Settings to access repositories.' });
      }
    }

    const id = uuidv4();
    const orgId = (req as any).organizationId;
    
    // For task agents, use name as repo_name if provided
    const effectiveRepoName = repo_name || name || 'Task Agent';
    
    await execute(
      `INSERT INTO sessions (id, user_id, organization_id, agent_type, repo_url, repo_name, branch, status, agent_provider, agent_model)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)`,
      [id, req.session.userId, orgId || null, agent_type, repo_url || null, effectiveRepoName, branch, agent_provider, agent_model || null]
    );

    // Create agent config with appropriate defaults
    const configId = uuidv4();
    
    if (agent_type === 'portal') {
      // Portal agents: auto-enable portal (direct API, kept for future development)
      // Note: thinking_budget and max_tokens are now auto-derived from model, not stored
      await execute(
        `INSERT INTO agent_configs (id, session_id, name, portal_enabled, portal_agent_model, portal_agent_sandbox_enabled, setup_wizard_completed) 
         VALUES ($1, $2, $3, true, $4, true, false)`,
        [configId, id, name || null, 'claude-sonnet-4-5-20250929']
      );

      // Auto-create a private output bucket for this portal agent
      try {
        const outputBucketId = uuidv4();
        const outputBucketName = `Portal Output - ${name || id.slice(0, 8)}`;
        await execute(
          `INSERT INTO buckets (id, user_id, organization_id, name, description)
           VALUES ($1, $2, $3, $4, $5)`,
          [outputBucketId, req.session.userId, orgId || null, outputBucketName, `Auto-created output bucket for portal agent ${name || id}`]
        );
        // Attach it to the agent (read-write)
        const attachId = uuidv4();
        await execute(
          `INSERT INTO agent_buckets (id, session_id, bucket_id, mount_path, read_only)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT(session_id, bucket_id) DO NOTHING`,
          [attachId, id, outputBucketId, '/home/user/workspace/output', false]
        );
        // Store the output bucket ID in config for easy reference
        await execute(
          `UPDATE agent_configs SET portal_bucket_id = $1 WHERE session_id = $2`,
          [outputBucketId, id]
        );
        console.log(`[Sessions] Created portal output bucket "${outputBucketName}" for agent ${id}`);
      } catch (err) {
        console.error('[Sessions] Failed to create portal output bucket:', err);
      }
    } else if (agent_type === 'portal-sandbox') {
      // Portal Sandbox agents: wizard-based, sandbox-backed, 3-bucket architecture
      await execute(
        `INSERT INTO agent_configs (id, session_id, name, portal_enabled, setup_wizard_completed, enable_extended_thinking, thinking_budget_tokens) 
         VALUES ($1, $2, $3, true, false, true, 100000)`,
        [configId, id, name || null]
      );

      // Create 3 buckets: Skills (read-only), Input (read-only), Output (writable)
      // Names use underscore format with no spaces for filesystem safety
      const safeName = (name || 'agent').toLowerCase().replaceAll(/[^a-z0-9]+/g, '_').replaceAll(/(^_|_$)/g, '');
      try {
        // 1. Skills bucket - for agent instructions
        const skillsBucketId = uuidv4();
        const skillsBucketName = `${safeName}_skills`;
        await execute(
          `INSERT INTO buckets (id, user_id, organization_id, name, description)
           VALUES ($1, $2, $3, $4, $5)`,
          [skillsBucketId, req.session.userId, orgId || null, skillsBucketName, `Skills and instructions for ${name || id}`]
        );
        await execute(
          `INSERT INTO agent_buckets (id, session_id, bucket_id, mount_path, read_only)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT(session_id, bucket_id) DO NOTHING`,
          [uuidv4(), id, skillsBucketId, '/home/user/workspace/skills', true]
        );
        
        // 2. Input bucket - for reference files uploaded by users
        const inputBucketId = uuidv4();
        const inputBucketName = `${safeName}_input`;
        await execute(
          `INSERT INTO buckets (id, user_id, organization_id, name, description)
           VALUES ($1, $2, $3, $4, $5)`,
          [inputBucketId, req.session.userId, orgId || null, inputBucketName, `Reference files for ${name || id}`]
        );
        await execute(
          `INSERT INTO agent_buckets (id, session_id, bucket_id, mount_path, read_only)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT(session_id, bucket_id) DO NOTHING`,
          [uuidv4(), id, inputBucketId, '/home/user/workspace/input', true]
        );
        
        // 3. Output bucket - for agent-generated files
        const outputBucketId = uuidv4();
        const outputBucketName = `${safeName}_output`;
        await execute(
          `INSERT INTO buckets (id, user_id, organization_id, name, description)
           VALUES ($1, $2, $3, $4, $5)`,
          [outputBucketId, req.session.userId, orgId || null, outputBucketName, `Generated files from ${name || id}`]
        );
        await execute(
          `INSERT INTO agent_buckets (id, session_id, bucket_id, mount_path, read_only)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT(session_id, bucket_id) DO NOTHING`,
          [uuidv4(), id, outputBucketId, '/home/user/workspace/output', false]
        );
        
        // Store output bucket ID for portal file display
        await execute(
          `UPDATE agent_configs SET portal_bucket_id = $1 WHERE session_id = $2`,
          [outputBucketId, id]
        );
        
        console.log(`[Sessions] Created 3-bucket architecture (skills/input/output) for portal-sandbox agent ${id}`);
      } catch (err) {
        console.error('[Sessions] Failed to create portal-sandbox buckets:', err);
      }
    } else {
      // Enable extended thinking by default for Claude Code agents
      const enableExtendedThinking = agent_provider === 'claude-code';
      const thinkingBudgetTokens = enableExtendedThinking ? 100000 : null;
      
      await execute(
        `INSERT INTO agent_configs (id, session_id, name, system_prompt, enable_extended_thinking, thinking_budget_tokens)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [configId, id, name || null, system_prompt || null, enableExtendedThinking, thinkingBudgetTokens]
      );
    }

    // Auto-attach the default "Files" bucket to task agents only
    // portal-sandbox agents already have their buckets created above
    try {
      if (agent_type === 'task') {
        await attachDefaultBucketToSession(id, req.session.userId!, orgId || null, agent_type);
      }
    } catch (err) {
      console.error('[Sessions] Failed to attach default bucket:', err);
      // Don't fail session creation if bucket attachment fails
    }

    const session = await queryOne<Session>('SELECT * FROM sessions WHERE id = $1', [id]);
    res.json({ session });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Create session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get session details
router.get('/:sessionId', requireAuth, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1',
    [req.params.sessionId]
  );

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Check access: user must be owner or org member
  const hasAccess = session.user_id === req.session.userId ||
    (session.organization_id && await canAccessResource(req.session.userId!, 'session', session.id));
  
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const tasks = await query<Task>(
    'SELECT * FROM tasks WHERE session_id = $1 ORDER BY created_at ASC',
    [session.id]
  );

  res.json({ session, tasks });
});

// Update session status
router.patch('/:sessionId', requireAuth, async (req, res) => {
  const { status, sandbox_id } = req.body;

  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1',
    [req.params.sessionId]
  );

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Check access: user must be owner or org member with admin+ role
  const hasAccess = session.user_id === req.session.userId ||
    (session.organization_id && await canAccessResource(req.session.userId!, 'session', session.id));
  
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  const setParam = (column: string, value: unknown) => {
    params.push(value);
    updates.push(`${column} = $${params.length}`);
  };

  if (status) {
    setParam('status', status);
  }
  if (sandbox_id) {
    setParam('sandbox_id', sandbox_id);
  }

  if (updates.length > 0) {
    updates.push('updated_at = NOW()');
    params.push(req.params.sessionId);

    await execute(
      `UPDATE sessions SET ${updates.join(', ')} WHERE id = $${params.length}`,
      params
    );
  }

  const updated = await queryOne<Session>('SELECT * FROM sessions WHERE id = $1', [req.params.sessionId]);
  res.json({ session: updated });
});

// Delete session
router.delete('/:sessionId', requireAuth, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1',
    [req.params.sessionId]
  );

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Check access: user must be owner or org admin+
  let hasAccess = session.user_id === req.session.userId;
  if (!hasAccess && session.organization_id) {
    const membership = await getOrgMembership(req.session.userId!, session.organization_id);
    hasAccess = membership?.role === 'owner' || membership?.role === 'admin';
  }
  
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Delete all related records (order matters for foreign keys)
  
  // Delete workflow steps
  await execute('DELETE FROM workflow_steps WHERE agent_id = $1', [session.id]);
  
  // Delete prompt templates
  await execute('DELETE FROM prompt_templates WHERE agent_id = $1', [session.id]);
  
  // Delete task queue entries
  await execute('DELETE FROM task_queue WHERE agent_id = $1', [session.id]);
  
  // Delete agent config
  await execute('DELETE FROM agent_configs WHERE session_id = $1', [session.id]);
  
  // Delete messages for all tasks in session
  await execute(
    'DELETE FROM messages WHERE task_id IN (SELECT id FROM tasks WHERE session_id = $1)',
    [session.id]
  );

  // Delete tasks
  await execute('DELETE FROM tasks WHERE session_id = $1', [session.id]);

  // Delete session
  await execute('DELETE FROM sessions WHERE id = $1', [session.id]);

  res.json({ success: true });
});

// Create a task in a session
router.post('/:sessionId/tasks', requireAuth, async (req, res) => {
  try {
    const { prompt } = createTaskSchema.parse(req.body);

    const session = await queryOne<Session>(
      'SELECT * FROM sessions WHERE id = $1',
      [req.params.sessionId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check access
    const hasAccess = session.user_id === req.session.userId ||
      (session.organization_id && await canAccessResource(req.session.userId!, 'session', session.id));
    
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const taskId = uuidv4();
    const messageId = uuidv4();

    // Create task
    await execute(
      `INSERT INTO tasks (id, session_id, prompt, status)
       VALUES ($1, $2, $3, 'pending')`,
      [taskId, session.id, prompt]
    );

    // Create initial user message
    await execute(
      `INSERT INTO messages (id, task_id, role, content)
       VALUES ($1, $2, 'user', $3)`,
      [messageId, taskId, prompt]
    );

    const task = await queryOne<Task>('SELECT * FROM tasks WHERE id = $1', [taskId]);
    res.json({ task });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get task details with messages
router.get('/:sessionId/tasks/:taskId', requireAuth, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1',
    [req.params.sessionId]
  );

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Check access
  const hasAccess = session.user_id === req.session.userId ||
    (session.organization_id && await canAccessResource(req.session.userId!, 'session', session.id));
  
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const task = await queryOne<Task>(
    'SELECT * FROM tasks WHERE id = $1 AND session_id = $2',
    [req.params.taskId, session.id]
  );

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const messages = await query<Message>(
    'SELECT * FROM messages WHERE task_id = $1 ORDER BY created_at ASC',
    [task.id]
  );

  res.json({ task, messages });
});

// Update task status
router.patch('/:sessionId/tasks/:taskId', requireAuth, async (req, res) => {
  const { status, result, error } = req.body;

  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1',
    [req.params.sessionId]
  );

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Check access
  const hasAccess = session.user_id === req.session.userId ||
    (session.organization_id && await canAccessResource(req.session.userId!, 'session', session.id));
  
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const task = await queryOne<Task>(
    'SELECT * FROM tasks WHERE id = $1 AND session_id = $2',
    [req.params.taskId, session.id]
  );

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  const setParam = (column: string, value: unknown) => {
    params.push(value);
    updates.push(`${column} = $${params.length}`);
  };

  if (status) {
    setParam('status', status);
  }
  if (result !== undefined) {
    setParam('result', result);
  }
  if (error !== undefined) {
    setParam('error', error);
  }

  if (updates.length > 0) {
    updates.push('updated_at = NOW()');
    params.push(req.params.taskId);

    await execute(
      `UPDATE tasks SET ${updates.join(', ')} WHERE id = $${params.length}`,
      params
    );
  }

  const updated = await queryOne<Task>('SELECT * FROM tasks WHERE id = $1', [req.params.taskId]);
  res.json({ task: updated });
});

// Add message to task
router.post('/:sessionId/tasks/:taskId/messages', requireAuth, async (req, res) => {
  const { role, content } = req.body;

  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1',
    [req.params.sessionId]
  );

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Check access
  const hasAccess = session.user_id === req.session.userId ||
    (session.organization_id && await canAccessResource(req.session.userId!, 'session', session.id));
  
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const task = await queryOne<Task>(
    'SELECT * FROM tasks WHERE id = $1 AND session_id = $2',
    [req.params.taskId, session.id]
  );

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const messageId = uuidv4();
  await execute(
    `INSERT INTO messages (id, task_id, role, content)
     VALUES ($1, $2, $3, $4)`,
    [messageId, task.id, role, content]
  );

  const message = await queryOne<Message>('SELECT * FROM messages WHERE id = $1', [messageId]);
  res.json({ message });
});

export default router;
