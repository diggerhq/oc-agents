import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { getUserOrgRole, ROLE_HIERARCHY } from '../middleware/orgAuth.js';
import type { OrgRole } from '../types/index.js';

const router = Router();

// Types
interface Schedule {
  id: string;
  user_id: string;
  session_id: string;
  name: string;
  description: string | null;
  cron_expression: string;
  timezone: string;
  prompt: string;
  is_active: boolean | number;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}

interface ScheduleRun {
  id: string;
  schedule_id: string;
  task_id: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  created_at: string;
}

// Helper to parse cron expression and calculate next run time
function getNextRunTime(cronExpression: string, timezone: string = 'UTC'): Date {
  // Simple cron parser for common patterns
  // Format: minute hour day month dayOfWeek
  // Supports: *, */n, specific numbers
  
  const now = new Date();
  const parts = cronExpression.split(' ');
  
  if (parts.length !== 5) {
    // Default to 1 hour from now if invalid
    return new Date(now.getTime() + 60 * 60 * 1000);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  
  // Simple handling for common patterns
  const nextRun = new Date(now);
  
  // Handle "* * * * *" (every minute)
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    nextRun.setMinutes(nextRun.getMinutes() + 1);
    nextRun.setSeconds(0);
    nextRun.setMilliseconds(0);
    return nextRun;
  }
  
  // Handle */n patterns (run every n units)
  if (minute.startsWith('*/')) {
    const interval = parseInt(minute.slice(2));
    const currentMinute = now.getMinutes();
    const nextMinute = Math.ceil(currentMinute / interval) * interval;
    if (nextMinute >= 60) {
      nextRun.setHours(nextRun.getHours() + 1);
      nextRun.setMinutes(nextMinute - 60);
    } else if (nextMinute === currentMinute) {
      nextRun.setMinutes(nextMinute + interval);
    } else {
      nextRun.setMinutes(nextMinute);
    }
    nextRun.setSeconds(0);
    nextRun.setMilliseconds(0);
    return nextRun;
  }
  
  if (hour.startsWith('*/')) {
    const interval = parseInt(hour.slice(2));
    const currentHour = now.getHours();
    const nextHour = Math.ceil((currentHour + 1) / interval) * interval;
    nextRun.setHours(nextHour >= 24 ? nextHour - 24 : nextHour);
    nextRun.setMinutes(minute === '*' ? 0 : parseInt(minute));
    nextRun.setSeconds(0);
    if (nextHour >= 24) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    return nextRun;
  }

  // Handle specific times (e.g., "0 9 * * *" = 9:00 AM daily)
  if (minute !== '*' && hour !== '*') {
    const targetHour = parseInt(hour);
    const targetMinute = parseInt(minute);
    nextRun.setHours(targetHour);
    nextRun.setMinutes(targetMinute);
    nextRun.setSeconds(0);
    
    // If the time has passed today, schedule for tomorrow
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    return nextRun;
  }

  // Default: 1 hour from now
  return new Date(now.getTime() + 60 * 60 * 1000);
}

// Human-readable description of cron expression
function describeCron(cronExpression: string): string {
  const parts = cronExpression.split(' ');
  if (parts.length !== 5) return 'Invalid schedule';
  
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  
  // Every minute: * * * * *
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every minute';
  }
  
  // Every N minutes: */N * * * *
  if (minute.startsWith('*/')) {
    const interval = parseInt(minute.slice(2));
    return `Every ${interval} minute${interval > 1 ? 's' : ''}`;
  }
  
  // Every hour: 0 * * * *
  if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every hour';
  }
  
  // Every N hours: 0 */N * * *
  if (hour.startsWith('*/')) {
    const interval = parseInt(hour.slice(2));
    return `Every ${interval} hour${interval > 1 ? 's' : ''}`;
  }
  
  if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }
  
  if (minute !== '*' && hour !== '*' && dayOfWeek !== '*') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return `${days[parseInt(dayOfWeek)] || 'Weekly'} at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }
  
  return cronExpression;
}

// List schedules for an agent
router.get('/agent/:sessionId', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { sessionId } = req.params;

  const schedules = await query<Schedule>(
    `SELECT s.*, sess.repo_name as agent_name 
     FROM schedules s
     JOIN sessions sess ON s.session_id = sess.id
     WHERE s.session_id = $1 AND s.user_id = $2
     ORDER BY s.created_at DESC`,
    [sessionId, userId]
  );

  res.json({ 
    schedules: schedules.map(s => ({
      ...s,
      is_active: Boolean(s.is_active),
      description_human: describeCron(s.cron_expression),
    }))
  });
});

// List all schedules for the user's current organization, filtered by visibility
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const orgId = (req as any).organizationId;

  let schedules: (Schedule & { agent_name: string })[];

  if (!orgId) {
    // Fall back to user's own schedules (no org context)
    schedules = await query<Schedule & { agent_name: string }>(
      `SELECT s.*, sess.repo_name as agent_name 
       FROM schedules s
       JOIN sessions sess ON s.session_id = sess.id
       WHERE s.user_id = $1
       ORDER BY s.next_run_at ASC NULLS LAST`,
      [userId]
    );
  } else {
    // Get user's role in the org
    const userRole = await getUserOrgRole(userId, orgId);
    if (!userRole) {
      return res.json({ schedules: [] });
    }
    const userRoleLevel = ROLE_HIERARCHY[userRole];
    
    // Check if this is a personal org (legacy resources only show in personal org)
    const org = await queryOne<{ is_personal: boolean }>('SELECT is_personal FROM organizations WHERE id = $1', [orgId]);
    const isPersonalOrg = org?.is_personal === true;
    
    // Query schedules with visibility filtering
    // Legacy resources (no org_id) only show in personal org
    schedules = await query<Schedule & { agent_name: string }>(
      `SELECT s.*, sess.repo_name as agent_name 
       FROM schedules s
       JOIN sessions sess ON s.session_id = sess.id
       LEFT JOIN resource_permissions rp ON rp.resource_type = 'schedule' AND rp.resource_id = s.id
       WHERE (
         s.organization_id = $1 
         OR ($4 = true AND s.organization_id IS NULL AND s.user_id = $2)
       )
         AND (
           rp.id IS NULL
           OR rp.visibility = 'org'
           OR (rp.visibility = 'private' AND s.user_id = $2)
           OR (rp.visibility = 'role' AND $3 >= CASE rp.min_role 
             WHEN 'owner' THEN 3 
             WHEN 'admin' THEN 2 
             WHEN 'member' THEN 1 
             ELSE 1 
           END)
         )
       ORDER BY s.next_run_at ASC NULLS LAST`,
      [orgId, userId, userRoleLevel, isPersonalOrg]
    );
  }

  res.json({ 
    schedules: schedules.map(s => ({
      ...s,
      is_active: Boolean(s.is_active),
      description_human: describeCron(s.cron_expression),
    }))
  });
});

// Get schedule by ID
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { id } = req.params;

  const schedule = await queryOne<Schedule>(
    `SELECT * FROM schedules WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );

  if (!schedule) {
    return res.status(404).json({ error: 'Schedule not found' });
  }

  // Get recent runs
  const runs = await query<ScheduleRun>(
    `SELECT * FROM schedule_runs WHERE schedule_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [id]
  );

  res.json({ 
    schedule: {
      ...schedule,
      is_active: Boolean(schedule.is_active),
      description_human: describeCron(schedule.cron_expression),
    },
    runs 
  });
});

// Create schedule
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { session_id, name, description, cron_expression, timezone, prompt } = req.body;

  if (!session_id || !name || !cron_expression || !prompt) {
    return res.status(400).json({ error: 'session_id, name, cron_expression, and prompt are required' });
  }

  // Verify agent exists and belongs to user
  const agent = await queryOne<{ id: string }>(
    `SELECT id FROM sessions WHERE id = $1 AND user_id = $2`,
    [session_id, userId]
  );

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const id = uuidv4();
  const nextRunAt = getNextRunTime(cron_expression, timezone || 'UTC');

  await execute(
    `INSERT INTO schedules (id, user_id, session_id, name, description, cron_expression, timezone, prompt, next_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, userId, session_id, name, description || null, cron_expression, timezone || 'UTC', prompt, nextRunAt.toISOString()]
  );

  const schedule = await queryOne<Schedule>(
    `SELECT * FROM schedules WHERE id = $1`,
    [id]
  );

  res.status(201).json({ 
    schedule: {
      ...schedule,
      is_active: true,
      description_human: describeCron(cron_expression),
    }
  });
});

// Update schedule
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { id } = req.params;
  const { name, description, cron_expression, timezone, prompt, is_active } = req.body;

  const existing = await queryOne<Schedule>(
    `SELECT * FROM schedules WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );

  if (!existing) {
    return res.status(404).json({ error: 'Schedule not found' });
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(name);
  }
  if (description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(description);
  }
  if (cron_expression !== undefined) {
    updates.push(`cron_expression = $${paramIndex++}`);
    values.push(cron_expression);
    // Recalculate next run time
    const nextRunAt = getNextRunTime(cron_expression, timezone || existing.timezone);
    updates.push(`next_run_at = $${paramIndex++}`);
    values.push(nextRunAt.toISOString());
  }
  if (timezone !== undefined) {
    updates.push(`timezone = $${paramIndex++}`);
    values.push(timezone);
  }
  if (prompt !== undefined) {
    updates.push(`prompt = $${paramIndex++}`);
    values.push(prompt);
  }
  if (is_active !== undefined) {
    updates.push(`is_active = $${paramIndex++}`);
    values.push(is_active ? 1 : 0);
  }

  updates.push(`updated_at = $${paramIndex++}`);
  values.push(new Date().toISOString());

  values.push(id);

  await execute(
    `UPDATE schedules SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
    values
  );

  const schedule = await queryOne<Schedule>(
    `SELECT * FROM schedules WHERE id = $1`,
    [id]
  );

  res.json({ 
    schedule: {
      ...schedule,
      is_active: Boolean(schedule?.is_active),
      description_human: describeCron(schedule?.cron_expression || ''),
    }
  });
});

// Delete schedule
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { id } = req.params;

  const existing = await queryOne<Schedule>(
    `SELECT * FROM schedules WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );

  if (!existing) {
    return res.status(404).json({ error: 'Schedule not found' });
  }

  // Delete runs first
  await execute(`DELETE FROM schedule_runs WHERE schedule_id = $1`, [id]);
  await execute(`DELETE FROM schedules WHERE id = $1`, [id]);

  res.json({ success: true });
});

// Toggle schedule active/inactive
router.post('/:id/toggle', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { id } = req.params;

  const existing = await queryOne<Schedule>(
    `SELECT * FROM schedules WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );

  if (!existing) {
    return res.status(404).json({ error: 'Schedule not found' });
  }

  const newActive = !existing.is_active;
  
  // If activating, recalculate next run time
  let nextRunAt = existing.next_run_at;
  if (newActive) {
    nextRunAt = getNextRunTime(existing.cron_expression, existing.timezone).toISOString();
  }

  await execute(
    `UPDATE schedules SET is_active = $1, next_run_at = $2, updated_at = $3 WHERE id = $4`,
    [newActive ? 1 : 0, nextRunAt, new Date().toISOString(), id]
  );

  res.json({ 
    is_active: newActive,
    next_run_at: nextRunAt,
  });
});

// Manually trigger a schedule (run now)
router.post('/:id/run', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { id } = req.params;

  const schedule = await queryOne<Schedule>(
    `SELECT * FROM schedules WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );

  if (!schedule) {
    return res.status(404).json({ error: 'Schedule not found' });
  }

  // Create a schedule run
  const runId = uuidv4();
  await execute(
    `INSERT INTO schedule_runs (id, schedule_id, status, started_at) VALUES ($1, $2, 'pending', $3)`,
    [runId, id, new Date().toISOString()]
  );

  // Queue the task
  const taskId = uuidv4();
  await execute(
    `INSERT INTO tasks (id, session_id, prompt, status) VALUES ($1, $2, $3, 'pending')`,
    [taskId, schedule.session_id, schedule.prompt]
  );

  await execute(
    `INSERT INTO task_queue (id, agent_id, user_id, prompt, status, source) VALUES ($1, $2, $3, $4, 'pending', 'workflow')`,
    [uuidv4(), schedule.session_id, schedule.user_id, schedule.prompt]
  );

  // Update the schedule run with the task ID
  await execute(
    `UPDATE schedule_runs SET task_id = $1, status = 'running' WHERE id = $2`,
    [taskId, runId]
  );

  res.json({ 
    run_id: runId,
    task_id: taskId,
    message: 'Schedule triggered successfully'
  });
});

export default router;
