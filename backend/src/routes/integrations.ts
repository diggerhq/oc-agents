import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { queryOne, query, execute } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { getUserOrgRole, ROLE_HIERARCHY } from '../middleware/orgAuth.js';
import type { OrgRole } from '../types/index.js';
import { isConstraintViolation } from '../utils/dbErrors.js';

const router = Router();

// ============================================
// TYPES
// ============================================

interface Integration {
  id: string;
  user_id: string;
  platform: 'slack' | 'discord' | 'teams' | 'linear' | 'jira';
  name: string;
  config: string;
  webhook_secret: string;
  is_active: number;
  default_agent_id: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// CRUD ROUTES
// ============================================

// List all integrations for the user's current organization, filtered by visibility
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId!;
  const orgId = (req as any).organizationId;
  
  let integrations: Integration[];
  
  if (!orgId) {
    // Fall back to user's own integrations (no org context)
    integrations = await query<Integration>(
      `SELECT * FROM integrations WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
  } else {
    // Get user's role in the org
    const userRole = await getUserOrgRole(userId, orgId);
    if (!userRole) {
      return res.json({ integrations: [] });
    }
    const userRoleLevel = ROLE_HIERARCHY[userRole];
    
    // Check if this is a personal org (legacy resources only show in personal org)
    const org = await queryOne<{ is_personal: boolean }>('SELECT is_personal FROM organizations WHERE id = $1', [orgId]);
    const isPersonalOrg = org?.is_personal === true;
    
    // Query integrations with visibility filtering
    // Legacy resources (no org_id) only show in personal org
    integrations = await query<Integration>(
      `SELECT i.*
       FROM integrations i 
       LEFT JOIN resource_permissions rp ON rp.resource_type = 'integration' AND rp.resource_id = i.id
       WHERE (
         i.organization_id = $1 
         OR ($4 = true AND i.organization_id IS NULL AND i.user_id = $2)
       )
         AND (
           rp.id IS NULL
           OR rp.visibility = 'org'
           OR (rp.visibility = 'private' AND i.user_id = $2)
           OR (rp.visibility = 'role' AND $3 >= CASE rp.min_role 
             WHEN 'owner' THEN 3 
             WHEN 'admin' THEN 2 
             WHEN 'member' THEN 1 
             ELSE 1 
           END)
         )
       ORDER BY i.created_at DESC`,
      [orgId, userId, userRoleLevel, isPersonalOrg]
    );
  }
  
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  
  res.json({
    integrations: integrations.map(i => ({
      ...i,
      config: JSON.parse(i.config),
      webhook_url: `${baseUrl}/api/integrations/${i.platform}/webhook/${i.webhook_secret}`,
    })),
  });
});

// Get single integration
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  
  const integration = await queryOne<Integration>(
    `SELECT * FROM integrations WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId]
  );
  
  if (!integration) {
    return res.status(404).json({ error: 'Integration not found' });
  }
  
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  
  res.json({
    integration: {
      ...integration,
      config: JSON.parse(integration.config),
      webhook_url: `${baseUrl}/api/integrations/${integration.platform}/webhook/${integration.webhook_secret}`,
    },
  });
});

// Create integration
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  const { platform, name, config, default_agent_id } = req.body;
  
  if (!platform || !name) {
    return res.status(400).json({ error: 'Platform and name are required' });
  }
  
  const validPlatforms = ['slack', 'discord', 'teams', 'linear', 'jira'];
  if (!validPlatforms.includes(platform)) {
    return res.status(400).json({ error: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}` });
  }
  
  const id = uuidv4();
  
  // Generate webhook secret with retry logic for collision handling
  let webhookSecret: string;
  let attempts = 0;
  const MAX_ATTEMPTS = 3;
  
  while (attempts < MAX_ATTEMPTS) {
    try {
      webhookSecret = crypto.randomBytes(24).toString('hex');
      
      await execute(
        `INSERT INTO integrations (id, user_id, platform, name, config, webhook_secret, default_agent_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, userId, platform, name, JSON.stringify(config || {}), webhookSecret, default_agent_id || null]
      );
      
      break; // Success, exit loop
    } catch (error: any) {
      if (isConstraintViolation(error) && attempts < MAX_ATTEMPTS - 1) {
        console.warn(`[Integrations] Webhook secret collision (attempt ${attempts + 1}), retrying...`);
        attempts++;
        continue; // Try again with new secret
      }
      throw error; // Re-throw if not a collision or out of attempts
    }
  }
  
  const integration = await queryOne<Integration>(`SELECT * FROM integrations WHERE id = $1`, [id]);
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  
  res.status(201).json({
    integration: {
      ...integration,
      config: JSON.parse(integration!.config),
      webhook_url: `${baseUrl}/api/integrations/${platform}/webhook/${webhookSecret!}`,
    },
  });
});

// Update integration
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  const { name, config, is_active, default_agent_id } = req.body;
  
  const integration = await queryOne<Integration>(
    `SELECT * FROM integrations WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId]
  );
  
  if (!integration) {
    return res.status(404).json({ error: 'Integration not found' });
  }
  
  const updates: string[] = [];
  const values: any[] = [];
  const setValue = (col: string, val: any) => {
    values.push(val);
    updates.push(`${col} = $${values.length}`);
  };
  
  if (name !== undefined) setValue('name', name);
  if (config !== undefined) setValue('config', JSON.stringify(config));
  if (is_active !== undefined) setValue('is_active', Boolean(is_active));
  if (default_agent_id !== undefined) setValue('default_agent_id', default_agent_id || null);
  
  if (updates.length > 0) {
    updates.push('updated_at = NOW()');
    values.push(req.params.id);
    await execute(`UPDATE integrations SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
  }
  
  const updated = await queryOne<Integration>(`SELECT * FROM integrations WHERE id = $1`, [req.params.id]);
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  
  res.json({
    integration: {
      ...updated,
      config: JSON.parse(updated!.config),
      webhook_url: `${baseUrl}/api/integrations/${updated!.platform}/webhook/${updated!.webhook_secret}`,
    },
  });
});

// Delete integration
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  
  const integration = await queryOne<Integration>(
    `SELECT * FROM integrations WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId]
  );
  
  if (!integration) {
    return res.status(404).json({ error: 'Integration not found' });
  }
  
  await execute(`DELETE FROM integrations WHERE id = $1`, [req.params.id]);
  res.json({ success: true });
});

// Regenerate webhook secret
router.post('/:id/regenerate-secret', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  
  const integration = await queryOne<Integration>(
    `SELECT * FROM integrations WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId]
  );
  
  if (!integration) {
    return res.status(404).json({ error: 'Integration not found' });
  }
  
  const newSecret = crypto.randomBytes(24).toString('hex');
  await execute(
    `UPDATE integrations SET webhook_secret = $1, updated_at = NOW() WHERE id = $2`,
    [newSecret, req.params.id]
  );
  
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  res.json({
    webhook_secret: newSecret,
    webhook_url: `${baseUrl}/api/integrations/${integration.platform}/webhook/${newSecret}`,
  });
});

// ============================================
// SLACK INTEGRATION
// ============================================

// Slack slash command handler
router.post('/slack/webhook/:secret', async (req: Request, res: Response) => {
  const { secret } = req.params;
  
  const integration = await queryOne<Integration>(
    `SELECT * FROM integrations WHERE webhook_secret = $1 AND platform = 'slack' AND is_active = true`,
    [secret]
  );
  
  if (!integration) {
    return res.status(404).json({ error: 'Integration not found' });
  }
  
  // Slack sends form-urlencoded data for slash commands
  const { text, user_id, user_name, channel_id, channel_name, response_url, command } = req.body;
  
  // Handle Slack URL verification challenge
  if (req.body.type === 'url_verification') {
    return res.json({ challenge: req.body.challenge });
  }
  
  // Update last used
  await execute(`UPDATE integrations SET last_used_at = NOW() WHERE id = $1`, [integration.id]);
  
  const config = JSON.parse(integration.config);
  const agentId = config.agent_id || integration.default_agent_id;
  
  // Handle special commands
  const trimmedText = (text || '').trim();
  
  // STATUS command: /agent status <task_id>
  if (trimmedText.toLowerCase().startsWith('status')) {
    const taskId = trimmedText.slice(6).trim();
    
    if (!taskId) {
      // List recent tasks
      const recentTasks = await query<{ id: string; status: string; prompt: string; created_at: string }>(
        `SELECT id, status, prompt, created_at FROM task_queue 
         WHERE user_id = $1 AND source = 'slack' 
         ORDER BY created_at DESC LIMIT 5`,
        [integration.user_id]
      );
      
      if (recentTasks.length === 0) {
        return res.json({
          response_type: 'ephemeral',
          text: '📋 No recent tasks found.',
        });
      }
      
      const taskList = recentTasks.map(t => {
        const statusEmoji = t.status === 'completed' ? '✅' : t.status === 'failed' ? '❌' : t.status === 'processing' ? '⏳' : '🔄';
        return `${statusEmoji} \`${t.id.slice(0, 8)}\` - ${t.status} - "${t.prompt.slice(0, 30)}..."`;
      }).join('\n');
      
      return res.json({
        response_type: 'ephemeral',
        text: `📋 *Recent Tasks*\n\n${taskList}\n\n_Use \`${command} status <task_id>\` to see details_`,
      });
    }
    
    // Look up specific task (support partial ID)
    const task = await queryOne<{ id: string; status: string; prompt: string; result: string; error: string; created_at: string; completed_at: string }>(
      `SELECT id, status, prompt, result, error, created_at, completed_at FROM task_queue 
       WHERE (id = $1 OR id LIKE $2) AND user_id = $3`,
      [taskId, `${taskId}%`, integration.user_id]
    );
    
    if (!task) {
      return res.json({
        response_type: 'ephemeral',
        text: `❌ Task \`${taskId}\` not found.`,
      });
    }
    
    const statusEmoji = task.status === 'completed' ? '✅' : task.status === 'failed' ? '❌' : task.status === 'processing' ? '⏳' : '🔄';
    
    const blocks: any[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${statusEmoji} *Task Status: ${task.status.toUpperCase()}*`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Task ID:*\n\`${task.id.slice(0, 8)}...\`` },
          { type: 'mrkdwn', text: `*Created:*\n${task.created_at}` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Prompt:*\n>${task.prompt.slice(0, 200)}${task.prompt.length > 200 ? '...' : ''}`,
        },
      },
    ];
    
    if (task.result) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Result:*\n\`\`\`${task.result.slice(0, 500)}${task.result.length > 500 ? '...' : ''}\`\`\``,
        },
      });
    }
    
    if (task.error) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Error:*\n\`\`\`${task.error.slice(0, 300)}\`\`\``,
        },
      });
    }
    
    return res.json({
      response_type: 'ephemeral',
      blocks,
    });
  }
  
  // HELP command
  if (trimmedText.toLowerCase() === 'help') {
    return res.json({
      response_type: 'ephemeral',
      text: `🤖 *Jeff Agent Commands*\n\n` +
        `• \`${command} <task>\` - Run a task with the agent\n` +
        `• \`${command} status\` - List recent tasks\n` +
        `• \`${command} status <id>\` - Check task status\n` +
        `• \`${command} help\` - Show this help\n\n` +
        `_Example: \`${command} fix the login button CSS\`_`,
    });
  }
  
  // Regular task - need agent configured
  if (!agentId) {
    return res.json({
      response_type: 'ephemeral',
      text: '⚠️ No agent configured for this integration. Please set a default agent in Jeff settings.',
    });
  }
  
  // Queue the task
  const taskId = uuidv4();
  const prompt = trimmedText || 'execute';
  
  await execute(
    `INSERT INTO task_queue (id, agent_id, user_id, prompt, status, source)
     VALUES ($1, $2, $3, $4, 'pending', 'slack')`,
    [taskId, agentId, integration.user_id, prompt]
  );
  
  // Store response_url for posting results back
  if (response_url) {
    await execute(
      `UPDATE task_queue SET debug_log = $1 WHERE id = $2`,
      [JSON.stringify({ slack_response_url: response_url, channel_id, user_name }), taskId]
    );
  }
  
  // Log event
  await execute(
    `INSERT INTO event_log (id, user_id, event_type, source_type, source_id, target_type, target_id, status, payload)
     VALUES ($1, $2, 'slack_command', 'webhook', $3, 'agent', $4, 'processing', $5)`,
    [uuidv4(), integration.user_id, integration.id, agentId, JSON.stringify({ user_id, user_name, channel_id, channel_name, command, text })]
  );
  
  // Immediately respond (Slack requires <3s response)
  res.json({
    response_type: 'in_channel',
    text: `🤖 Task queued! Working on: "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"`,
    attachments: [{
      text: `Task ID: \`${taskId}\`\n_Use \`${command} status ${taskId.slice(0, 8)}\` to check progress_`,
      footer: `Triggered by @${user_name}`,
    }],
  });
});

// Slack Events API handler (for @mentions)
router.post('/slack/events/:secret', async (req: Request, res: Response) => {
  const { secret } = req.params;
  
  // Handle Slack URL verification
  if (req.body.type === 'url_verification') {
    return res.json({ challenge: req.body.challenge });
  }
  
  const integration = await queryOne<Integration>(
    `SELECT * FROM integrations WHERE webhook_secret = $1 AND platform = 'slack' AND is_active = true`,
    [secret]
  );
  
  if (!integration) {
    return res.status(404).json({ error: 'Integration not found' });
  }
  
  const event = req.body.event;
  if (!event) {
    return res.json({ ok: true });
  }
  
  // Handle app_mention events
  if (event.type === 'app_mention') {
    const text = event.text.replace(/<@[^>]+>/g, '').trim();
    const config = JSON.parse(integration.config);
    const agentId = config.agent_id || integration.default_agent_id;
    
    if (agentId && text) {
      const taskId = uuidv4();
      await execute(
        `INSERT INTO task_queue (id, agent_id, user_id, prompt, status, source)
         VALUES ($1, $2, $3, $4, 'pending', 'slack')`,
        [taskId, agentId, integration.user_id, text]
      );
    }
  }
  
  // Respond immediately
  res.json({ ok: true });
});

// ============================================
// DISCORD INTEGRATION
// ============================================

// Discord webhook handler
router.post('/discord/webhook/:secret', async (req: Request, res: Response) => {
  const { secret } = req.params;
  
  const integration = await queryOne<Integration>(
    `SELECT * FROM integrations WHERE webhook_secret = $1 AND platform = 'discord' AND is_active = true`,
    [secret]
  );
  
  if (!integration) {
    return res.status(404).json({ error: 'Integration not found' });
  }
  
  // Discord Interactions verification
  if (req.body.type === 1) {
    return res.json({ type: 1 }); // PONG
  }
  
  // Slash command (type 2)
  if (req.body.type === 2) {
    const { data, member, channel_id } = req.body;
    const prompt = data.options?.find((o: any) => o.name === 'task')?.value || 'execute';
    
    await execute(`UPDATE integrations SET last_used_at = NOW() WHERE id = $1`, [integration.id]);
    
    const config = JSON.parse(integration.config);
    const agentId = config.agent_id || integration.default_agent_id;
    
    if (!agentId) {
      return res.json({
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: { content: '⚠️ No agent configured for this integration.' },
      });
    }
    
    const taskId = uuidv4();
    await execute(
      `INSERT INTO task_queue (id, agent_id, user_id, prompt, status, source)
       VALUES ($1, $2, $3, $4, 'pending', 'discord')`,
      [taskId, agentId, integration.user_id, prompt]
    );
    
    return res.json({
      type: 4,
      data: {
        content: `🤖 Task queued: "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"`,
        embeds: [{
          title: 'Task Created',
          fields: [{ name: 'Task ID', value: taskId, inline: true }],
          footer: { text: `Triggered by ${member?.user?.username || 'Unknown'}` },
          color: 0x5865F2,
        }],
      },
    });
  }
  
  res.json({ ok: true });
});

// ============================================
// MICROSOFT TEAMS INTEGRATION
// ============================================

// Teams webhook handler (Outgoing Webhook or Bot)
router.post('/teams/webhook/:secret', async (req: Request, res: Response) => {
  const { secret } = req.params;
  
  const integration = await queryOne<Integration>(
    `SELECT * FROM integrations WHERE webhook_secret = $1 AND platform = 'teams' AND is_active = true`,
    [secret]
  );
  
  if (!integration) {
    return res.status(404).json({ error: 'Integration not found' });
  }
  
  const { type, text, from, conversation } = req.body;
  
  // Teams sends HTML-formatted text, extract plain text
  let prompt = text?.replace(/<[^>]*>/g, '').trim() || 'execute';
  // Remove bot mention
  prompt = prompt.replace(/@\w+/g, '').trim();
  
  await execute(`UPDATE integrations SET last_used_at = NOW() WHERE id = $1`, [integration.id]);
  
  const config = JSON.parse(integration.config);
  const agentId = config.agent_id || integration.default_agent_id;
  
  if (!agentId) {
    return res.json({
      type: 'message',
      text: '⚠️ No agent configured for this integration. Please set a default agent in Jeff settings.',
    });
  }
  
  const taskId = uuidv4();
  await execute(
    `INSERT INTO task_queue (id, agent_id, user_id, prompt, status, source)
     VALUES ($1, $2, $3, $4, 'pending', 'teams')`,
    [taskId, agentId, integration.user_id, prompt]
  );
  
  // Log event
  await execute(
    `INSERT INTO event_log (id, user_id, event_type, source_type, source_id, target_type, target_id, status, payload)
     VALUES ($1, $2, 'teams_message', 'webhook', $3, 'agent', $4, 'processing', $5)`,
    [uuidv4(), integration.user_id, integration.id, agentId, JSON.stringify({ type, from, conversation })]
  );
  
  // Respond in Teams Adaptive Card format
  res.json({
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: '🤖 Task Queued',
            weight: 'Bolder',
            size: 'Medium',
          },
          {
            type: 'TextBlock',
            text: `Working on: "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"`,
            wrap: true,
          },
          {
            type: 'FactSet',
            facts: [{ title: 'Task ID', value: taskId }],
          },
        ],
      },
    }],
  });
});

// ============================================
// LINEAR INTEGRATION
// ============================================

// Linear webhook handler
router.post('/linear/webhook/:secret', async (req: Request, res: Response) => {
  const { secret } = req.params;
  
  const integration = await queryOne<Integration>(
    `SELECT * FROM integrations WHERE webhook_secret = $1 AND platform = 'linear' AND is_active = true`,
    [secret]
  );
  
  if (!integration) {
    return res.status(404).json({ error: 'Integration not found' });
  }
  
  const config = JSON.parse(integration.config);
  const { action, type, data, url } = req.body;
  
  // Filter events based on config
  const allowedActions = config.trigger_on || ['create'];
  const allowedTypes = config.issue_types || ['Issue'];
  
  if (!allowedActions.includes(action) || !allowedTypes.includes(type)) {
    return res.json({ ok: true, skipped: true });
  }
  
  await execute(`UPDATE integrations SET last_used_at = NOW() WHERE id = $1`, [integration.id]);
  
  const agentId = config.agent_id || integration.default_agent_id;
  
  if (!agentId) {
    return res.json({ ok: true, error: 'No agent configured' });
  }
  
  // Build prompt from Linear issue data
  let prompt = config.prompt_template || 'Handle this Linear issue:\n\nTitle: {{title}}\nDescription: {{description}}\nLabels: {{labels}}\nPriority: {{priority}}';
  
  const issueData = {
    title: data?.title || 'Untitled',
    description: data?.description || 'No description',
    labels: data?.labels?.map((l: any) => l.name).join(', ') || 'None',
    priority: data?.priority || 'None',
    state: data?.state?.name || 'Unknown',
    url: url || data?.url || '',
    id: data?.id || '',
    identifier: data?.identifier || '',
  };
  
  // Replace template variables
  for (const [key, value] of Object.entries(issueData)) {
    prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
  }
  
  const taskId = uuidv4();
  await execute(
    `INSERT INTO task_queue (id, agent_id, user_id, prompt, status, source)
     VALUES ($1, $2, $3, $4, 'pending', 'linear')`,
    [taskId, agentId, integration.user_id, prompt]
  );
  
  // Log event
  await execute(
    `INSERT INTO event_log (id, user_id, event_type, source_type, source_id, target_type, target_id, status, payload)
     VALUES ($1, $2, 'linear_webhook', 'webhook', $3, 'agent', $4, 'processing', $5)`,
    [uuidv4(), integration.user_id, integration.id, agentId, JSON.stringify({ action, type, data })]
  );
  
  res.json({ ok: true, task_id: taskId });
});

// ============================================
// JIRA INTEGRATION
// ============================================

// Jira webhook handler
router.post('/jira/webhook/:secret', async (req: Request, res: Response) => {
  const { secret } = req.params;
  
  const integration = await queryOne<Integration>(
    `SELECT * FROM integrations WHERE webhook_secret = $1 AND platform = 'jira' AND is_active = true`,
    [secret]
  );
  
  if (!integration) {
    return res.status(404).json({ error: 'Integration not found' });
  }
  
  const config = JSON.parse(integration.config);
  const { webhookEvent, issue, user, changelog } = req.body;
  
  // Filter events based on config
  const allowedEvents = config.trigger_on || ['jira:issue_created'];
  
  if (!allowedEvents.includes(webhookEvent)) {
    return res.json({ ok: true, skipped: true });
  }
  
  // Filter by project if configured
  if (config.projects && config.projects.length > 0) {
    const projectKey = issue?.fields?.project?.key;
    if (!config.projects.includes(projectKey)) {
      return res.json({ ok: true, skipped: true, reason: 'Project not in filter' });
    }
  }
  
  // Filter by issue type if configured
  if (config.issue_types && config.issue_types.length > 0) {
    const issueType = issue?.fields?.issuetype?.name;
    if (!config.issue_types.includes(issueType)) {
      return res.json({ ok: true, skipped: true, reason: 'Issue type not in filter' });
    }
  }
  
  await execute(`UPDATE integrations SET last_used_at = NOW() WHERE id = $1`, [integration.id]);
  
  const agentId = config.agent_id || integration.default_agent_id;
  
  if (!agentId) {
    return res.json({ ok: true, error: 'No agent configured' });
  }
  
  // Build prompt from Jira issue data
  let prompt = config.prompt_template || 'Handle this Jira issue:\n\nKey: {{key}}\nSummary: {{summary}}\nDescription: {{description}}\nType: {{type}}\nPriority: {{priority}}\nStatus: {{status}}';
  
  const issueData = {
    key: issue?.key || 'Unknown',
    summary: issue?.fields?.summary || 'No summary',
    description: issue?.fields?.description || 'No description',
    type: issue?.fields?.issuetype?.name || 'Unknown',
    priority: issue?.fields?.priority?.name || 'None',
    status: issue?.fields?.status?.name || 'Unknown',
    project: issue?.fields?.project?.name || 'Unknown',
    project_key: issue?.fields?.project?.key || '',
    assignee: issue?.fields?.assignee?.displayName || 'Unassigned',
    reporter: issue?.fields?.reporter?.displayName || 'Unknown',
    labels: issue?.fields?.labels?.join(', ') || 'None',
    url: issue?.self?.replace('/rest/api/2/issue/', '/browse/') || '',
  };
  
  // Replace template variables
  for (const [key, value] of Object.entries(issueData)) {
    prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
  }
  
  const taskId = uuidv4();
  await execute(
    `INSERT INTO task_queue (id, agent_id, user_id, prompt, status, source)
     VALUES ($1, $2, $3, $4, 'pending', 'jira')`,
    [taskId, agentId, integration.user_id, prompt]
  );
  
  // Log event
  await execute(
    `INSERT INTO event_log (id, user_id, event_type, source_type, source_id, target_type, target_id, status, payload)
     VALUES ($1, $2, 'jira_webhook', 'webhook', $3, 'agent', $4, 'processing', $5)`,
    [uuidv4(), integration.user_id, integration.id, agentId, JSON.stringify({ webhookEvent, issue: { key: issue?.key, summary: issue?.fields?.summary } })]
  );
  
  res.json({ ok: true, task_id: taskId });
});

// ============================================
// TEST INTEGRATION
// ============================================

router.post('/:id/test', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).session.userId;
  
  const integration = await queryOne<Integration>(
    `SELECT * FROM integrations WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId]
  );
  
  if (!integration) {
    return res.status(404).json({ error: 'Integration not found' });
  }
  
  const config = JSON.parse(integration.config);
  const agentId = config.agent_id || integration.default_agent_id;
  
  if (!agentId) {
    return res.status(400).json({ error: 'No agent configured. Set a default agent first.' });
  }
  
  // Create a test task
  const taskId = uuidv4();
  await execute(
    `INSERT INTO task_queue (id, agent_id, user_id, prompt, status, source)
     VALUES ($1, $2, $3, 'Test integration: respond with "Integration test successful!"', 'pending', $4)`,
    [taskId, agentId, userId, integration.platform]
  );
  
  res.json({
    success: true,
    message: `Test task created for ${integration.platform} integration`,
    task_id: taskId,
  });
});

// ============================================
// PLATFORM-SPECIFIC SETUP INFO
// ============================================

router.get('/setup/:platform', requireAuth, async (req: Request, res: Response) => {
  const { platform } = req.params;
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  
  const setupInfo: Record<string, any> = {
    slack: {
      name: 'Slack',
      icon: 'slack',
      description: 'Summon agents with slash commands or @mentions',
      steps: [
        'Create a Slack App at api.slack.com/apps',
        'Add a Slash Command (e.g., /agent)',
        'Set the Request URL to your webhook URL',
        'Install the app to your workspace',
        'Optionally enable Events API for @mentions',
      ],
      features: ['Slash commands', '@mentions', 'Channel responses'],
      config_fields: [
        { key: 'agent_id', label: 'Agent', type: 'agent_select', required: false },
        { key: 'post_results', label: 'Post results to channel', type: 'boolean', default: true },
      ],
    },
    discord: {
      name: 'Discord',
      icon: 'discord',
      description: 'Run agents with slash commands in Discord',
      steps: [
        'Create a Discord Application at discord.com/developers',
        'Create a Bot and get the token',
        'Add Interactions Endpoint URL (your webhook)',
        'Invite bot to your server with applications.commands scope',
        'Register slash commands via Discord API',
      ],
      features: ['Slash commands', 'Embeds', 'Bot responses'],
      config_fields: [
        { key: 'agent_id', label: 'Agent', type: 'agent_select', required: false },
        { key: 'application_id', label: 'Application ID', type: 'text', required: true },
        { key: 'public_key', label: 'Public Key', type: 'text', required: true },
      ],
    },
    teams: {
      name: 'Microsoft Teams',
      icon: 'teams',
      description: 'Trigger agents from Microsoft Teams',
      steps: [
        'Create an Outgoing Webhook in Teams channel settings',
        'Or create a Bot via Azure Bot Service',
        'Set the callback URL to your webhook',
        'Teams will send messages mentioning the webhook',
      ],
      features: ['Outgoing webhooks', 'Adaptive Cards', 'Bot framework'],
      config_fields: [
        { key: 'agent_id', label: 'Agent', type: 'agent_select', required: false },
        { key: 'security_token', label: 'Security Token (HMAC)', type: 'text', required: false },
      ],
    },
    linear: {
      name: 'Linear',
      icon: 'linear',
      description: 'Automatically process Linear issues with agents',
      steps: [
        'Go to Linear Settings > API > Webhooks',
        'Create a new webhook with your webhook URL',
        'Select events: Issue created, updated, etc.',
        'Configure which labels/projects trigger agents',
      ],
      features: ['Issue triggers', 'Label filters', 'Custom prompts'],
      config_fields: [
        { key: 'agent_id', label: 'Agent', type: 'agent_select', required: false },
        { key: 'trigger_on', label: 'Trigger on', type: 'multi_select', options: ['create', 'update', 'remove'], default: ['create'] },
        { key: 'labels', label: 'Filter by labels', type: 'tags', required: false },
        { key: 'prompt_template', label: 'Prompt template', type: 'textarea', default: 'Handle this Linear issue:\n\nTitle: {{title}}\nDescription: {{description}}' },
      ],
    },
    jira: {
      name: 'Jira',
      icon: 'jira',
      description: 'Process Jira issues automatically',
      steps: [
        'Go to Jira Settings > System > Webhooks',
        'Create a new webhook with your webhook URL',
        'Select events and optionally filter by JQL',
        'Configure which projects/issue types trigger agents',
      ],
      features: ['Issue triggers', 'Project filters', 'JQL support', 'Custom prompts'],
      config_fields: [
        { key: 'agent_id', label: 'Agent', type: 'agent_select', required: false },
        { key: 'trigger_on', label: 'Trigger on', type: 'multi_select', options: ['jira:issue_created', 'jira:issue_updated', 'jira:issue_deleted'], default: ['jira:issue_created'] },
        { key: 'projects', label: 'Filter by projects', type: 'tags', required: false },
        { key: 'issue_types', label: 'Filter by issue types', type: 'tags', required: false },
        { key: 'prompt_template', label: 'Prompt template', type: 'textarea', default: 'Handle this Jira issue:\n\nKey: {{key}}\nSummary: {{summary}}\nDescription: {{description}}' },
      ],
    },
  };
  
  if (!setupInfo[platform]) {
    return res.status(404).json({ error: 'Unknown platform' });
  }
  
  res.json({
    ...setupInfo[platform],
    webhook_base_url: `${baseUrl}/api/integrations/${platform}/webhook/`,
  });
});

export default router;
