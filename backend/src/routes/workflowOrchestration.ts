import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, query, execute } from '../db/index.js';

// Postgres-only datetime helpers (simplified - no longer cross-database)
const NOW = () => 'NOW()';
const TIME_AGO_10_MIN = () => "NOW() - INTERVAL '10 minutes'";
import { requireAuth } from '../middleware/auth.js';
import { getUserOrgRole, ROLE_HIERARCHY } from '../middleware/orgAuth.js';
import { withConstraintHandling } from '../utils/dbErrors.js';
import { broadcast, sendWorkflowNodeStatus, sendWorkflowRunStatus } from '../services/websocket.js';
import type { OrgRole } from '../types/index.js';

// ============================================
// NOTIFICATION HELPERS
// ============================================

interface Integration {
  id: string;
  user_id: string;
  platform: string;
  name: string;
  config: string;
  webhook_url: string;
  is_active: number;
}

async function sendHumanCheckpointNotifications(
  userId: string,
  workflow: Workflow,
  runId: string,
  nodeName: string,
  message: string
) {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const approvalUrl = `${baseUrl}/workflows/${workflow.id}?run=${runId}`;
  
  // Get user's active integrations
  const integrations = await query<Integration>(
    `SELECT * FROM integrations WHERE user_id = $1 AND is_active = true`,
    [userId]
  );
  
  for (const integration of integrations) {
    try {
      // Skip if no webhook URL configured or invalid
      if (!integration.webhook_url || integration.webhook_url === 'undefined' || !integration.webhook_url.startsWith('http')) {
        console.log(`[Workflow] Skipping ${integration.platform} notification - no valid webhook URL configured`);
        continue;
      }
      
      const config = JSON.parse(integration.config || '{}');
      
      if (integration.platform === 'slack') {
        await fetch(integration.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `⏸️ *Human Approval Required*\n\nWorkflow "${workflow.name}" is waiting for your approval at "${nodeName}".\n\n${message || 'Please review and approve to continue.'}\n\n<${approvalUrl}|Click here to review>`,
            attachments: [{
              color: '#8b5cf6',
              fields: [
                { title: 'Workflow', value: workflow.name, short: true },
                { title: 'Checkpoint', value: nodeName, short: true },
              ],
              actions: [
                {
                  type: 'button',
                  text: 'Review & Approve',
                  url: approvalUrl,
                  style: 'primary',
                },
              ],
            }],
          }),
        });
        console.log(`[Workflow] Sent Slack notification for human checkpoint to ${integration.name}`);
      } else if (integration.platform === 'discord') {
        await fetch(integration.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: '⏸️ Human Approval Required',
              description: `Workflow **${workflow.name}** is waiting for your approval at **${nodeName}**.\n\n${message || 'Please review and approve to continue.'}`,
              color: 0x8b5cf6,
              fields: [
                { name: 'Workflow', value: workflow.name, inline: true },
                { name: 'Checkpoint', value: nodeName, inline: true },
              ],
              url: approvalUrl,
              timestamp: new Date().toISOString(),
            }],
          }),
        });
        console.log(`[Workflow] Sent Discord notification for human checkpoint to ${integration.name}`);
      } else if (integration.platform === 'teams') {
        // Microsoft Teams webhook
        await fetch(integration.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            '@type': 'MessageCard',
            '@context': 'http://schema.org/extensions',
            themeColor: '8b5cf6',
            summary: 'Human Approval Required',
            sections: [{
              activityTitle: '⏸️ Human Approval Required',
              facts: [
                { name: 'Workflow', value: workflow.name },
                { name: 'Checkpoint', value: nodeName },
                { name: 'Message', value: message || 'Please review and approve to continue.' },
              ],
            }],
            potentialAction: [{
              '@type': 'OpenUri',
              name: 'Review & Approve',
              targets: [{ os: 'default', uri: approvalUrl }],
            }],
          }),
        });
        console.log(`[Workflow] Sent Teams notification for human checkpoint to ${integration.name}`);
      }
    } catch (error) {
      console.error(`[Workflow] Failed to send notification via ${integration.platform}:`, error);
    }
  }
}

const router = Router();

// ============================================
// TYPES
// ============================================

interface Workflow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  max_retries: number;
  timeout_seconds: number;
  canvas_state: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface WorkflowNode {
  id: string;
  workflow_id: string;
  node_type: 'start' | 'end' | 'agent' | 'condition' | 'human_checkpoint' | 'parallel_split' | 'parallel_merge' | 'transform' | 'delay';
  name: string;
  description: string | null;
  position_x: number;
  position_y: number;
  config: string;
  created_at: string;
}

interface WorkflowEdge {
  id: string;
  workflow_id: string;
  source_node_id: string;
  target_node_id: string;
  condition_label: string | null;
  edge_order: number;
  created_at: string;
}

interface WorkflowRun {
  id: string;
  workflow_id: string;
  user_id: string;
  input_data: string;
  output_data: string | null;
  context: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  current_node_id: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface WorkflowNodeRun {
  id: string;
  workflow_run_id: string;
  node_id: string;
  input_data: string | null;
  output_data: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting_human';
  retry_count: number;
  error: string | null;
  task_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// ============================================
// WORKFLOW CRUD
// ============================================

// List all workflows for user's current organization, filtered by visibility
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const orgId = (req as any).organizationId;
  
  let workflows: Workflow[];
  
  if (!orgId) {
    // Fall back to user's own workflows (no org context)
    workflows = await query<Workflow>(
      `SELECT * FROM workflows WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );
  } else {
    // Get user's role in the org
    const userRole = await getUserOrgRole(userId, orgId);
    if (!userRole) {
      return res.json({ workflows: [] });
    }
    const userRoleLevel = ROLE_HIERARCHY[userRole];
    
    // Check if this is a personal org (legacy resources only show in personal org)
    const org = await queryOne<{ is_personal: boolean }>('SELECT is_personal FROM organizations WHERE id = $1', [orgId]);
    const isPersonalOrg = org?.is_personal === true;
    
    // Query workflows with visibility filtering
    // Legacy resources (no org_id) only show in personal org
    workflows = await query<Workflow>(
      `SELECT w.*
       FROM workflows w 
       LEFT JOIN resource_permissions rp ON rp.resource_type = 'workflow' AND rp.resource_id = w.id
       WHERE (
         w.organization_id = $1 
         OR ($4 = true AND w.organization_id IS NULL AND w.user_id = $2)
       )
         AND (
           rp.id IS NULL
           OR rp.visibility = 'org'
           OR (rp.visibility = 'private' AND w.user_id = $2)
           OR (rp.visibility = 'role' AND $3 >= CASE rp.min_role 
             WHEN 'owner' THEN 3 
             WHEN 'admin' THEN 2 
             WHEN 'member' THEN 1 
             ELSE 1 
           END)
         )
       ORDER BY w.updated_at DESC`,
      [orgId, userId, userRoleLevel, isPersonalOrg]
    );
  }
  
  // Get node and run counts for each workflow
  const workflowsWithCounts = await Promise.all(workflows.map(async w => {
    const nodeCount = (await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM workflow_nodes WHERE workflow_id = $1`,
      [w.id]
    ))?.count || 0;
    
    const runCount = (await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM workflow_runs WHERE workflow_id = $1`,
      [w.id]
    ))?.count || 0;
    
    const lastRun = await queryOne<WorkflowRun>(
      `SELECT * FROM workflow_runs WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [w.id]
    );
    
    return {
      ...w,
      node_count: nodeCount,
      run_count: runCount,
      last_run: lastRun,
    };
  }));
  
  res.json({ workflows: workflowsWithCounts });
});

// Get all pending approvals (human checkpoints) for user
router.get('/pending-approvals', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  
  const pendingApprovals = await query<{
    run_id: string;
    workflow_id: string;
    workflow_name: string;
    workflow_description: string;
    node_id: string;
    node_name: string;
    node_config: string;
    input_data: string;
    context: string;
    started_at: string;
    paused_at: string;
  }>(
    `SELECT 
      wr.id as run_id,
      wr.workflow_id,
      w.name as workflow_name,
      w.description as workflow_description,
      wr.current_node_id as node_id,
      wn.name as node_name,
      wn.config as node_config,
      wr.input_data,
      wr.context,
      wr.started_at,
      wr.created_at as paused_at
     FROM workflow_runs wr
     JOIN workflows w ON wr.workflow_id = w.id
     LEFT JOIN workflow_nodes wn ON wr.current_node_id = wn.id
     WHERE wr.user_id = $1 AND wr.status = 'paused'
     ORDER BY wr.created_at DESC`,
    [userId]
  );
  
  // Enrich each approval with node history
  const enrichedApprovals = await Promise.all(pendingApprovals.map(async (a) => {
    let message = 'Awaiting approval';
    let checkpointConfig: any = {};
    try {
      checkpointConfig = JSON.parse(a.node_config || '{}');
      message = checkpointConfig.message || message;
    } catch {}
    
    // Get completed node runs for context
    const nodeHistory = await query<{
      node_id: string;
      node_name: string;
      node_type: string;
      status: string;
      output_data: string;
      completed_at: string;
    }>(
      `SELECT 
        wn.id as node_id,
        wn.name as node_name,
        wn.node_type,
        wnr.status,
        wnr.output_data,
        wnr.completed_at
       FROM workflow_node_runs wnr
       JOIN workflow_nodes wn ON wnr.node_id = wn.id
       WHERE wnr.workflow_run_id = $1 AND wnr.status = 'completed'
       ORDER BY wnr.completed_at ASC`,
      [a.run_id]
    );
    
    // Get all agent nodes in workflow that could be loop-back targets
    const loopBackTargets = await query<{
      id: string;
      name: string;
      node_type: string;
    }>(
      `SELECT id, name, node_type FROM workflow_nodes 
       WHERE workflow_id = $1 AND node_type = 'agent'
       ORDER BY position_y, position_x`,
      [a.workflow_id]
    );
    
    // Determine if loop back is supported
    const supportsLoopBack = checkpointConfig.allow_loop_back !== false && loopBackTargets.length > 0;
    const defaultLoopBackNodeId = checkpointConfig.loop_back_node_id || 
      (nodeHistory.length > 0 ? nodeHistory[nodeHistory.length - 1].node_id : null);
    
    return {
      run_id: a.run_id,
      workflow_id: a.workflow_id,
      workflow_name: a.workflow_name,
      workflow_description: a.workflow_description,
      node_id: a.node_id,
      node_name: a.node_name,
      message,
      checkpoint_config: checkpointConfig,
      input_data: JSON.parse(a.input_data || '{}'),
      context: JSON.parse(a.context || '{}'),
      started_at: a.started_at,
      paused_at: a.paused_at,
      node_history: nodeHistory.map(n => ({
        node_id: n.node_id,
        node_name: n.node_name,
        node_type: n.node_type,
        status: n.status,
        output: JSON.parse(n.output_data || '{}'),
        completed_at: n.completed_at,
      })),
      // Loop-back options
      supports_loop_back: supportsLoopBack,
      loop_back_targets: loopBackTargets,
      default_loop_back_node_id: defaultLoopBackNodeId,
      max_loops: checkpointConfig.max_loops || 5,
      current_loop_count: JSON.parse(a.context || '{}')._loop_count || 0,
    };
  }));
  
  res.json({ pending_approvals: enrichedApprovals, count: enrichedApprovals.length });
});

// Get single workflow with all nodes and edges
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { id } = req.params;
  
  const workflow = await queryOne<Workflow>(
    `SELECT * FROM workflows WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  
  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }
  
  const nodes = await query<WorkflowNode>(
    `SELECT * FROM workflow_nodes WHERE workflow_id = $1 ORDER BY created_at`,
    [id]
  );
  
  const edges = await query<WorkflowEdge>(
    `SELECT * FROM workflow_edges WHERE workflow_id = $1 ORDER BY edge_order`,
    [id]
  );
  
  res.json({ workflow, nodes, edges });
});

// Create workflow
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { name, description } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  const workflowId = uuidv4();
  const startNodeId = uuidv4();
  const endNodeId = uuidv4();
  
  // Create workflow
  await execute(
    `INSERT INTO workflows (id, user_id, name, description) VALUES ($1, $2, $3, $4)`,
    [workflowId, userId, name, description || null]
  );
  
  // Create start and end nodes
  await execute(
    `INSERT INTO workflow_nodes (id, workflow_id, node_type, name, position_x, position_y, config)
     VALUES ($1, $2, 'start', 'Start', 100, 200, '{}')`,
    [startNodeId, workflowId]
  );
  
  await execute(
    `INSERT INTO workflow_nodes (id, workflow_id, node_type, name, position_x, position_y, config)
     VALUES ($1, $2, 'end', 'End', 600, 200, '{}')`,
    [endNodeId, workflowId]
  );
  
  const workflow = await queryOne<Workflow>(`SELECT * FROM workflows WHERE id = $1`, [workflowId]);
  const nodes = await query<WorkflowNode>(`SELECT * FROM workflow_nodes WHERE workflow_id = $1`, [workflowId]);
  const edges = await query<WorkflowEdge>(`SELECT * FROM workflow_edges WHERE workflow_id = $1`, [workflowId]);
  
  res.json({ workflow, nodes, edges });
});

// Update workflow
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { id } = req.params;
  const { name, description, max_retries, timeout_seconds, canvas_state, is_active } = req.body;
  
  const workflow = await queryOne<Workflow>(
    `SELECT * FROM workflows WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  
  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }
  
  await execute(
    `UPDATE workflows SET 
      name = COALESCE($1, name),
      description = COALESCE($2, description),
      max_retries = COALESCE($3, max_retries),
      timeout_seconds = COALESCE($4, timeout_seconds),
      canvas_state = COALESCE($5, canvas_state),
      is_active = COALESCE($6, is_active),
      updated_at = NOW()
     WHERE id = $7`,
    [name, description, max_retries, timeout_seconds, canvas_state, is_active, id]
  );
  
  const updated = await queryOne<Workflow>(`SELECT * FROM workflows WHERE id = $1`, [id]);
  res.json({ workflow: updated });
});

// Delete workflow
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { id } = req.params;
  
  const workflow = await queryOne<Workflow>(
    `SELECT * FROM workflows WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  
  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }
  
  try {
    // Get all workflow runs to delete their node runs first
    const workflowRuns = await query<{ id: string }>(
      `SELECT id FROM workflow_runs WHERE workflow_id = $1`,
      [id]
    );
    
    // Delete workflow node runs for each workflow run
    for (const workflowRun of workflowRuns) {
      await execute(`DELETE FROM workflow_node_runs WHERE workflow_run_id = $1`, [workflowRun.id]);
    }
    
    // Delete workflow runs
    await execute(`DELETE FROM workflow_runs WHERE workflow_id = $1`, [id]);
    
    // Delete edges (should cascade, but be explicit)
    await execute(`DELETE FROM workflow_edges WHERE workflow_id = $1`, [id]);
    
    // Delete nodes (should cascade, but be explicit)
    await execute(`DELETE FROM workflow_nodes WHERE workflow_id = $1`, [id]);
    
    // Finally delete the workflow
    await execute(`DELETE FROM workflows WHERE id = $1`, [id]);
    
    res.json({ success: true });
  } catch (error: any) {
    console.error(`[Workflow] Failed to delete workflow ${id}:`, error);
    res.status(500).json({ error: error.message || 'Failed to delete workflow' });
  }
});

// ============================================
// WORKFLOW BUCKETS
// ============================================

// Get buckets attached to workflow
router.get('/:workflowId/buckets', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { workflowId } = req.params;
  
  try {
    // Verify workflow ownership
    const workflow = await queryOne<Workflow>(
      `SELECT * FROM workflows WHERE id = $1 AND user_id = $2`,
      [workflowId, userId]
    );
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    
    // Get attached buckets with bucket details
    const buckets = await query(
      `SELECT wb.id, wb.workflow_id, wb.bucket_id, wb.mount_path, wb.read_only, wb.created_at,
              b.name as bucket_name
       FROM workflow_buckets wb
       JOIN buckets b ON b.id = wb.bucket_id
       WHERE wb.workflow_id = $1`,
      [workflowId]
    );
    
    res.json({ buckets });
  } catch (error: any) {
    console.error(`[Workflow] Failed to get buckets:`, error);
    res.status(500).json({ error: error.message || 'Failed to get buckets' });
  }
});

// Attach bucket to workflow
router.post('/:workflowId/buckets', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { workflowId } = req.params;
  const { bucket_id, mount_path, read_only } = req.body;
  
  try {
    // Verify workflow ownership
    const workflow = await queryOne<Workflow>(
      `SELECT * FROM workflows WHERE id = $1 AND user_id = $2`,
      [workflowId, userId]
    );
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    
    // Verify bucket ownership
    const bucket = await queryOne(
      `SELECT * FROM buckets WHERE id = $1 AND user_id = $2`,
      [bucket_id, userId]
    );
    if (!bucket) {
      return res.status(404).json({ error: 'Bucket not found' });
    }
    
    // Check if already attached
    const existing = await queryOne(
      `SELECT * FROM workflow_buckets WHERE workflow_id = $1 AND bucket_id = $2`,
      [workflowId, bucket_id]
    );
    if (existing) {
      return res.status(400).json({ error: 'Bucket already attached to this workflow' });
    }
    
    const id = crypto.randomUUID();
    const mountPathValue = mount_path || '/home/user/workspace/files';
    
    // Wrap in constraint handling for race conditions
    await withConstraintHandling(async () => {
      await execute(
        `INSERT INTO workflow_buckets (id, workflow_id, bucket_id, mount_path, read_only)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, workflowId, bucket_id, mountPathValue, Boolean(read_only)]
      );
    }, 'workflow bucket');
    
    res.json({ 
      id,
      workflow_id: workflowId,
      bucket_id,
      mount_path: mountPathValue,
      read_only: Boolean(read_only)
    });
  } catch (error: any) {
    if (error.code === 'DUPLICATE_RESOURCE') {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        field: error.field
      });
    }
    console.error(`[Workflow] Failed to attach bucket:`, error);
    res.status(500).json({ error: error.message || 'Failed to attach bucket' });
  }
});

// Detach bucket from workflow
router.delete('/:workflowId/buckets/:bucketId', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { workflowId, bucketId } = req.params;
  
  try {
    // Verify workflow ownership
    const workflow = await queryOne<Workflow>(
      `SELECT * FROM workflows WHERE id = $1 AND user_id = $2`,
      [workflowId, userId]
    );
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    
    await execute(
      `DELETE FROM workflow_buckets WHERE workflow_id = $1 AND bucket_id = $2`,
      [workflowId, bucketId]
    );
    
    res.json({ success: true });
  } catch (error: any) {
    console.error(`[Workflow] Failed to detach bucket:`, error);
    res.status(500).json({ error: error.message || 'Failed to detach bucket' });
  }
});

// ============================================
// NODE CRUD
// ============================================

// Add node to workflow
router.post('/:workflowId/nodes', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { workflowId } = req.params;
  const { node_type, name, description, position_x, position_y, config } = req.body;
  
  const workflow = await queryOne<Workflow>(
    `SELECT * FROM workflows WHERE id = $1 AND user_id = $2`,
    [workflowId, userId]
  );
  
  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }
  
  const nodeId = uuidv4();
  
  await execute(
    `INSERT INTO workflow_nodes (id, workflow_id, node_type, name, description, position_x, position_y, config)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [nodeId, workflowId, node_type, name, description || null, position_x || 0, position_y || 0, JSON.stringify(config || {})]
  );
  
  // Update workflow timestamp
  await execute(`UPDATE workflows SET updated_at = NOW() WHERE id = $1`, [workflowId]);
  
  const node = await queryOne<WorkflowNode>(`SELECT * FROM workflow_nodes WHERE id = $1`, [nodeId]);
  res.json({ node });
});

// Update node
router.put('/:workflowId/nodes/:nodeId', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { workflowId, nodeId } = req.params;
  const { name, description, position_x, position_y, config } = req.body;
  
  const workflow = await queryOne<Workflow>(
    `SELECT * FROM workflows WHERE id = $1 AND user_id = $2`,
    [workflowId, userId]
  );
  
  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }
  
  await execute(
    `UPDATE workflow_nodes SET 
      name = COALESCE($1, name),
      description = COALESCE($2, description),
      position_x = COALESCE($3, position_x),
      position_y = COALESCE($4, position_y),
      config = COALESCE($5, config)
     WHERE id = $6 AND workflow_id = $7`,
    [name, description, position_x, position_y, config ? JSON.stringify(config) : null, nodeId, workflowId]
  );
  
  // Update workflow timestamp
  await execute(`UPDATE workflows SET updated_at = NOW() WHERE id = $1`, [workflowId]);
  
  const node = await queryOne<WorkflowNode>(`SELECT * FROM workflow_nodes WHERE id = $1`, [nodeId]);
  res.json({ node });
});

// Delete node
router.delete('/:workflowId/nodes/:nodeId', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { workflowId, nodeId } = req.params;
  
  const workflow = await queryOne<Workflow>(
    `SELECT * FROM workflows WHERE id = $1 AND user_id = $2`,
    [workflowId, userId]
  );
  
  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }
  
  const node = await queryOne<WorkflowNode>(
    `SELECT * FROM workflow_nodes WHERE id = $1 AND workflow_id = $2`,
    [nodeId, workflowId]
  );
  
  if (!node) {
    return res.status(404).json({ error: 'Node not found' });
  }
  
  // Don't allow deleting start/end nodes
  if (node.node_type === 'start' || node.node_type === 'end') {
    return res.status(400).json({ error: 'Cannot delete start or end nodes' });
  }
  
  try {
    // Delete connected edges first (explicit, in case cascade doesn't work)
    await execute(`DELETE FROM workflow_edges WHERE source_node_id = $1 OR target_node_id = $1`, [nodeId]);
    
    // Delete any node runs that reference this node (workflow_node_runs.node_id doesn't have CASCADE)
    await execute(`DELETE FROM workflow_node_runs WHERE node_id = $1`, [nodeId]);
    
    // Delete the node
  await execute(`DELETE FROM workflow_nodes WHERE id = $1`, [nodeId]);
  
  // Update workflow timestamp
  await execute(`UPDATE workflows SET updated_at = NOW() WHERE id = $1`, [workflowId]);
  
  res.json({ success: true });
  } catch (error: any) {
    console.error(`[Workflow] Failed to delete node ${nodeId}:`, error);
    res.status(500).json({ error: error.message || 'Failed to delete node' });
  }
});

// ============================================
// EDGE CRUD
// ============================================

// Add edge
router.post('/:workflowId/edges', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { workflowId } = req.params;
  const { source_node_id, target_node_id, condition_label, edge_order } = req.body;
  
  const workflow = await queryOne<Workflow>(
    `SELECT * FROM workflows WHERE id = $1 AND user_id = $2`,
    [workflowId, userId]
  );
  
  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }
  
  // Verify both nodes exist
  const sourceNode = await queryOne<WorkflowNode>(
    `SELECT * FROM workflow_nodes WHERE id = $1 AND workflow_id = $2`,
    [source_node_id, workflowId]
  );
  const targetNode = await queryOne<WorkflowNode>(
    `SELECT * FROM workflow_nodes WHERE id = $1 AND workflow_id = $2`,
    [target_node_id, workflowId]
  );
  
  if (!sourceNode || !targetNode) {
    return res.status(400).json({ error: 'Invalid node IDs' });
  }
  
  const edgeId = uuidv4();
  
  await execute(
    `INSERT INTO workflow_edges (id, workflow_id, source_node_id, target_node_id, condition_label, edge_order)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [edgeId, workflowId, source_node_id, target_node_id, condition_label || null, edge_order || 0]
  );
  
  // Update workflow timestamp
  await execute(`UPDATE workflows SET updated_at = NOW() WHERE id = $1`, [workflowId]);
  
  const edge = await queryOne<WorkflowEdge>(`SELECT * FROM workflow_edges WHERE id = $1`, [edgeId]);
  res.json({ edge });
});

// Delete edge
router.delete('/:workflowId/edges/:edgeId', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { workflowId, edgeId } = req.params;
  
  const workflow = await queryOne<Workflow>(
    `SELECT * FROM workflows WHERE id = $1 AND user_id = $2`,
    [workflowId, userId]
  );
  
  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }
  
  await execute(`DELETE FROM workflow_edges WHERE id = $1 AND workflow_id = $2`, [edgeId, workflowId]);
  
  // Update workflow timestamp
  await execute(`UPDATE workflows SET updated_at = NOW() WHERE id = $1`, [workflowId]);
  
  res.json({ success: true });
});

// ============================================
// WORKFLOW EXECUTION
// ============================================

// Start workflow run
router.post('/:workflowId/run', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { workflowId } = req.params;
  const { input_data } = req.body;
  
  const workflow = await queryOne<Workflow>(
    `SELECT * FROM workflows WHERE id = $1 AND user_id = $2`,
    [workflowId, userId]
  );
  
  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }
  
  // Create workflow run
  const runId = uuidv4();
  
  await execute(
    `INSERT INTO workflow_runs (id, workflow_id, user_id, input_data, status, started_at)
     VALUES ($1, $2, $3, $4, 'running', NOW())`,
    [runId, workflowId, userId, JSON.stringify(input_data || {})]
  );
  
  const workflowRun = await queryOne<WorkflowRun>(`SELECT * FROM workflow_runs WHERE id = $1`, [runId]);
  
  // Return immediately, execute in background
  res.json({ run: workflowRun });
  
  // Execute workflow in background
  executeWorkflow(runId, workflowId, userId).catch(async err => {
    console.error(`[Workflow] Execution error for run ${runId}:`, err);
    await execute(
      `UPDATE workflow_runs SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
      [err.message, runId]
    );
  });
});

// Get workflow run status
router.get('/:workflowId/runs/:runId', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { workflowId, runId } = req.params;
  
  const workflowRun = await queryOne<WorkflowRun>(
    `SELECT * FROM workflow_runs WHERE id = $1 AND workflow_id = $2 AND user_id = $3`,
    [runId, workflowId, userId]
  );
  
  if (!workflowRun) {
    return res.status(404).json({ error: 'Run not found' });
  }
  
  const nodeRuns = await query<WorkflowNodeRun & { node_name: string; node_type: string }>(
    `SELECT 
      wnr.*,
      wn.name as node_name,
      wn.node_type as node_type
     FROM workflow_node_runs wnr
     LEFT JOIN workflow_nodes wn ON wnr.node_id = wn.id
     WHERE wnr.workflow_run_id = $1 
     ORDER BY wnr.created_at`,
    [runId]
  );
  
  res.json({ run: workflowRun, node_runs: nodeRuns });
});

// List all runs for a workflow
router.get('/:workflowId/runs', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { workflowId } = req.params;
  
  const runs = await query<WorkflowRun>(
    `SELECT * FROM workflow_runs WHERE workflow_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 50`,
    [workflowId, userId]
  );
  
  res.json({ runs });
});

// Resume paused workflow (human checkpoint)
// Supports three actions:
// - approved: true -> continue workflow
// - approved: false, action: 'fail' (default) -> fail workflow
// - approved: false, action: 'loop_back' -> go back to specified node with feedback
router.post('/:workflowId/runs/:runId/resume', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { workflowId, runId } = req.params;
  const { approved, feedback, action = 'fail', loop_back_node_id } = req.body;
  
  const workflowRun = await queryOne<WorkflowRun>(
    `SELECT * FROM workflow_runs WHERE id = $1 AND workflow_id = $2 AND user_id = $3 AND status = 'paused'`,
    [runId, workflowId, userId]
  );
  
  if (!workflowRun) {
    return res.status(404).json({ error: 'Paused run not found' });
  }
  
  // Get the current checkpoint node config
  const checkpointNode = workflowRun.current_node_id ? await queryOne<WorkflowNode>(
    `SELECT * FROM workflow_nodes WHERE id = $1`,
    [workflowRun.current_node_id]
  ) : null;
  
  const checkpointConfig = checkpointNode ? JSON.parse(checkpointNode.config || '{}') : {};
  
  // Update the current node run with human decision
  if (workflowRun.current_node_id) {
    const nodeRun = await queryOne<WorkflowNodeRun>(
      `SELECT * FROM workflow_node_runs WHERE workflow_run_id = $1 AND node_id = $2 AND status = 'waiting_human'`,
      [runId, workflowRun.current_node_id]
    );
    
    if (nodeRun) {
      await execute(
        `UPDATE workflow_node_runs SET 
          status = 'completed',
          output_data = $1,
          completed_at = NOW()
         WHERE id = $2`,
        [JSON.stringify({ approved, feedback, action }), nodeRun.id]
      );
    }
  }
  
  // Handle the three possible outcomes
  if (approved) {
    // Approved: continue workflow forward
  await execute(
    `UPDATE workflow_runs SET status = 'running', current_node_id = NULL WHERE id = $1`,
    [runId]
  );
  
  res.json({ success: true, message: 'Workflow resumed' });
  
    continueWorkflow(runId, workflowRun.current_node_id!, { approved, feedback }).catch(err => {
      console.error(`[Workflow] Resume error for run ${runId}:`, err);
    });
  } else if (action === 'loop_back') {
    // Loop back: go back to a previous node with feedback as context
    const targetNodeId = loop_back_node_id || checkpointConfig.loop_back_node_id;
    
    if (!targetNodeId) {
      return res.status(400).json({ error: 'No loop back node specified' });
    }
    
    // Verify target node exists and belongs to this workflow
    const targetNode = await queryOne<WorkflowNode>(
      `SELECT * FROM workflow_nodes WHERE id = $1 AND workflow_id = $2`,
      [targetNodeId, workflowId]
    );
    
    if (!targetNode) {
      return res.status(400).json({ error: 'Invalid loop back node' });
    }
    
    // Get current context and add feedback
    let context = JSON.parse(workflowRun.context || '{}');
    const loopCount = (context._loop_count || 0) + 1;
    
    // Check max loops to prevent infinite loops
    const maxLoops = checkpointConfig.max_loops || 5;
    if (loopCount > maxLoops) {
    await execute(
        `UPDATE workflow_runs SET status = 'failed', error = 'Maximum loop iterations exceeded', completed_at = NOW() WHERE id = $1`,
      [runId]
    );
      return res.status(400).json({ error: 'Maximum loop iterations exceeded' });
    }
    
    // Add feedback and loop info to context
    context = {
      ...context,
      _loop_count: loopCount,
      _human_feedback: feedback,
      _revision_requested: true,
      _revision_notes: feedback,
      _previous_checkpoint: checkpointNode?.name,
    };
    
    // Update workflow run to continue from the target node
    await execute(
      `UPDATE workflow_runs SET status = 'running', context = $1, current_node_id = NULL WHERE id = $2`,
      [JSON.stringify(context), runId]
    );
    
    res.json({ 
      success: true, 
      message: `Workflow looping back to "${targetNode.name}" with feedback`,
      loop_count: loopCount,
    });
    
    // Execute from the target node
    executeFromNode(runId, workflowId, targetNodeId, context, userId).catch(err => {
      console.error(`[Workflow] Loop back error for run ${runId}:`, err);
    });
  } else {
    // Rejected: fail the workflow
    await execute(
      `UPDATE workflow_runs SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
      [feedback ? `Rejected: ${feedback}` : 'Rejected at human checkpoint', runId]
    );
    
    res.json({ success: true, message: 'Workflow rejected' });
  }
});

// Cancel workflow run
router.post('/:workflowId/runs/:runId/cancel', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { workflowId, runId } = req.params;
  
  const workflowRun = await queryOne<WorkflowRun>(
    `SELECT * FROM workflow_runs WHERE id = $1 AND workflow_id = $2 AND user_id = $3`,
    [runId, workflowId, userId]
  );
  
  if (!workflowRun) {
    return res.status(404).json({ error: 'Run not found' });
  }
  
  if (workflowRun.status === 'completed' || workflowRun.status === 'failed') {
    return res.status(400).json({ error: 'Cannot cancel completed or failed run' });
  }
  
  await execute(
    `UPDATE workflow_runs SET status = 'cancelled', completed_at = NOW() WHERE id = $1`,
    [runId]
  );
  
  res.json({ success: true });
});

// Retry/resume a stuck workflow run
router.post('/:workflowId/runs/:runId/retry', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { workflowId, runId } = req.params;
  
  const workflowRun = await queryOne<WorkflowRun>(
    `SELECT * FROM workflow_runs WHERE id = $1 AND workflow_id = $2 AND user_id = $3`,
    [runId, workflowId, userId]
  );
  
  if (!workflowRun) {
    return res.status(404).json({ error: 'Run not found' });
  }
  
  if (workflowRun.status === 'completed') {
    return res.status(400).json({ error: 'Cannot retry completed run' });
  }
  
  if (workflowRun.status === 'cancelled') {
    return res.status(400).json({ error: 'Cannot retry cancelled run' });
  }
  
  // Find the stuck node run (status = 'running' but no progress)
  const stuckNodeRun = await queryOne<WorkflowNodeRun & { node_name: string; node_type: string }>(
    `SELECT wnr.*, wn.name as node_name, wn.node_type
     FROM workflow_node_runs wnr
     JOIN workflow_nodes wn ON wnr.node_id = wn.id
     WHERE wnr.workflow_run_id = $1 AND wnr.status = 'running'
     ORDER BY wnr.created_at DESC LIMIT 1`,
    [runId]
  );
  
  if (!stuckNodeRun) {
    // No stuck node - check if there's a pending node to resume
    const pendingNodeRun = await queryOne<WorkflowNodeRun>(
      `SELECT * FROM workflow_node_runs WHERE workflow_run_id = $1 AND status = 'pending' ORDER BY created_at ASC LIMIT 1`,
      [runId]
    );
    
    if (!pendingNodeRun && workflowRun.status === 'paused') {
      return res.status(400).json({ error: 'Workflow is paused at human checkpoint. Use /resume endpoint instead.' });
    }
    
    if (!pendingNodeRun) {
      return res.status(400).json({ error: 'No stuck or pending node found to retry' });
    }
  }
  
  console.log(`[Workflow] Retrying stuck workflow run ${runId}, stuck node: ${stuckNodeRun?.node_name || 'unknown'}`);
  
  // Mark any stuck tasks as failed
  if (stuckNodeRun?.task_id) {
    await execute(
      `UPDATE task_queue SET status = 'failed', error = 'Workflow retry - task was stuck', completed_at = ${NOW()} WHERE id = $1 AND status = 'processing'`,
      [stuckNodeRun.task_id]
    );
    await execute(
      `UPDATE tasks SET status = 'failed', error = 'Workflow retry - task was stuck', updated_at = ${NOW()} WHERE id = $1 AND status IN ('pending', 'running')`,
      [stuckNodeRun.task_id]
    );
  }
  
  // Mark the stuck node run as failed
  if (stuckNodeRun) {
    await execute(
      `UPDATE workflow_node_runs SET status = 'failed', error = 'Retried due to stuck state', completed_at = ${NOW()} WHERE id = $1`,
      [stuckNodeRun.id]
    );
  }
  
  // Get the context from the last successful state
  const context = JSON.parse(workflowRun.context || '{}');
  
  // Find the node to retry
  const nodeIdToRetry = stuckNodeRun?.node_id;
  
  if (!nodeIdToRetry) {
    return res.status(400).json({ error: 'Could not determine which node to retry' });
  }
  
  // Update workflow run to running status
  await execute(
    `UPDATE workflow_runs SET status = 'running', current_node_id = NULL WHERE id = $1`,
    [runId]
  );
  
  res.json({ 
    success: true, 
    message: `Retrying workflow from node: ${stuckNodeRun?.node_name}`,
    retrying_node: stuckNodeRun?.node_name,
    retrying_node_id: nodeIdToRetry,
  });
  
  // Execute from the stuck node in background
  executeFromNode(runId, workflowId, nodeIdToRetry, context, userId).catch(err => {
    console.error(`[Workflow] Retry failed for run ${runId}:`, err);
  });
});

// ============================================
// WORKFLOW EXECUTION ENGINE
// ============================================

async function executeWorkflow(runId: string, workflowId: string, userId: string) {
  console.log(`[Workflow] Starting execution for run ${runId}`);
  
  // Broadcast workflow started
  sendWorkflowRunStatus(runId, 'running');
  
  const nodes = await query<WorkflowNode>(
    `SELECT * FROM workflow_nodes WHERE workflow_id = $1`,
    [workflowId]
  );
  
  const edges = await query<WorkflowEdge>(
    `SELECT * FROM workflow_edges WHERE workflow_id = $1`,
    [workflowId]
  );
  
  // Find start node
  const startNode = nodes.find(n => n.node_type === 'start');
  if (!startNode) {
    throw new Error('No start node found');
  }
  
  // Get initial context
  const workflowRun = await queryOne<WorkflowRun>(`SELECT * FROM workflow_runs WHERE id = $1`, [runId]);
  let context = JSON.parse(workflowRun?.input_data || '{}');
  
  // Execute from start node
  await executeNode(runId, startNode, nodes, edges, context, userId);
}

async function executeNode(
  runId: string,
  node: WorkflowNode,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  context: Record<string, any>,
  userId: string
): Promise<void> {
  // Check if run was cancelled or already completed
  const workflowRun = await queryOne<WorkflowRun>(`SELECT * FROM workflow_runs WHERE id = $1`, [runId]);
  if (workflowRun?.status === 'cancelled') {
    console.log(`[Workflow] Run ${runId} was cancelled, stopping execution`);
    return;
  }
  if (workflowRun?.status === 'completed') {
    console.log(`[Workflow] Run ${runId} already completed, stopping execution of node ${node.name}`);
    return;
  }
  if (workflowRun?.status === 'failed') {
    console.log(`[Workflow] Run ${runId} already failed, stopping execution of node ${node.name}`);
    return;
  }
  
  console.log(`[Workflow] Executing node ${node.name} (${node.node_type})`);
  
  // Create node run record
  const nodeRunId = uuidv4();
  await execute(
    `INSERT INTO workflow_node_runs (id, workflow_run_id, node_id, input_data, status, started_at)
     VALUES ($1, $2, $3, $4, 'running', NOW())`,
    [nodeRunId, runId, node.id, JSON.stringify(context)]
  );
  
  // Broadcast real-time update
  sendWorkflowNodeStatus(runId, node.id, node.name, node.node_type, 'running');
  
  let output: any = null;
  let nextCondition: string | null = null;
  
  try {
    const config = JSON.parse(node.config || '{}');
    
    switch (node.node_type) {
      case 'start':
        output = context;
        nextCondition = 'default';
        break;
        
      case 'end':
        // Check if workflow is already completed (prevents duplicate completions from parallel paths)
        const currentStatus = await queryOne<{ status: string }>(
          `SELECT status FROM workflow_runs WHERE id = $1`,
          [runId]
        );
        
        if (currentStatus?.status === 'completed') {
          console.log(`[Workflow] Run ${runId} already completed, skipping duplicate end node execution`);
          // Mark this node run as skipped
        await execute(
            `UPDATE workflow_node_runs SET status = 'skipped', output_data = $1, completed_at = NOW() WHERE id = $2`,
            [JSON.stringify({ skipped: true, reason: 'workflow_already_completed' }), nodeRunId]
          );
          return;
        }
        
        // Update workflow run as completed (use WHERE clause to prevent race condition)
        const updateResult = await execute(
          `UPDATE workflow_runs SET 
            status = 'completed', 
            output_data = $1, 
            context = $2,
            completed_at = NOW()
           WHERE id = $3 AND status != 'completed'`,
          [JSON.stringify(context), JSON.stringify(context), runId]
        );
        
        // Update node run
        await execute(
          `UPDATE workflow_node_runs SET status = 'completed', output_data = $1, completed_at = NOW() WHERE id = $2`,
          [JSON.stringify(context), nodeRunId]
        );
        
        // Broadcast completion
        sendWorkflowNodeStatus(runId, node.id, node.name, node.node_type, 'completed');
        sendWorkflowRunStatus(runId, 'completed');
        
        console.log(`[Workflow] Run ${runId} completed`);
        return;
        
      case 'agent':
        output = await executeAgentNode(runId, nodeRunId, node, config, context, userId);
        // Add agent result to context with node name as key, and also as previous_result for easy chaining
        const nodeKey = node.name.toLowerCase().replace(/\s+/g, '_');
        context = { 
          ...context, 
          [nodeKey]: output.result || output,
          previous_result: output.result || output,
          last_agent_output: output.result || output,
        };
        nextCondition = 'success';
        break;
        
      case 'condition':
        const conditionResult = evaluateCondition(config.expression, context);
        output = { result: conditionResult };
        nextCondition = conditionResult ? 'true' : 'false';
        break;
        
      case 'human_checkpoint':
        // Pause workflow and wait for human input
        await execute(
          `UPDATE workflow_runs SET status = 'paused', current_node_id = $1 WHERE id = $2`,
          [node.id, runId]
        );
        await execute(
          `UPDATE workflow_node_runs SET status = 'waiting_human' WHERE id = $1`,
          [nodeRunId]
        );
        
        broadcast(runId, {
          type: 'workflow_paused',
          runId,
          nodeId: node.id,
          nodeName: node.name,
          message: config.message || 'Awaiting human approval',
          context,
          timestamp: Date.now(),
        });
        
        console.log(`[Workflow] Run ${runId} paused at human checkpoint`);
        
        // Get workflow details for notification
        const workflowForNotification = await queryOne<Workflow>(
          `SELECT w.*, wr.user_id FROM workflows w JOIN workflow_runs wr ON w.id = wr.workflow_id WHERE wr.id = $1`,
          [runId]
        );
        
        if (workflowForNotification) {
          // Send notifications via integrations (Slack, Discord, Teams, etc.)
          sendHumanCheckpointNotifications(
            userId,
            workflowForNotification,
            runId,
            node.name,
            config.message || 'Awaiting human approval'
          ).catch(err => {
            console.error(`[Workflow] Failed to send human checkpoint notifications:`, err);
          });
        }
        
        return; // Stop execution here, will be resumed
        
      case 'parallel_split':
        // Get all outgoing edges and execute them in parallel
        const parallelEdges = edges.filter(e => e.source_node_id === node.id);
        const parallelNodes = parallelEdges.map(e => nodes.find(n => n.id === e.target_node_id)!).filter(Boolean);
        
        if (parallelNodes.length > 0) {
          console.log(`[Workflow] Parallel split ${node.name} starting ${parallelNodes.length} branches`);
          
          // Execute all branches in parallel, collecting results
          const branchResults = await Promise.allSettled(
            parallelNodes.map(n => executeNode(runId, n, nodes, edges, context, userId))
          );
          
          // Check if any branches failed
          const failedBranches = branchResults.filter(r => r.status === 'rejected');
          const succeededBranches = branchResults.filter(r => r.status === 'fulfilled');
          
          if (failedBranches.length > 0) {
            console.warn(`[Workflow] Parallel split ${node.name}: ${failedBranches.length}/${parallelNodes.length} branches failed`);
            // Update node run with partial failure info
          await execute(
            `UPDATE workflow_node_runs SET status = 'completed', output_data = $1, completed_at = NOW() WHERE id = $2`,
              [JSON.stringify({ 
                branches: parallelNodes.length, 
                succeeded: succeededBranches.length,
                failed: failedBranches.length,
                partial_failure: true
              }), nodeRunId]
          );
          } else {
            // All succeeded
            await execute(
              `UPDATE workflow_node_runs SET status = 'completed', output_data = $1, completed_at = NOW() WHERE id = $2`,
              [JSON.stringify({ branches: parallelNodes.length, succeeded: parallelNodes.length }), nodeRunId]
            );
          }
          
          console.log(`[Workflow] Parallel split ${node.name} completed: ${succeededBranches.length}/${parallelNodes.length} branches succeeded`);
        }
        return;
        
      case 'parallel_merge':
        // Get all incoming edges to this merge node
        const incomingMergeEdges = edges.filter(e => e.target_node_id === node.id);
        const expectedBranches = incomingMergeEdges.length;
        const sourceNodeIds = incomingMergeEdges.map(e => e.source_node_id);
        
        console.log(`[Workflow] Merge node ${node.name}: expecting ${expectedBranches} branches from nodes: ${sourceNodeIds.join(', ')}`);
        
        // Check how many of the SOURCE nodes have completed runs for this workflow run
        const completedBranchRuns = await query<WorkflowNodeRun>(
          `SELECT * FROM workflow_node_runs 
           WHERE workflow_run_id = $1 
           AND node_id = ANY($2::text[])
           AND status = 'completed'`,
          [runId, sourceNodeIds]
        );
        
        console.log(`[Workflow] Merge node: ${completedBranchRuns.length}/${expectedBranches} branches completed`);
        
        // If not all branches have completed, this is a premature arrival - wait for others
        if (completedBranchRuns.length < expectedBranches) {
          // Mark this node run as waiting (we'll delete these waiting runs when the real merge happens)
          await execute(
            `UPDATE workflow_node_runs SET status = 'skipped', output_data = $1, completed_at = NOW() WHERE id = $2`,
            [JSON.stringify({ waiting: true, arrivedBranches: completedBranchRuns.length, expectedBranches }), nodeRunId]
          );
          console.log(`[Workflow] Merge node ${node.name} waiting for more branches (${completedBranchRuns.length}/${expectedBranches}), stopping this path`);
          return; // Don't continue downstream, wait for other branches
        }
        
        // All branches completed! This is the last one to arrive.
        console.log(`[Workflow] All ${expectedBranches} branches arrived at merge node ${node.name}, collecting results...`);
        
        // Start with base context (topic and any initial inputs)
        let mergedContext: Record<string, any> = {};
        
        // Preserve the original topic/inputs from context
        if (context.topic) mergedContext.topic = context.topic;
        
        // Collect and merge all branch outputs into the context
        for (const branchRun of completedBranchRuns) {
          // Find the node for this branch run to get its name
          const branchNode = nodes.find(n => n.id === branchRun.node_id);
          const nodeKey = branchNode 
            ? branchNode.name.toLowerCase().replace(/\s+/g, '_')
            : branchRun.node_id;
          
          try {
            const branchOutput = JSON.parse(branchRun.output_data || '{}');
            console.log(`[Workflow] Merging output from branch "${branchNode?.name || branchRun.node_id}":`, Object.keys(branchOutput));
            
            // Agent nodes store the result in output.result
            if (branchOutput.result) {
              mergedContext[nodeKey] = branchOutput.result;
            } else if (branchOutput.task_id && branchOutput.prompt) {
              // This is an agent output structure - we need to get the actual result
              // The result might be in a different field or we need to look it up
              // For now, check if there's any other meaningful data
              const meaningfulKeys = Object.keys(branchOutput).filter(
                k => !['task_id', 'prompt', 'agent_id'].includes(k)
              );
              if (meaningfulKeys.length > 0) {
                mergedContext[nodeKey] = branchOutput;
              }
            } else {
              // Just use the whole output
              mergedContext[nodeKey] = branchOutput;
            }
          } catch (e) {
            console.warn(`[Workflow] Failed to parse branch output:`, e);
          }
        }
        
        // Also try to get context from the workflow_runs table which may have accumulated data
        const currentRunContext = await queryOne<WorkflowRun>(
          `SELECT context FROM workflow_runs WHERE id = $1`,
          [runId]
        );
        
        if (currentRunContext?.context) {
          try {
            const runContext = JSON.parse(currentRunContext.context);
            // Merge run context, but don't overwrite what we just collected
            for (const [key, value] of Object.entries(runContext)) {
              if (!(key in mergedContext) && key !== 'previous_result' && key !== 'last_agent_output') {
                mergedContext[key] = value;
              }
            }
          } catch (e) {
            // Ignore
          }
        }
        
        // Remove transient keys that don't make sense after merge
        delete mergedContext.previous_result;
        delete mergedContext.last_agent_output;
        
        console.log(`[Workflow] Merged context keys:`, Object.keys(mergedContext));
        
        output = { merged: true, branch_count: expectedBranches, keys: Object.keys(mergedContext) };
        context = mergedContext;
        nextCondition = 'default';
        break;
        
      case 'transform':
        // Execute transform code (simple JavaScript expression)
        output = executeTransform(config.expression, context);
        context = { ...context, ...output };
        nextCondition = 'default';
        break;
        
      case 'delay':
        const delaySeconds = config.seconds || 1;
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        output = { delayed: delaySeconds };
        nextCondition = 'default';
        break;
    }
    
    // Update node run as completed
    await execute(
      `UPDATE workflow_node_runs SET status = 'completed', output_data = $1, completed_at = NOW() WHERE id = $2`,
      [JSON.stringify(output), nodeRunId]
    );
    
    // Broadcast node completion
    const outputPreview = output ? JSON.stringify(output).slice(0, 200) : undefined;
    sendWorkflowNodeStatus(runId, node.id, node.name, node.node_type, 'completed', outputPreview);
    
    // Update workflow context
    await execute(
      `UPDATE workflow_runs SET context = $1 WHERE id = $2`,
      [JSON.stringify(context), runId]
    );
    
    broadcast(runId, {
      type: 'workflow_node_completed',
      runId,
      nodeId: node.id,
      nodeName: node.name,
      output,
      timestamp: Date.now(),
    });
    
  } catch (error: any) {
    console.error(`[Workflow] Node ${node.name} failed:`, error);
    
    // Update node run as failed
    await execute(
      `UPDATE workflow_node_runs SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
      [error.message, nodeRunId]
    );
    
    broadcast(runId, {
      type: 'workflow_node_failed',
      runId,
      nodeId: node.id,
      nodeName: node.name,
      error: error.message,
      timestamp: Date.now(),
    });
    
    // Check for error edge or fail workflow
    const errorEdge = edges.find(e => e.source_node_id === node.id && e.condition_label === 'error');
    if (errorEdge) {
      nextCondition = 'error';
    } else {
      // Fail the workflow
      await execute(
        `UPDATE workflow_runs SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
        [error.message, runId]
      );
      
      // Broadcast failure
      sendWorkflowNodeStatus(runId, node.id, node.name, node.node_type, 'failed', undefined, error.message);
      sendWorkflowRunStatus(runId, 'failed');
      return;
    }
  }
  
  // Find next node(s) to execute
  const outgoingEdges = edges.filter(e => e.source_node_id === node.id);
  
  if (outgoingEdges.length === 0) {
    console.log(`[Workflow] No outgoing edges from ${node.name}, workflow may be incomplete`);
    return;
  }
  
  // Find the appropriate edge based on condition
  let nextEdge = outgoingEdges.find(e => e.condition_label === nextCondition);
  if (!nextEdge) {
    nextEdge = outgoingEdges.find(e => !e.condition_label || e.condition_label === 'default');
  }
  if (!nextEdge) {
    nextEdge = outgoingEdges[0]; // Fallback to first edge
  }
  
  const nextNode = nodes.find(n => n.id === nextEdge!.target_node_id);
  if (nextNode) {
    await executeNode(runId, nextNode, nodes, edges, context, userId);
  }
}

// Helper to wait for a task to complete with polling
async function waitForTaskCompletion(
  taskId: string, 
  runId: string,
  nodeName: string,
  timeoutMs: number = 30 * 60 * 1000, // 30 minute default timeout
  pollIntervalMs: number = 2000 // Poll every 2 seconds
): Promise<{ status: string; result: string | null; error: string | null }> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    // Check if workflow run was cancelled/failed/completed while we were waiting
    const workflowRun = await queryOne<{ status: string }>(
      'SELECT status FROM workflow_runs WHERE id = $1',
      [runId]
    );
    
    if (workflowRun?.status === 'cancelled') {
      console.log(`[Workflow] Run ${runId} was cancelled while waiting for task ${taskId}`);
      return { status: 'failed', result: null, error: 'Workflow was cancelled' };
    }
    if (workflowRun?.status === 'failed') {
      console.log(`[Workflow] Run ${runId} failed while waiting for task ${taskId}`);
      return { status: 'failed', result: null, error: 'Workflow failed' };
    }
    if (workflowRun?.status === 'completed') {
      console.log(`[Workflow] Run ${runId} already completed while waiting for task ${taskId}`);
      return { status: 'failed', result: null, error: 'Workflow already completed' };
    }
    
    // Check task_queue status first (this is what the worker updates)
    const queueTask = await queryOne<{ status: string; result?: string; error?: string }>(
      'SELECT status, result, error FROM task_queue WHERE id = $1',
      [taskId]
    );
    
    // Also check tasks table
    const task = await queryOne<{ status: string; result: string | null; error: string | null }>(
      'SELECT status, result, error FROM tasks WHERE id = $1',
      [taskId]
    );
    
    // Use queue task status if available, fall back to tasks table
    const status = queueTask?.status || task?.status || 'pending';
    const result = queueTask?.result || task?.result || null;
    const error = queueTask?.error || task?.error || null;
    
    console.log(`[Workflow] Task ${taskId} (${nodeName}) status: ${status}`);
    
    if (status === 'completed') {
      return { status: 'completed', result, error: null };
    }
    
    if (status === 'failed') {
      return { status: 'failed', result: null, error: error || 'Task failed' };
    }
    
    // Broadcast progress update - show as "waiting" status with elapsed time
    sendWorkflowNodeStatus(
      runId, 
      taskId, // Use taskId as nodeId since we don't have node here
      nodeName, 
      'agent', 
      'waiting',
      `Processing... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`
    );
    
    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  
  // Timeout reached
  return { status: 'failed', result: null, error: `Task timed out after ${timeoutMs / 1000}s` };
}

async function executeAgentNode(
  runId: string,
  nodeRunId: string,
  node: WorkflowNode,
  config: any,
  context: Record<string, any>,
  userId: string
): Promise<any> {
  // Config should have: agent_id, prompt_template
  let { agent_id, prompt_template } = config;
  
  if (!agent_id) {
    throw new Error('Agent node requires agent_id in config');
  }
  
  // Check if the agent exists in sessions table
  const existingAgent = await queryOne<{ id: string }>(
    'SELECT id FROM sessions WHERE id = $1',
    [agent_id]
  );
  
  // If agent doesn't exist, create it on-the-fly
  if (!existingAgent) {
    console.log(`[Workflow] Agent ${agent_id} not found, creating on-the-fly for node ${node.name}`);
    
    const agentName = node.name.replace(/\s+Agent$/i, '').trim() || node.name;
    const agentConfigId = uuidv4();
    
    // Create the session/agent
    await execute(
      `INSERT INTO sessions (id, user_id, agent_type, repo_name, branch, agent_provider, status)
       VALUES ($1, $2, 'task', $3, 'main', 'claude-code', 'pending')`,
      [agent_id, userId, agentName]
    );
    
    // Create agent config with a system prompt based on the node name
    const systemPrompt = config.system_prompt || `You are ${agentName}. Your role is to ${agentName.toLowerCase()}.`;
    await execute(
      `INSERT INTO agent_configs (id, session_id, name, system_prompt, api_enabled)
       VALUES ($1, $2, $3, $4, true)`,
      [agentConfigId, agent_id, agentName, systemPrompt]
    );
    
    console.log(`[Workflow] Created agent ${agent_id} (${agentName}) for workflow execution`);
  }
  
  // Replace template variables with context values
  let prompt = prompt_template || '{{input}}';
  for (const [key, value] of Object.entries(context)) {
    const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
    prompt = prompt.replace(new RegExp(`{{${key}}}`, 'g'), valueStr);
  }
  
  // Automatically append context data that wasn't explicitly referenced in the template
  // This ensures downstream agents can access data from previous workflow nodes
  const contextKeys = Object.keys(context).filter(key => 
    // Skip internal/transient keys
    !key.startsWith('_') && 
    key !== 'topic' && // topic is usually already in the prompt
    key !== 'previous_result' && 
    key !== 'last_agent_output'
  );
  
  if (contextKeys.length > 0) {
    // Check if any context keys are NOT already referenced in the template
    const unreferencedKeys = contextKeys.filter(key => 
      !prompt_template?.includes(`{{${key}}}`)
    );
    
    if (unreferencedKeys.length > 0) {
      let contextSection = '\n\n---\n📋 AVAILABLE DATA FROM PREVIOUS WORKFLOW STEPS:\n\n';
      
      for (const key of unreferencedKeys) {
        const value = context[key];
        const valueStr = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
        
        // Format the key nicely (e.g., "twitter_search" -> "Twitter Search")
        const formattedKey = key
          .replace(/_/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());
        
        // Truncate very long values to avoid overwhelming the prompt
        const maxLength = 15000; // ~15KB per context item
        const displayValue = valueStr.length > maxLength 
          ? valueStr.slice(0, maxLength) + '\n... [truncated]'
          : valueStr;
        
        contextSection += `### ${formattedKey}:\n${displayValue}\n\n`;
      }
      
      contextSection += '---\n\nPlease use the above data to complete your task.\n';
      prompt = prompt + contextSection;
      
      console.log(`[Workflow] Appended ${unreferencedKeys.length} context items to prompt: ${unreferencedKeys.join(', ')}`);
    }
  }
  
  // If this is a revision request, prepend the feedback prominently
  if (context._revision_requested && context._human_feedback) {
    const revisionCount = context._loop_count || 1;
    const previousCheckpoint = context._previous_checkpoint || 'human review';
    prompt = `⚠️ REVISION REQUESTED (Attempt #${revisionCount + 1})

The previous output was reviewed at "${previousCheckpoint}" and changes were requested.

📝 FEEDBACK FROM REVIEWER:
${context._human_feedback}

Please address this feedback in your response.

---

Original Task:
${prompt}`;
  }
  
  // Create a task in the tasks table (linked to sessions/agents)
  const taskId = uuidv4();
  await execute(
    `INSERT INTO tasks (id, session_id, prompt, status, model_provider)
     VALUES ($1, $2, $3, 'pending', 'claude-code')`,
    [taskId, agent_id, prompt]
  );
  
  // Also add to task_queue for the worker to process
  await execute(
    `INSERT INTO task_queue (id, agent_id, user_id, prompt, status, source)
     VALUES ($1, $2, $3, $4, 'pending', 'workflow')`,
    [taskId, agent_id, userId, prompt]
  );
  
  // Link task to node run (task_id references tasks table)
  await execute(
    `UPDATE workflow_node_runs SET task_id = $1 WHERE id = $2`,
    [taskId, nodeRunId]
  );
  
  console.log(`[Workflow] Created task ${taskId} for agent ${agent_id} (node: ${node.name}), waiting for completion...`);
  
  // Broadcast that we're waiting
  broadcast(runId, {
    type: 'workflow_task_started',
    runId,
    taskId,
    nodeId: node.id,
    nodeName: node.name,
    timestamp: Date.now(),
  });
  
  // WAIT for the task to complete
  const taskResult = await waitForTaskCompletion(taskId, runId, node.name);
  
  if (taskResult.status === 'failed') {
    throw new Error(taskResult.error || 'Agent task failed');
  }
  
  console.log(`[Workflow] Task ${taskId} completed for node ${node.name}`);
  
  // Parse the result if it's JSON
  let parsedResult = taskResult.result;
  if (taskResult.result) {
    try {
      parsedResult = JSON.parse(taskResult.result);
    } catch {
      // Keep as string if not valid JSON
    }
  }
  
  return {
    task_id: taskId,
    prompt,
    status: 'completed',
    result: parsedResult,
  };
}

// SECURITY NOTE: Both evaluateCondition and executeTransform use new Function() which is
// essentially eval(). This allows arbitrary JavaScript execution. Currently this is acceptable
// because only authenticated users can create/edit workflows. For production hardening:
// TODO: Consider using a sandboxed evaluator like vm2, isolated-vm, or a simple expression
// parser that only allows safe operations (comparison, math, property access).

function evaluateCondition(expression: string, context: Record<string, any>): boolean {
  try {
    // Simple condition evaluation using Function constructor
    // WARNING: This allows arbitrary code execution - see security note above
    const func = new Function(...Object.keys(context), `return ${expression}`);
    return Boolean(func(...Object.values(context)));
  } catch (error) {
    console.error(`[Workflow] Condition evaluation failed:`, error);
    return false;
  }
}

function executeTransform(expression: string, context: Record<string, any>): any {
  try {
    // WARNING: This allows arbitrary code execution - see security note above
    const func = new Function(...Object.keys(context), `return ${expression}`);
    return func(...Object.values(context));
  } catch (error) {
    console.error(`[Workflow] Transform execution failed:`, error);
    return {};
  }
}

// Execute workflow from a specific node (for loop-back scenarios)
async function executeFromNode(
  runId: string,
  workflowId: string,
  nodeId: string,
  context: Record<string, any>,
  userId: string
) {
  console.log(`[Workflow] Resuming execution from node ${nodeId} for run ${runId}`);
  
  const nodes = await query<WorkflowNode>(
    `SELECT * FROM workflow_nodes WHERE workflow_id = $1`,
    [workflowId]
  );
  
  const edges = await query<WorkflowEdge>(
    `SELECT * FROM workflow_edges WHERE workflow_id = $1`,
    [workflowId]
  );
  
  const targetNode = nodes.find(n => n.id === nodeId);
  if (!targetNode) {
    throw new Error(`Node ${nodeId} not found in workflow`);
  }
  
  // Broadcast that we're looping back
  broadcast(runId, {
    type: 'workflow_loop_back',
    runId,
    nodeId: targetNode.id,
    nodeName: targetNode.name,
    loopCount: context._loop_count || 1,
    feedback: context._human_feedback,
    timestamp: Date.now(),
  });
  
  // Execute from the target node
  await executeNode(runId, targetNode, nodes, edges, context, userId);
}

async function continueWorkflow(
  runId: string,
  fromNodeId: string,
  humanResponse: any
) {
  const workflowRun = await queryOne<WorkflowRun>(`SELECT * FROM workflow_runs WHERE id = $1`, [runId]);
  if (!workflowRun) return;
  
  const nodes = await query<WorkflowNode>(
    `SELECT * FROM workflow_nodes WHERE workflow_id = $1`,
    [workflowRun.workflow_id]
  );
  
  const edges = await query<WorkflowEdge>(
    `SELECT * FROM workflow_edges WHERE workflow_id = $1`,
    [workflowRun.workflow_id]
  );
  
  const context = JSON.parse(workflowRun.context || '{}');
  context._human_response = humanResponse;
  
  // Find next node after human checkpoint
  const outgoingEdge = edges.find(e => e.source_node_id === fromNodeId);
  if (outgoingEdge) {
    const nextNode = nodes.find(n => n.id === outgoingEdge.target_node_id);
    if (nextNode) {
      await executeNode(runId, nextNode, nodes, edges, context, workflowRun.user_id);
    }
  }
}

// ============================================
// STARTUP RECOVERY - Resume stuck workflows
// ============================================

/**
 * Recover stuck workflow runs on server startup.
 * Finds workflows that were running when the server stopped and resumes them.
 */
export async function recoverStuckWorkflows(): Promise<void> {
  console.log('[Workflow] Checking for stuck workflow runs to recover...');
  
  try {
    // Find workflow runs that are 'running' but have stuck node runs
    // A node run is considered stuck if it's been 'running' for more than 10 minutes
    const stuckRuns = await query<{
      run_id: string;
      workflow_id: string;
      user_id: string;
      node_run_id: string;
      node_id: string;
      node_name: string;
      task_id: string | null;
      context: string;
    }>(
      `SELECT 
        wr.id as run_id,
        wr.workflow_id,
        wr.user_id,
        wnr.id as node_run_id,
        wnr.node_id,
        wn.name as node_name,
        wnr.task_id,
        wr.context
       FROM workflow_runs wr
       JOIN workflow_node_runs wnr ON wnr.workflow_run_id = wr.id
       JOIN workflow_nodes wn ON wnr.node_id = wn.id
       WHERE wr.status = 'running' 
         AND wnr.status IN ('running', 'failed')
         AND wnr.started_at < ${TIME_AGO_10_MIN()}
       ORDER BY wnr.started_at ASC`,
      []
    );
    
    if (stuckRuns.length === 0) {
      console.log('[Workflow] No stuck workflow runs found');
      return;
    }
    
    console.log(`[Workflow] Found ${stuckRuns.length} stuck workflow run(s) to recover`);
    
    for (const run of stuckRuns) {
      console.log(`[Workflow] Recovering run ${run.run_id}, stuck at node: ${run.node_name}`);
      
      try {
        // Mark any stuck tasks as failed
        if (run.task_id) {
          await execute(
            `UPDATE task_queue SET status = 'failed', error = 'Server restart recovery', completed_at = ${NOW()} WHERE id = $1 AND status = 'processing'`,
            [run.task_id]
          );
          await execute(
            `UPDATE tasks SET status = 'failed', error = 'Server restart recovery', updated_at = ${NOW()} WHERE id = $1 AND status IN ('pending', 'running')`,
            [run.task_id]
          );
        }
        
        // Mark the stuck node run as failed
        await execute(
          `UPDATE workflow_node_runs SET status = 'failed', error = 'Server restart recovery', completed_at = ${NOW()} WHERE id = $1 AND status IN ('running', 'failed')`,
          [run.node_run_id]
        );
        
        // Parse context
        const context = JSON.parse(run.context || '{}');
        
        // Resume execution from the stuck node
        console.log(`[Workflow] Resuming run ${run.run_id} from node ${run.node_name}`);
        
        executeFromNode(run.run_id, run.workflow_id, run.node_id, context, run.user_id).catch(err => {
          console.error(`[Workflow] Recovery failed for run ${run.run_id}:`, err);
        });
        
      } catch (err) {
        console.error(`[Workflow] Failed to recover run ${run.run_id}:`, err);
      }
    }
    
  } catch (err) {
    console.error('[Workflow] Error checking for stuck workflows:', err);
  }
}

export default router;
