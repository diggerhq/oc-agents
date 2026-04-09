import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { queryOne, query, execute } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ============================================
// TYPES
// ============================================

interface Webhook {
  id: string;
  user_id: string;
  secret: string;
  name: string;
  description: string | null;
  target_type: 'agent' | 'workflow';
  target_id: string;
  payload_mapping: string;
  verify_signature: number;
  signature_secret: string | null;
  allowed_ips: string | null;
  is_active: number;
  last_triggered_at: string | null;
  trigger_count: number;
  created_at: string;
}

interface GitHubWebhook {
  id: string;
  user_id: string;
  repo_full_name: string;
  events: string;
  filters: string;
  target_type: 'agent' | 'workflow';
  target_id: string;
  prompt_template: string | null;
  is_active: number;
  webhook_secret: string | null;
  github_hook_id: number | null;
  last_triggered_at: string | null;
  trigger_count: number;
  created_at: string;
}

interface ScheduledTask {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  cron_expression: string;
  timezone: string;
  target_type: 'agent' | 'workflow';
  target_id: string;
  input_data: string;
  prompt: string | null;
  is_active: number;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  last_error: string | null;
  created_at: string;
}

interface NotificationChannel {
  id: string;
  user_id: string;
  name: string;
  channel_type: 'slack' | 'discord' | 'email' | 'webhook';
  config: string;
  is_active: number;
  created_at: string;
}

interface NotificationRule {
  id: string;
  user_id: string;
  channel_id: string;
  name: string;
  trigger_type: string;
  filter: string | null;
  message_template: string;
  is_active: number;
  created_at: string;
}

// ============================================
// WEBHOOKS CRUD
// ============================================

// List webhooks
router.get('/webhooks', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  
  const webhooks = await query<Webhook>(
    `SELECT * FROM webhooks WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  
  // Generate full webhook URLs
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const webhooksWithUrls = webhooks.map(w => ({
    ...w,
    webhook_url: `${baseUrl}/api/webhooks/trigger/${w.secret}`,
    payload_mapping: JSON.parse(w.payload_mapping || '{}'),
    allowed_ips: w.allowed_ips ? JSON.parse(w.allowed_ips) : null,
  }));
  
  res.json({ webhooks: webhooksWithUrls });
});

// Create webhook
router.post('/webhooks', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  const { name, description, target_type, target_id, payload_mapping, verify_signature } = req.body;
  
  if (!name || !target_type || !target_id) {
    return res.status(400).json({ error: 'Name, target_type, and target_id are required' });
  }
  
  const id = uuidv4();
  const secret = crypto.randomBytes(24).toString('hex');
  const signatureSecret = verify_signature ? crypto.randomBytes(32).toString('hex') : null;
  
  await execute(
    `INSERT INTO webhooks (id, user_id, secret, name, description, target_type, target_id, payload_mapping, verify_signature, signature_secret)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, userId, secret, name, description || null, target_type, target_id, JSON.stringify(payload_mapping || {}), Boolean(verify_signature), signatureSecret]
  );
  
  const webhook = await queryOne<Webhook>(`SELECT * FROM webhooks WHERE id = $1`, [id]);
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  
  res.json({
    webhook: {
      ...webhook,
      webhook_url: `${baseUrl}/api/webhooks/trigger/${secret}`,
      signature_secret: signatureSecret, // Only returned on creation
    },
  });
});

// Update webhook
router.put('/webhooks/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  const { id } = req.params;
  const { name, description, target_type, target_id, payload_mapping, is_active } = req.body;
  
  const webhook = await queryOne<Webhook>(
    `SELECT * FROM webhooks WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  
  if (!webhook) {
    return res.status(404).json({ error: 'Webhook not found' });
  }
  
  await execute(
    `UPDATE webhooks SET
      name = COALESCE($1, name),
      description = COALESCE($2, description),
      target_type = COALESCE($3, target_type),
      target_id = COALESCE($4, target_id),
      payload_mapping = COALESCE($5, payload_mapping),
      is_active = COALESCE($6, is_active),
      updated_at = NOW()
     WHERE id = $7`,
    [name, description, target_type, target_id, payload_mapping ? JSON.stringify(payload_mapping) : null, is_active, id]
  );
  
  const updated = await queryOne<Webhook>(`SELECT * FROM webhooks WHERE id = $1`, [id]);
  res.json({ webhook: updated });
});

// Delete webhook
router.delete('/webhooks/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  const { id } = req.params;
  
  const webhook = await queryOne<Webhook>(
    `SELECT * FROM webhooks WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  
  if (!webhook) {
    return res.status(404).json({ error: 'Webhook not found' });
  }
  
  await execute(`DELETE FROM webhooks WHERE id = $1`, [id]);
  res.json({ success: true });
});

// Regenerate webhook secret
router.post('/webhooks/:id/regenerate', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  const { id } = req.params;
  
  const webhook = await queryOne<Webhook>(
    `SELECT * FROM webhooks WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  
  if (!webhook) {
    return res.status(404).json({ error: 'Webhook not found' });
  }
  
  const newSecret = crypto.randomBytes(24).toString('hex');
  await execute(`UPDATE webhooks SET secret = $1, updated_at = NOW() WHERE id = $2`, [newSecret, id]);
  
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  res.json({ webhook_url: `${baseUrl}/api/webhooks/trigger/${newSecret}` });
});

// ============================================
// WEBHOOK TRIGGER (Public endpoint)
// ============================================

router.post('/webhooks/trigger/:secret', async (req: Request, res: Response) => {
  const { secret } = req.params;
  
  const webhook = await queryOne<Webhook>(
    `SELECT * FROM webhooks WHERE secret = $1 AND is_active = true`,
    [secret]
  );
  
  if (!webhook) {
    return res.status(404).json({ error: 'Webhook not found' });
  }
  
  // Log the event
  const eventId = uuidv4();
  await execute(
    `INSERT INTO event_log (id, user_id, event_type, source_type, source_id, target_type, target_id, status, payload)
     VALUES ($1, $2, 'webhook_received', 'webhook', $3, $4, $5, 'received', $6)`,
    [eventId, webhook.user_id, webhook.id, webhook.target_type, webhook.target_id, JSON.stringify(req.body)]
  );
  
  // Update webhook stats
  await execute(
    `UPDATE webhooks SET last_triggered_at = NOW(), trigger_count = trigger_count + 1 WHERE id = $1`,
    [webhook.id]
  );
  
  // Map payload to input data
  const payloadMapping = JSON.parse(webhook.payload_mapping || '{}');
  let inputData: Record<string, unknown> = { ...req.body };
  
  for (const [key, path] of Object.entries(payloadMapping)) {
    const value = getNestedValue(req.body, path as string);
    if (value !== undefined) {
      inputData[key] = value;
    }
  }
  
  try {
    // Trigger the target
    if (webhook.target_type === 'agent') {
      // Queue a task for the agent
      const taskId = uuidv4();
      const prompt = typeof inputData.prompt === 'string' ? inputData.prompt : JSON.stringify(inputData);
      
      await execute(
        `INSERT INTO task_queue (id, agent_id, user_id, prompt, status, source)
         VALUES ($1, $2, $3, $4, 'pending', 'webhook')`,
        [taskId, webhook.target_id, webhook.user_id, prompt]
      );
      
      await execute(
        `UPDATE event_log SET status = 'processing', completed_at = NOW() WHERE id = $1`,
        [eventId]
      );
      
      res.json({ success: true, task_id: taskId });
    } else if (webhook.target_type === 'workflow') {
      // Start workflow run
      const runId = uuidv4();
      
      await execute(
        `INSERT INTO workflow_runs (id, workflow_id, user_id, input_data, status, started_at)
         VALUES ($1, $2, $3, $4, 'pending', NOW())`,
        [runId, webhook.target_id, webhook.user_id, JSON.stringify(inputData)]
      );
      
      await execute(
        `UPDATE event_log SET status = 'processing', completed_at = NOW() WHERE id = $1`,
        [eventId]
      );
      
      res.json({ success: true, workflow_run_id: runId });
    }
  } catch (error: any) {
    await execute(
      `UPDATE event_log SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
      [error.message, eventId]
    );
    res.status(500).json({ error: 'Failed to trigger target' });
  }
});

// ============================================
// GITHUB WEBHOOKS
// ============================================

// List GitHub webhooks
router.get('/github-webhooks', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  
  const webhooks = await query<GitHubWebhook>(
    `SELECT * FROM github_webhooks WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  
  res.json({
    webhooks: webhooks.map(w => ({
      ...w,
      events: JSON.parse(w.events || '[]'),
      filters: JSON.parse(w.filters || '{}'),
    })),
  });
});

// Create GitHub webhook
router.post('/github-webhooks', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  const { repo_full_name, events, filters, target_type, target_id, prompt_template } = req.body;
  
  if (!repo_full_name || !target_type || !target_id) {
    return res.status(400).json({ error: 'repo_full_name, target_type, and target_id are required' });
  }
  
  const id = uuidv4();
  const webhookSecret = crypto.randomBytes(32).toString('hex');
  
  await execute(
    `INSERT INTO github_webhooks (id, user_id, repo_full_name, events, filters, target_type, target_id, prompt_template, webhook_secret)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, userId, repo_full_name, JSON.stringify(events || ['push']), JSON.stringify(filters || {}), target_type, target_id, prompt_template || null, webhookSecret]
  );
  
  // TODO: Register webhook with GitHub API using user's access token
  // For now, we'll provide the webhook URL for manual setup
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  
  const webhook = await queryOne<GitHubWebhook>(`SELECT * FROM github_webhooks WHERE id = $1`, [id]);
  
  res.json({
    webhook: {
      ...webhook,
      events: JSON.parse(webhook!.events),
      filters: JSON.parse(webhook!.filters),
    },
    setup_instructions: {
      webhook_url: `${baseUrl}/api/events/github/webhook`,
      content_type: 'application/json',
      secret: webhookSecret,
      events: events || ['push'],
    },
  });
});

// Delete GitHub webhook
router.delete('/github-webhooks/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  const { id } = req.params;
  
  const webhook = await queryOne<GitHubWebhook>(
    `SELECT * FROM github_webhooks WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  
  if (!webhook) {
    return res.status(404).json({ error: 'GitHub webhook not found' });
  }
  
  await execute(`DELETE FROM github_webhooks WHERE id = $1`, [id]);
  res.json({ success: true });
});

// GitHub webhook receiver (public endpoint)
router.post('/github/webhook', async (req: Request, res: Response) => {
  const signature = req.headers['x-hub-signature-256'] as string;
  const event = req.headers['x-github-event'] as string;
  const delivery = req.headers['x-github-delivery'] as string;
  
  if (!event) {
    return res.status(400).json({ error: 'Missing X-GitHub-Event header' });
  }
  
  // Get repo from payload
  const payload = req.body;
  const repoFullName = payload.repository?.full_name;
  
  if (!repoFullName) {
    return res.status(400).json({ error: 'Missing repository in payload' });
  }
  
  // Find matching webhooks
  const webhooks = await query<GitHubWebhook>(
    `SELECT * FROM github_webhooks WHERE repo_full_name = $1 AND is_active = true`,
    [repoFullName]
  );
  
  if (webhooks.length === 0) {
    return res.status(200).json({ message: 'No webhooks configured for this repository' });
  }
  
  for (const webhook of webhooks) {
    // Verify signature if configured
    if (webhook.webhook_secret && signature) {
      const expectedSignature = 'sha256=' + crypto
        .createHmac('sha256', webhook.webhook_secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      
      if (signature !== expectedSignature) {
        console.log(`[GitHub] Signature mismatch for webhook ${webhook.id}`);
        continue;
      }
    }
    
    // Check if event matches
    const events = JSON.parse(webhook.events || '[]');
    if (!events.includes(event) && !events.includes('*')) {
      continue;
    }
    
    // Check filters
    const filters = JSON.parse(webhook.filters || '{}');
    if (filters.branch) {
      const branch = payload.ref?.replace('refs/heads/', '');
      if (branch !== filters.branch) {
        continue;
      }
    }
    if (filters.base_branch && payload.pull_request) {
      if (payload.pull_request.base.ref !== filters.base_branch) {
        continue;
      }
    }
    
    // Log the event
    const eventId = uuidv4();
    await execute(
      `INSERT INTO event_log (id, user_id, event_type, source_type, source_id, target_type, target_id, status, payload)
       VALUES ($1, $2, $3, 'github', $4, $5, $6, 'received', $7)`,
      [eventId, webhook.user_id, `github_${event}`, webhook.id, webhook.target_type, webhook.target_id, JSON.stringify(payload)]
    );
    
    // Update webhook stats
    await execute(
      `UPDATE github_webhooks SET last_triggered_at = NOW(), trigger_count = trigger_count + 1 WHERE id = $1`,
      [webhook.id]
    );
    
    // Build prompt from template
    let prompt = webhook.prompt_template || `GitHub ${event} event on ${repoFullName}`;
    prompt = replaceTemplateVars(prompt, { event, delivery, ...payload });
    
    try {
      if (webhook.target_type === 'agent') {
        const taskId = uuidv4();
        await execute(
          `INSERT INTO task_queue (id, agent_id, user_id, prompt, status, source)
           VALUES ($1, $2, $3, $4, 'pending', 'github')`,
          [taskId, webhook.target_id, webhook.user_id, prompt]
        );
      } else if (webhook.target_type === 'workflow') {
        const runId = uuidv4();
        await execute(
          `INSERT INTO workflow_runs (id, workflow_id, user_id, input_data, status, started_at)
           VALUES ($1, $2, $3, $4, 'pending', NOW())`,
          [runId, webhook.target_id, webhook.user_id, JSON.stringify({ event, delivery, ...payload, prompt })]
        );
      }
      
      await execute(`UPDATE event_log SET status = 'processing' WHERE id = $1`, [eventId]);
    } catch (error: any) {
      await execute(
        `UPDATE event_log SET status = 'failed', error = $1 WHERE id = $2`,
        [error.message, eventId]
      );
    }
  }
  
  res.json({ success: true });
});

// ============================================
// SCHEDULED TASKS
// ============================================

// List scheduled tasks
router.get('/schedules', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  
  const tasks = await query<ScheduledTask>(
    `SELECT * FROM scheduled_tasks WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  
  res.json({
    schedules: tasks.map(t => ({
      ...t,
      input_data: JSON.parse(t.input_data || '{}'),
    })),
  });
});

// Create scheduled task
router.post('/schedules', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  const { name, description, cron_expression, timezone, target_type, target_id, input_data, prompt } = req.body;
  
  if (!name || !cron_expression || !target_type || !target_id) {
    return res.status(400).json({ error: 'Name, cron_expression, target_type, and target_id are required' });
  }
  
  // Validate cron expression (basic check)
  const cronParts = cron_expression.trim().split(/\s+/);
  if (cronParts.length < 5 || cronParts.length > 6) {
    return res.status(400).json({ error: 'Invalid cron expression. Expected 5 or 6 parts.' });
  }
  
  const id = uuidv4();
  const nextRun = calculateNextRun(cron_expression, timezone || 'UTC');
  
  await execute(
    `INSERT INTO scheduled_tasks (id, user_id, name, description, cron_expression, timezone, target_type, target_id, input_data, prompt, next_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, userId, name, description || null, cron_expression, timezone || 'UTC', target_type, target_id, JSON.stringify(input_data || {}), prompt || null, nextRun]
  );
  
  const task = await queryOne<ScheduledTask>(`SELECT * FROM scheduled_tasks WHERE id = $1`, [id]);
  res.json({ schedule: task });
});

// Update scheduled task
router.put('/schedules/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  const { id } = req.params;
  const { name, description, cron_expression, timezone, target_type, target_id, input_data, prompt, is_active } = req.body;
  
  const task = await queryOne<ScheduledTask>(
    `SELECT * FROM scheduled_tasks WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  
  if (!task) {
    return res.status(404).json({ error: 'Scheduled task not found' });
  }
  
  const nextRun = cron_expression ? calculateNextRun(cron_expression, timezone || task.timezone) : null;
  
  await execute(
    `UPDATE scheduled_tasks SET
      name = COALESCE($1, name),
      description = COALESCE($2, description),
      cron_expression = COALESCE($3, cron_expression),
      timezone = COALESCE($4, timezone),
      target_type = COALESCE($5, target_type),
      target_id = COALESCE($6, target_id),
      input_data = COALESCE($7, input_data),
      prompt = COALESCE($8, prompt),
      is_active = COALESCE($9, is_active),
      next_run_at = COALESCE($10, next_run_at),
      updated_at = NOW()
     WHERE id = $11`,
    [name, description, cron_expression, timezone, target_type, target_id, input_data ? JSON.stringify(input_data) : null, prompt, is_active, nextRun, id]
  );
  
  const updated = await queryOne<ScheduledTask>(`SELECT * FROM scheduled_tasks WHERE id = $1`, [id]);
  res.json({ schedule: updated });
});

// Delete scheduled task
router.delete('/schedules/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  const { id } = req.params;
  
  const task = await queryOne<ScheduledTask>(
    `SELECT * FROM scheduled_tasks WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  
  if (!task) {
    return res.status(404).json({ error: 'Scheduled task not found' });
  }
  
  await execute(`DELETE FROM scheduled_tasks WHERE id = $1`, [id]);
  res.json({ success: true });
});

// ============================================
// NOTIFICATION CHANNELS
// ============================================

// List notification channels
router.get('/notifications/channels', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  
  const channels = await query<NotificationChannel>(
    `SELECT * FROM notification_channels WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  
  // Mask sensitive config data
  const maskedChannels = channels.map(c => {
    const config = JSON.parse(c.config);
    if (config.webhook_url) {
      config.webhook_url = config.webhook_url.substring(0, 30) + '...';
    }
    return { ...c, config };
  });
  
  res.json({ channels: maskedChannels });
});

// Create notification channel
router.post('/notifications/channels', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  const { name, channel_type, config } = req.body;
  
  if (!name || !channel_type || !config) {
    return res.status(400).json({ error: 'Name, channel_type, and config are required' });
  }
  
  // Validate channel type
  if (!['slack', 'discord', 'email', 'webhook'].includes(channel_type)) {
    return res.status(400).json({ error: 'Invalid channel_type' });
  }
  
  const id = uuidv4();
  
  await execute(
    `INSERT INTO notification_channels (id, user_id, name, channel_type, config) VALUES ($1, $2, $3, $4, $5)`,
    [id, userId, name, channel_type, JSON.stringify(config)]
  );
  
  const channel = await queryOne<NotificationChannel>(`SELECT * FROM notification_channels WHERE id = $1`, [id]);
  res.json({ channel });
});

// Delete notification channel
router.delete('/notifications/channels/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  const { id } = req.params;
  
  const channel = await queryOne<NotificationChannel>(
    `SELECT * FROM notification_channels WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  
  await execute(`DELETE FROM notification_channels WHERE id = $1`, [id]);
  res.json({ success: true });
});

// Test notification channel
router.post('/notifications/channels/:id/test', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  const { id } = req.params;
  
  const channel = await queryOne<NotificationChannel>(
    `SELECT * FROM notification_channels WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  
  const config = JSON.parse(channel.config);
  
  try {
    await sendNotification(channel.channel_type, config, {
      title: 'Test Notification',
      message: 'This is a test notification from Jeff.',
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true, message: 'Test notification sent!' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// NOTIFICATION RULES
// ============================================

// List notification rules
router.get('/notifications/rules', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  
  const rules = await query<NotificationRule & { channel_name: string }>(
    `SELECT nr.*, nc.name as channel_name 
     FROM notification_rules nr
     JOIN notification_channels nc ON nr.channel_id = nc.id
     WHERE nr.user_id = $1
     ORDER BY nr.created_at DESC`,
    [userId]
  );
  
  res.json({
    rules: rules.map(r => ({
      ...r,
      filter: r.filter ? JSON.parse(r.filter) : null,
    })),
  });
});

// Create notification rule
router.post('/notifications/rules', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  const { channel_id, name, trigger_type, filter, message_template } = req.body;
  
  if (!channel_id || !name || !trigger_type || !message_template) {
    return res.status(400).json({ error: 'channel_id, name, trigger_type, and message_template are required' });
  }
  
  // Verify channel belongs to user
  const channel = await queryOne<NotificationChannel>(
    `SELECT * FROM notification_channels WHERE id = $1 AND user_id = $2`,
    [channel_id, userId]
  );
  
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  
  const id = uuidv4();
  
  await execute(
    `INSERT INTO notification_rules (id, user_id, channel_id, name, trigger_type, filter, message_template)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, userId, channel_id, name, trigger_type, filter ? JSON.stringify(filter) : null, message_template]
  );
  
  const rule = await queryOne<NotificationRule>(`SELECT * FROM notification_rules WHERE id = $1`, [id]);
  res.json({ rule });
});

// Delete notification rule
router.delete('/notifications/rules/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  const { id } = req.params;
  
  const rule = await queryOne<NotificationRule>(
    `SELECT * FROM notification_rules WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  
  if (!rule) {
    return res.status(404).json({ error: 'Rule not found' });
  }
  
  await execute(`DELETE FROM notification_rules WHERE id = $1`, [id]);
  res.json({ success: true });
});

// ============================================
// EVENT LOG
// ============================================

// Get event log
router.get('/events', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;
  
  const events = await query<any>(
    `SELECT * FROM event_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  
  const total = await queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM event_log WHERE user_id = $1`,
    [userId]
  );
  
  res.json({
    events: events.map(e => ({
      ...e,
      payload: e.payload ? JSON.parse(e.payload) : null,
      result: e.result ? JSON.parse(e.result) : null,
    })),
    total: total?.count || 0,
    limit,
    offset,
  });
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((acc, part) => acc?.[part], obj);
}

function replaceTemplateVars(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const value = getNestedValue(data, key.trim());
    return value !== undefined ? String(value) : `{{${key}}}`;
  });
}

function calculateNextRun(cronExpression: string, _timezone: string): string {
  // Simplified next run calculation
  // In production, use a proper cron parser like node-cron or cron-parser
  const now = new Date();
  now.setMinutes(now.getMinutes() + 1);
  return now.toISOString();
}

async function sendNotification(
  channelType: string,
  config: Record<string, any>,
  data: { title: string; message: string; timestamp: string }
): Promise<void> {
  switch (channelType) {
    case 'slack':
      await fetch(config.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*${data.title}*\n${data.message}`,
          attachments: [{ footer: data.timestamp }],
        }),
      });
      break;
      
    case 'discord':
      await fetch(config.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: data.title,
            description: data.message,
            timestamp: data.timestamp,
          }],
        }),
      });
      break;
      
    case 'webhook':
      await fetch(config.url, {
        method: config.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.headers || {}),
        },
        body: JSON.stringify(data),
      });
      break;
      
    case 'email':
      // TODO: Implement email sending (would need SMTP setup)
      console.log('[Notification] Email sending not implemented:', data);
      break;
  }
}

// Export helper for use in other modules
export async function triggerNotifications(
  userId: string,
  triggerType: string,
  eventData: Record<string, any>
) {
  const rules = await query<NotificationRule & { config: string; channel_type: string }>(
    `SELECT nr.*, nc.config, nc.channel_type
     FROM notification_rules nr
     JOIN notification_channels nc ON nr.channel_id = nc.id
     WHERE nr.user_id = $1 AND nr.trigger_type = $2 AND nr.is_active = true AND nc.is_active = true`,
    [userId, triggerType]
  );
  
  for (const rule of rules) {
    // Check filter
    if (rule.filter) {
      const filter = JSON.parse(rule.filter);
      if (filter.agent_id && filter.agent_id !== eventData.agent_id) continue;
      if (filter.workflow_id && filter.workflow_id !== eventData.workflow_id) continue;
    }
    
    // Build message from template
    const message = replaceTemplateVars(rule.message_template, eventData);
    
    try {
      await sendNotification(rule.channel_type, JSON.parse(rule.config), {
        title: `${triggerType.replace('_', ' ').toUpperCase()}`,
        message,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[Notification] Failed to send notification for rule ${rule.id}:`, error);
    }
  }
}

export default router;
