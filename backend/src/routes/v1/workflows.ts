import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireApiKey } from '../../middleware/apiKeyAuth.js';
import { queryOne, query, execute } from '../../db/index.js';
import { broadcast } from '../../services/websocket.js';

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

// List all workflows for user
router.get('/', requireApiKey, async (req: Request, res: Response) => {
  const userId = req.apiUserId;
  
  const workflows = await query<Workflow>(
    `SELECT * FROM workflows WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  
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
    
    return {
      id: w.id,
      name: w.name,
      description: w.description,
      is_active: w.is_active === 1,
      node_count: nodeCount,
      run_count: runCount,
      created_at: w.created_at,
      updated_at: w.updated_at,
    };
  }));
  
  res.json({ workflows: workflowsWithCounts });
});

// Get single workflow with all nodes and edges
router.get('/:id', requireApiKey, async (req: Request, res: Response) => {
  const userId = req.apiUserId;
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
  
  res.json({
    workflow: {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      is_active: workflow.is_active === 1,
      max_retries: workflow.max_retries,
      timeout_seconds: workflow.timeout_seconds,
      created_at: workflow.created_at,
      updated_at: workflow.updated_at,
    },
    nodes: nodes.map(n => ({
      id: n.id,
      node_type: n.node_type,
      name: n.name,
      description: n.description,
      config: JSON.parse(n.config || '{}'),
    })),
    edges: edges.map(e => ({
      id: e.id,
      source_node_id: e.source_node_id,
      target_node_id: e.target_node_id,
      condition_label: e.condition_label,
    })),
  });
});

// Create workflow
router.post('/', requireApiKey, async (req: Request, res: Response) => {
  const userId = req.apiUserId;
  const { name, description, nodes, edges } = req.body;
  
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
  
  // Create start and end nodes (unless custom nodes provided)
  if (!nodes || nodes.length === 0) {
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
  } else {
    // Create custom nodes
    const nodeIdMap: Record<string, string> = {};
    
    for (const node of nodes) {
      const nodeId = uuidv4();
      nodeIdMap[node.temp_id || node.name] = nodeId;
      
      await execute(
        `INSERT INTO workflow_nodes (id, workflow_id, node_type, name, description, position_x, position_y, config)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          nodeId,
          workflowId,
          node.node_type,
          node.name,
          node.description || null,
          node.position_x || 0,
          node.position_y || 0,
          JSON.stringify(node.config || {}),
        ]
      );
    }
    
    // Create edges if provided
    if (edges && edges.length > 0) {
      for (const edge of edges) {
        const edgeId = uuidv4();
        const sourceId = nodeIdMap[edge.source] || edge.source_node_id;
        const targetId = nodeIdMap[edge.target] || edge.target_node_id;
        
        if (sourceId && targetId) {
          await execute(
            `INSERT INTO workflow_edges (id, workflow_id, source_node_id, target_node_id, condition_label, edge_order)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [edgeId, workflowId, sourceId, targetId, edge.condition_label || null, edge.edge_order || 0]
          );
        }
      }
    }
  }
  
  console.log(`[API] Created workflow ${workflowId}: ${name}`);
  
  const workflow = await queryOne<Workflow>(`SELECT * FROM workflows WHERE id = $1`, [workflowId]);
  const createdNodes = await query<WorkflowNode>(`SELECT * FROM workflow_nodes WHERE workflow_id = $1`, [workflowId]);
  const createdEdges = await query<WorkflowEdge>(`SELECT * FROM workflow_edges WHERE workflow_id = $1`, [workflowId]);
  
  res.status(201).json({
    workflow: {
      id: workflow?.id,
      name: workflow?.name,
      description: workflow?.description,
      is_active: workflow?.is_active === 1,
    },
    nodes: createdNodes.map(n => ({
      id: n.id,
      node_type: n.node_type,
      name: n.name,
    })),
    edges: createdEdges.map(e => ({
      id: e.id,
      source_node_id: e.source_node_id,
      target_node_id: e.target_node_id,
    })),
  });
});

// ============================================
// WORKFLOW TRIGGER (Main API endpoint)
// ============================================

// Trigger a workflow run
router.post('/:id/trigger', requireApiKey, async (req: Request, res: Response) => {
  const userId = req.apiUserId;
  const { id } = req.params;
  const { input_data } = req.body;
  
  const workflow = await queryOne<Workflow>(
    `SELECT * FROM workflows WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  
  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }
  
  if (!workflow.is_active) {
    return res.status(400).json({ error: 'Workflow is not active' });
  }
  
  // Create workflow run
  const runId = uuidv4();
  
  await execute(
    `INSERT INTO workflow_runs (id, workflow_id, user_id, input_data, status, started_at)
     VALUES ($1, $2, $3, $4, 'running', NOW())`,
    [runId, id, userId, JSON.stringify(input_data || {})]
  );
  
  const workflowRun = await queryOne<WorkflowRun>(`SELECT * FROM workflow_runs WHERE id = $1`, [runId]);
  
  console.log(`[API] Triggered workflow ${id}, run ${runId}`);
  
  // Return immediately, execute in background
  res.status(202).json({
    run: {
      id: workflowRun?.id,
      workflow_id: workflowRun?.workflow_id,
      status: workflowRun?.status,
      input_data: workflowRun?.input_data,
      created_at: workflowRun?.created_at,
    },
    message: 'Workflow triggered successfully. Poll the status endpoint for updates.',
    status_url: `/api/v1/workflows/${id}/runs/${runId}`,
  });
  
  // Execute workflow in background
  executeWorkflow(runId, id, userId!).catch(async err => {
    console.error(`[Workflow] Execution error for run ${runId}:`, err);
    await execute(
      `UPDATE workflow_runs SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
      [err.message, runId]
    );
  });
});

// Get workflow run status
router.get('/:id/runs/:runId', requireApiKey, async (req: Request, res: Response) => {
  const userId = req.apiUserId;
  const { id, runId } = req.params;
  
  const workflowRun = await queryOne<WorkflowRun>(
    `SELECT * FROM workflow_runs WHERE id = $1 AND workflow_id = $2 AND user_id = $3`,
    [runId, id, userId]
  );
  
  if (!workflowRun) {
    return res.status(404).json({ error: 'Run not found' });
  }
  
  const nodeRuns = await query<WorkflowNodeRun>(
    `SELECT * FROM workflow_node_runs WHERE workflow_run_id = $1 ORDER BY created_at`,
    [runId]
  );
  
  res.json({
    run: {
      id: workflowRun.id,
      workflow_id: workflowRun.workflow_id,
      status: workflowRun.status,
      input_data: JSON.parse(workflowRun.input_data || '{}'),
      output_data: workflowRun.output_data ? JSON.parse(workflowRun.output_data) : null,
      context: JSON.parse(workflowRun.context || '{}'),
      error: workflowRun.error,
      started_at: workflowRun.started_at,
      completed_at: workflowRun.completed_at,
      created_at: workflowRun.created_at,
    },
    node_runs: nodeRuns.map(nr => ({
      id: nr.id,
      node_id: nr.node_id,
      status: nr.status,
      output_data: nr.output_data ? JSON.parse(nr.output_data) : null,
      error: nr.error,
      started_at: nr.started_at,
      completed_at: nr.completed_at,
    })),
  });
});

// List all runs for a workflow
router.get('/:id/runs', requireApiKey, async (req: Request, res: Response) => {
  const userId = req.apiUserId;
  const { id } = req.params;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Number(req.query.offset) || 0;
  
  const workflow = await queryOne<Workflow>(
    `SELECT * FROM workflows WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  
  if (!workflow) {
    return res.status(404).json({ error: 'Workflow not found' });
  }
  
  const runs = await query<WorkflowRun>(
    `SELECT * FROM workflow_runs WHERE workflow_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
    [id, userId, limit, offset]
  );
  
  const total = (await queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM workflow_runs WHERE workflow_id = $1 AND user_id = $2`,
    [id, userId]
  ))?.count || 0;
  
  res.json({
    runs: runs.map(r => ({
      id: r.id,
      status: r.status,
      error: r.error,
      started_at: r.started_at,
      completed_at: r.completed_at,
      created_at: r.created_at,
    })),
    total,
    limit,
    offset,
  });
});

// Cancel a workflow run
router.post('/:id/runs/:runId/cancel', requireApiKey, async (req: Request, res: Response) => {
  const userId = req.apiUserId;
  const { id, runId } = req.params;
  
  const workflowRun = await queryOne<WorkflowRun>(
    `SELECT * FROM workflow_runs WHERE id = $1 AND workflow_id = $2 AND user_id = $3`,
    [runId, id, userId]
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
  
  res.json({ success: true, message: 'Run cancelled' });
});

// Resume a paused workflow run (human checkpoint)
router.post('/:id/runs/:runId/resume', requireApiKey, async (req: Request, res: Response) => {
  const userId = req.apiUserId;
  const { id, runId } = req.params;
  const { approved, feedback } = req.body;
  
  const workflowRun = await queryOne<WorkflowRun>(
    `SELECT * FROM workflow_runs WHERE id = $1 AND workflow_id = $2 AND user_id = $3 AND status = 'paused'`,
    [runId, id, userId]
  );
  
  if (!workflowRun) {
    return res.status(404).json({ error: 'Paused run not found' });
  }
  
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
        [JSON.stringify({ approved, feedback }), nodeRun.id]
      );
    }
  }
  
  // Update run status
  await execute(
    `UPDATE workflow_runs SET status = 'running', current_node_id = NULL WHERE id = $1`,
    [runId]
  );
  
  res.json({ success: true, message: approved ? 'Workflow resumed' : 'Workflow rejected' });
  
  // Continue execution in background
  if (approved) {
    continueWorkflow(runId, workflowRun.current_node_id!, { approved, feedback }).catch(err => {
      console.error(`[Workflow] Resume error for run ${runId}:`, err);
    });
  } else {
    // User rejected, fail the workflow
    await execute(
      `UPDATE workflow_runs SET status = 'failed', error = 'Rejected at human checkpoint', completed_at = NOW() WHERE id = $1`,
      [runId]
    );
  }
});

// ============================================
// WORKFLOW EXECUTION ENGINE
// ============================================

async function executeWorkflow(runId: string, workflowId: string, userId: string) {
  console.log(`[Workflow] Starting execution for run ${runId}`);
  
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
  // Check if run was cancelled
  const workflowRun = await queryOne<WorkflowRun>(`SELECT * FROM workflow_runs WHERE id = $1`, [runId]);
  if (workflowRun?.status === 'cancelled') {
    console.log(`[Workflow] Run ${runId} was cancelled, stopping execution`);
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
  
  // Broadcast update
  broadcast(runId, {
    type: 'workflow_node_started',
    runId,
    nodeId: node.id,
    nodeName: node.name,
    timestamp: Date.now(),
  });
  
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
        // Update workflow run as completed
        await execute(
          `UPDATE workflow_runs SET 
            status = 'completed', 
            output_data = $1, 
            context = $2,
            completed_at = NOW()
           WHERE id = $3`,
          [JSON.stringify(context), JSON.stringify(context), runId]
        );
        
        // Update node run
        await execute(
          `UPDATE workflow_node_runs SET status = 'completed', output_data = $1, completed_at = NOW() WHERE id = $2`,
          [JSON.stringify(context), nodeRunId]
        );
        
        broadcast(runId, {
          type: 'workflow_completed',
          runId,
          output: context,
          timestamp: Date.now(),
        });
        
        console.log(`[Workflow] Run ${runId} completed`);
        return;
        
      case 'agent':
        output = await executeAgentNode(runId, nodeRunId, node, config, context, userId);
        context = { ...context, [node.name.toLowerCase().replace(/\s+/g, '_')]: output };
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
        return; // Stop execution here, will be resumed
        
      case 'parallel_split':
        // Get all outgoing edges and execute them in parallel
        const parallelEdges = edges.filter(e => e.source_node_id === node.id);
        const parallelNodes = parallelEdges.map(e => nodes.find(n => n.id === e.target_node_id)!).filter(Boolean);
        
        if (parallelNodes.length > 0) {
          // Update node run
          await execute(
            `UPDATE workflow_node_runs SET status = 'completed', output_data = $1, completed_at = NOW() WHERE id = $2`,
            [JSON.stringify({ branches: parallelNodes.length }), nodeRunId]
          );
          
          // Execute all branches in parallel
          await Promise.all(
            parallelNodes.map(n => executeNode(runId, n, nodes, edges, context, userId))
          );
        }
        return;
        
      case 'parallel_merge':
        // Collect outputs from all incoming edges
        // For simplicity, just continue with current context
        output = context;
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
      
      broadcast(runId, {
        type: 'workflow_failed',
        runId,
        error: error.message,
        timestamp: Date.now(),
      });
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

async function executeAgentNode(
  runId: string,
  nodeRunId: string,
  node: WorkflowNode,
  config: any,
  context: Record<string, any>,
  userId: string
): Promise<any> {
  // Config should have: agent_id, prompt_template
  const { agent_id, prompt_template } = config;
  
  if (!agent_id) {
    throw new Error('Agent node requires agent_id in config');
  }
  
  // Replace template variables with context values
  let prompt = prompt_template || '{{input}}';
  for (const [key, value] of Object.entries(context)) {
    const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
    prompt = prompt.replace(new RegExp(`{{${key}}}`, 'g'), valueStr);
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
  
  // WAIT for the task to complete (30 minute timeout)
  const taskResult = await waitForTaskCompletion(taskId, runId, node.name);
  
  if (taskResult.status === 'failed') {
    throw new Error(taskResult.error || 'Agent task failed');
  }
  
  console.log(`[Workflow] Task ${taskId} completed for node ${node.name}`);
  
  return taskResult.result || 'Task completed';
}

// Wait for a task to complete (polls the task_queue/tasks table)
async function waitForTaskCompletion(
  taskId: string, 
  runId: string,
  nodeName: string,
  timeoutMs: number = 30 * 60 * 1000 // 30 minute timeout
): Promise<{ status: string; result: string | null; error: string | null }> {
  const startTime = Date.now();
  const pollIntervalMs = 2000;
  
  while (Date.now() - startTime < timeoutMs) {
    // Check if workflow run was cancelled
    const workflowRun = await queryOne<{ status: string }>(
      'SELECT status FROM workflow_runs WHERE id = $1',
      [runId]
    );
    
    if (workflowRun?.status === 'cancelled') {
      return { status: 'failed', result: null, error: 'Workflow was cancelled' };
    }
    
    // Check task_queue status (this is what the worker updates)
    const queueTask = await queryOne<{ status: string; result?: string; error?: string }>(
      'SELECT status, result, error FROM task_queue WHERE id = $1',
      [taskId]
    );
    
    const status = queueTask?.status || 'pending';
    const result = queueTask?.result || null;
    const error = queueTask?.error || null;
    
    console.log(`[Workflow] Task ${taskId} (${nodeName}) status: ${status}`);
    
    if (status === 'completed') {
      return { status: 'completed', result, error: null };
    }
    
    if (status === 'failed') {
      return { status: 'failed', result: null, error: error || 'Task failed' };
    }
    
    // Wait before polling again
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  
  return { status: 'failed', result: null, error: `Task timed out after ${timeoutMs / 1000}s` };
}

function evaluateCondition(expression: string, context: Record<string, any>): boolean {
  try {
    // Simple condition evaluation using Function constructor
    // In production, use a safer expression evaluator
    const func = new Function(...Object.keys(context), `return ${expression}`);
    return Boolean(func(...Object.values(context)));
  } catch (error) {
    console.error(`[Workflow] Condition evaluation failed:`, error);
    return false;
  }
}

function executeTransform(expression: string, context: Record<string, any>): any {
  try {
    const func = new Function(...Object.keys(context), `return ${expression}`);
    return func(...Object.values(context));
  } catch (error) {
    console.error(`[Workflow] Transform execution failed:`, error);
    return {};
  }
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

export default router;
