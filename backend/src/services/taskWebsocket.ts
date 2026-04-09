import { WebSocket } from 'ws';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, execute } from '../db/index.js';
import type { ApiKey, QueuedTask } from '../types/index.js';

// Store connections by connection ID
interface TaskConnection {
  ws: WebSocket;
  userId: string;
  apiKeyId: string;
  subscribedTasks: Set<string>;
}

const connections: Map<string, TaskConnection> = new Map();
// Reverse lookup: task ID -> connection IDs subscribed to it
const taskSubscribers: Map<string, Set<string>> = new Map();

/**
 * Validate an API key and return the key record if valid
 */
async function validateApiKey(apiKey: string): Promise<ApiKey | undefined> {
  if (!apiKey?.startsWith('flt_')) {
    return undefined;
  }

  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const keyRecord = await queryOne<ApiKey>(
    'SELECT * FROM api_keys WHERE key_hash = $1',
    [keyHash]
  );

  if (keyRecord) {
    // Update last used timestamp
    await execute(
      'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
      [keyRecord.id]
    );
  }

  return keyRecord;
}

/**
 * Handle a new WebSocket connection for tasks
 */
export async function handleTaskConnection(ws: WebSocket, apiKey: string): Promise<boolean> {
  const keyRecord = await validateApiKey(apiKey);
  
  if (!keyRecord) {
    ws.close(4001, 'Invalid API key');
    return false;
  }

  const connectionId = uuidv4();
  connections.set(connectionId, {
    ws,
    userId: keyRecord.user_id,
    apiKeyId: keyRecord.id,
    subscribedTasks: new Set(),
  });

  console.log(`[TaskWS] Client connected: ${connectionId} (user: ${keyRecord.user_id})`);

  // Send welcome message
  ws.send(JSON.stringify({ type: 'connected', connectionId }));

  // Set up message handler
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      await handleMessage(connectionId, msg);
    } catch (error) {
      console.error('[TaskWS] Error handling message:', error);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  // Handle close
  ws.on('close', () => {
    console.log(`[TaskWS] Client disconnected: ${connectionId}`);
    const conn = connections.get(connectionId);
    if (conn) {
      // Unsubscribe from all tasks
      for (const taskId of conn.subscribedTasks) {
        taskSubscribers.get(taskId)?.delete(connectionId);
        if (taskSubscribers.get(taskId)?.size === 0) {
          taskSubscribers.delete(taskId);
        }
      }
      connections.delete(connectionId);
    }
  });

  ws.on('error', (err) => {
    console.error(`[TaskWS] Connection error for ${connectionId}:`, err);
  });

  return true;
}

/**
 * Handle incoming WebSocket messages
 */
async function handleMessage(connectionId: string, msg: any) {
  const conn = connections.get(connectionId);
  if (!conn) return;

  switch (msg.type) {
    case 'submit':
      await handleSubmit(conn, connectionId, msg);
      break;
    case 'cancel':
      await handleCancel(conn, msg);
      break;
    case 'subscribe':
      await handleSubscribe(conn, connectionId, msg);
      break;
    case 'unsubscribe':
      handleUnsubscribe(conn, connectionId, msg);
      break;
    case 'ping':
      conn.ws.send(JSON.stringify({ type: 'pong' }));
      break;
    default:
      conn.ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
  }
}

/**
 * Handle task submission
 * Supports optional sdkSessionId for sandbox isolation
 */
async function handleSubmit(conn: TaskConnection, connectionId: string, msg: { 
  agentId: string; 
  prompt: string; 
  priority?: number;
  sdkSessionId?: string;  // Optional SDK session for isolated sandbox
  provision?: boolean;    // If true, create a new SDK session automatically
}) {
  const { agentId, prompt, priority = 0, sdkSessionId, provision } = msg;

  if (!agentId || !prompt) {
    conn.ws.send(JSON.stringify({ type: 'error', message: 'agentId and prompt are required' }));
    return;
  }

  // Verify agent exists and belongs to user, and has API enabled
  const agent = await queryOne<{ id: string; api_enabled: boolean }>(
    `SELECT s.id, COALESCE(ac.api_enabled, false) as api_enabled 
     FROM sessions s 
     LEFT JOIN agent_configs ac ON ac.session_id = s.id 
     WHERE s.id = $1 AND s.user_id = $2`,
    [agentId, conn.userId]
  );

  if (!agent) {
    conn.ws.send(JSON.stringify({ type: 'error', message: 'Agent not found' }));
    return;
  }

  if (!agent.api_enabled) {
    conn.ws.send(JSON.stringify({ type: 'error', message: 'API access not enabled for this agent' }));
    return;
  }

  // Handle SDK session
  let finalSdkSessionId = sdkSessionId;
  
  // If provision is true, create a new SDK session automatically
  if (provision && !sdkSessionId) {
    finalSdkSessionId = uuidv4();
    await execute(
      `INSERT INTO sdk_sessions (id, agent_id, api_key_id, status, created_at, last_used_at)
       VALUES ($1, $2, $3, 'active', NOW(), NOW())`,
      [finalSdkSessionId, agentId, conn.apiKeyId]
    );
    console.log(`[TaskWS] Created new SDK session ${finalSdkSessionId} for agent ${agentId}`);
  }
  
  // If sdkSessionId provided, verify it exists, is active, and belongs to this API key
  if (finalSdkSessionId) {
    const session = await queryOne<{ id: string; status: string; api_key_id: string }>(
      'SELECT id, status, api_key_id FROM sdk_sessions WHERE id = $1 AND agent_id = $2',
      [finalSdkSessionId, agentId]
    );
    
    if (!session) {
      conn.ws.send(JSON.stringify({ type: 'error', message: 'SDK session not found' }));
      return;
    }
    
    // Verify API key ownership (unless it was just created by provision)
    if (!provision && session.api_key_id !== conn.apiKeyId) {
      conn.ws.send(JSON.stringify({ type: 'error', message: 'SDK session belongs to a different API key' }));
      return;
    }
    
    if (session.status !== 'active') {
      conn.ws.send(JSON.stringify({ type: 'error', message: 'SDK session is closed' }));
      return;
    }
    
    // Update last_used_at
    await execute(
      'UPDATE sdk_sessions SET last_used_at = NOW() WHERE id = $1',
      [finalSdkSessionId]
    );
  }

  // Create task in queue with optional SDK session ID
  const taskId = uuidv4();
  await execute(
    `INSERT INTO task_queue (id, agent_id, user_id, prompt, status, priority, source, api_key_id, sdk_session_id, created_at)
     VALUES ($1, $2, $3, $4, 'pending', $5, 'api', $6, $7, NOW())`,
    [taskId, agentId, conn.userId, prompt, priority, conn.apiKeyId, finalSdkSessionId || null]
  );

  // Auto-subscribe to this task
  conn.subscribedTasks.add(taskId);
  if (!taskSubscribers.has(taskId)) {
    taskSubscribers.set(taskId, new Set());
  }
  taskSubscribers.get(taskId)!.add(connectionId);

  // Send task created event (include sdkSessionId if it was created/used)
  conn.ws.send(JSON.stringify({
    type: 'task_created',
    taskId,
    agentId,
    sdkSessionId: finalSdkSessionId || undefined,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }));

  console.log(`[TaskWS] Task ${taskId} created for agent ${agentId}${finalSdkSessionId ? ` (session: ${finalSdkSessionId})` : ''}`);
}

/**
 * Handle task cancellation
 */
async function handleCancel(conn: TaskConnection, msg: { taskId: string }) {
  const { taskId } = msg;

  if (!taskId) {
    conn.ws.send(JSON.stringify({ type: 'error', message: 'taskId is required' }));
    return;
  }

  // Verify task exists and belongs to user
  const task = await queryOne<QueuedTask>(
    'SELECT * FROM task_queue WHERE id = $1 AND user_id = $2',
    [taskId, conn.userId]
  );

  if (!task) {
    conn.ws.send(JSON.stringify({ type: 'error', message: 'Task not found' }));
    return;
  }

  // Can only cancel pending or processing tasks
  if (task.status !== 'pending' && task.status !== 'processing') {
    conn.ws.send(JSON.stringify({ 
      type: 'error', 
      message: `Cannot cancel task with status: ${task.status}` 
    }));
    return;
  }

  // Update status to cancelling (worker will handle actual cancellation)
  await execute(
    'UPDATE task_queue SET status = $1 WHERE id = $2',
    ['cancelling', taskId]
  );

  // If task was pending (not yet picked up by worker), mark as cancelled immediately
  if (task.status === 'pending') {
    await execute(
      'UPDATE task_queue SET status = $1, completed_at = NOW() WHERE id = $2',
      ['cancelled', taskId]
    );
    broadcastTaskEvent(taskId, { type: 'task_cancelled', taskId });
  } else {
    // Processing task - worker will detect cancelling status and handle it
    broadcastTaskEvent(taskId, { type: 'task_cancelling', taskId });
  }

  console.log(`[TaskWS] Task ${taskId} cancellation requested`);
}

/**
 * Handle subscribing to a task's events
 */
async function handleSubscribe(conn: TaskConnection, connectionId: string, msg: { taskId: string }) {
  const { taskId } = msg;

  if (!taskId) {
    conn.ws.send(JSON.stringify({ type: 'error', message: 'taskId is required' }));
    return;
  }

  // Verify task exists and belongs to user
  const task = await queryOne<QueuedTask>(
    'SELECT * FROM task_queue WHERE id = $1 AND user_id = $2',
    [taskId, conn.userId]
  );

  if (!task) {
    conn.ws.send(JSON.stringify({ type: 'error', message: 'Task not found' }));
    return;
  }

  // Subscribe to task
  conn.subscribedTasks.add(taskId);
  if (!taskSubscribers.has(taskId)) {
    taskSubscribers.set(taskId, new Set());
  }
  taskSubscribers.get(taskId)!.add(connectionId);

  // Send current task status
  conn.ws.send(JSON.stringify({
    type: 'task_status',
    taskId,
    status: task.status,
    result: task.result,
    structuredOutput: task.structured_output ? JSON.parse(task.structured_output) : undefined,
    error: task.error,
    createdAt: task.created_at,
    startedAt: task.started_at,
    completedAt: task.completed_at,
  }));

  console.log(`[TaskWS] Connection ${connectionId} subscribed to task ${taskId}`);
}

/**
 * Handle unsubscribing from a task's events
 */
function handleUnsubscribe(conn: TaskConnection, connectionId: string, msg: { taskId: string }) {
  const { taskId } = msg;

  if (!taskId) {
    conn.ws.send(JSON.stringify({ type: 'error', message: 'taskId is required' }));
    return;
  }

  conn.subscribedTasks.delete(taskId);
  taskSubscribers.get(taskId)?.delete(connectionId);
  if (taskSubscribers.get(taskId)?.size === 0) {
    taskSubscribers.delete(taskId);
  }

  console.log(`[TaskWS] Connection ${connectionId} unsubscribed from task ${taskId}`);
}

/**
 * Broadcast an event to all connections subscribed to a task
 */
export function broadcastTaskEvent(taskId: string, event: object) {
  const subscribers = taskSubscribers.get(taskId);
  if (!subscribers || subscribers.size === 0) return;

  const message = JSON.stringify({ ...event, timestamp: Date.now() });
  
  for (const connectionId of subscribers) {
    const conn = connections.get(connectionId);
    if (conn && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(message);
    }
  }
}

/**
 * Send task started event
 */
export function sendTaskStarted(taskId: string) {
  broadcastTaskEvent(taskId, { type: 'task_started', taskId });
}

/**
 * Send task stdout event
 */
export function sendTaskStdout(taskId: string, data: string) {
  broadcastTaskEvent(taskId, { type: 'stdout', taskId, data });
}

/**
 * Send task stderr event
 */
export function sendTaskStderr(taskId: string, data: string) {
  broadcastTaskEvent(taskId, { type: 'stderr', taskId, data });
}

/**
 * Send tool start event
 */
export function sendTaskToolStart(taskId: string, tool: string, input?: any) {
  broadcastTaskEvent(taskId, { type: 'tool_start', taskId, tool, input });
}

/**
 * Send tool end event
 */
export function sendTaskToolEnd(taskId: string, tool: string, output?: any, duration?: number) {
  broadcastTaskEvent(taskId, { type: 'tool_end', taskId, tool, output, duration });
}

/**
 * Send task completed event
 */
export function sendTaskCompleted(taskId: string, result?: string, structuredOutput?: any) {
  broadcastTaskEvent(taskId, { type: 'task_completed', taskId, result, output: structuredOutput });
}

/**
 * Send task failed event
 */
export function sendTaskFailed(taskId: string, error: string) {
  broadcastTaskEvent(taskId, { type: 'task_failed', taskId, error });
}

/**
 * Send task cancelled event
 */
export function sendTaskCancelled(taskId: string) {
  broadcastTaskEvent(taskId, { type: 'task_cancelled', taskId });
}

/**
 * Check if a task has any active subscribers (useful for determining if we should stream events)
 */
export function hasTaskSubscribers(taskId: string): boolean {
  const subscribers = taskSubscribers.get(taskId);
  return subscribers !== undefined && subscribers.size > 0;
}
