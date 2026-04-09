import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { ocService } from './oc.js';
import { handleTaskConnection } from './taskWebsocket.js';

// Store connections by session ID
const connections: Map<string, Set<WebSocket>> = new Map();
const ptyConnections: Map<string, WebSocket> = new Map(); // PTY connections (one per session)
const workflowConnections: Map<string, Set<WebSocket>> = new Map(); // Workflow run connections

let wss: WebSocketServer;
let ptyWss: WebSocketServer;

export function initWebSocket(server: Server) {
  // Create WebSocket servers WITHOUT attaching to the HTTP server directly
  // We'll handle the upgrade manually to route to the correct server
  wss = new WebSocketServer({ noServer: true });
  ptyWss = new WebSocketServer({ noServer: true });

  // Handle HTTP upgrade requests manually to route to correct WebSocket server
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = request.url?.split('?')[0];

    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (pathname === '/pty') {
      ptyWss.handleUpgrade(request, socket, head, (ws) => {
        ptyWss.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/workflow') {
      // Handle workflow-specific WebSocket connections
      wss.handleUpgrade(request, socket, head, (ws) => {
        const url = new URL(request.url || '', `http://${request.headers.host}`);
        const runId = url.searchParams.get('runId');
        
        if (!runId) {
          ws.close(1008, 'Run ID required');
          return;
        }
        
        console.log(`[WS] Workflow client connected for run ${runId}`);
        
        // Register this connection for workflow updates
        registerWorkflowConnection(runId, ws);
        
        // Send welcome message
        ws.send(JSON.stringify({ type: 'connected', runId }));
        
        ws.on('close', () => {
          console.log(`[WS] Workflow client disconnected from run ${runId}`);
          unregisterWorkflowConnection(runId, ws);
        });
        
        ws.on('error', (err) => {
          console.error(`[WS] Workflow error for run ${runId}:`, err);
        });
      });
    } else if (pathname === '/ws/v1/tasks') {
      // Handle SDK task WebSocket connections (API key auth)
      wss.handleUpgrade(request, socket, head, async (ws) => {
        const url = new URL(request.url || '', `http://${request.headers.host}`);
        const apiKey = url.searchParams.get('apiKey');
        
        if (!apiKey) {
          ws.close(4001, 'API key required');
          return;
        }
        
        // Delegate to task WebSocket handler
        await handleTaskConnection(ws, apiKey);
      });
    } else {
      // Not a WebSocket path we handle - destroy the socket
      socket.destroy();
    }
  });

  wss.on('connection', (ws, req) => {
    // Extract session ID from URL: /ws?sessionId=xxx
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');

    if (!sessionId) {
      ws.close(1008, 'Session ID required');
      return;
    }

    console.log(`[WS] Client connected for session ${sessionId}`);

    // Add to connections
    if (!connections.has(sessionId)) {
      connections.set(sessionId, new Set());
    }
    connections.get(sessionId)!.add(ws);

    // Send welcome message
    ws.send(JSON.stringify({ type: 'connected', sessionId }));

    ws.on('close', () => {
      console.log(`[WS] Client disconnected from session ${sessionId}`);
      connections.get(sessionId)?.delete(ws);
      if (connections.get(sessionId)?.size === 0) {
        connections.delete(sessionId);
      }
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error for session ${sessionId}:`, err);
    });
  });

  console.log('[WS] WebSocket server initialized on /ws');

  ptyWss.on('connection', async (ws, req) => {
    // Extract session ID from URL: /pty?sessionId=xxx
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');

    if (!sessionId) {
      ws.close(1008, 'Session ID required');
      return;
    }

    console.log(`[PTY] Client connected for session ${sessionId}`);

    // Close existing PTY connection for this session if any
    const existingWs = ptyConnections.get(sessionId);
    if (existingWs && existingWs.readyState === WebSocket.OPEN) {
      existingWs.close(1000, 'New connection established');
    }

    // Store PTY connection
    ptyConnections.set(sessionId, ws);

    // Create PTY session in E2B sandbox
    const result = await ocService.createPTY(sessionId, (data: string) => {
      // Send PTY output to WebSocket client
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data }));
      }
    });

    if (!result.success) {
      console.error(`[PTY] Failed to create PTY for session ${sessionId}:`, result.error);
      ws.send(JSON.stringify({ type: 'error', message: result.error || 'Failed to create PTY' }));
      ws.close(1011, 'PTY creation failed');
      return;
    }

    // Send ready message
    ws.send(JSON.stringify({ type: 'ready', sessionId }));

    // Handle incoming messages (user input)
    ws.on('message', async (message: Buffer) => {
      try {
        const msg = JSON.parse(message.toString());

        if (msg.type === 'input') {
          // Send input to PTY
          const inputResult = await ocService.sendPTYInput(sessionId, msg.data);
          if (!inputResult.success) {
            console.error(`[PTY] Failed to send input:`, inputResult.error);
            ws.send(JSON.stringify({ type: 'error', message: inputResult.error }));
          }
        } else if (msg.type === 'resize') {
          // Resize PTY
          const resizeResult = await ocService.resizePTY(sessionId, msg.cols, msg.rows);
          if (!resizeResult.success) {
            console.error(`[PTY] Failed to resize:`, resizeResult.error);
          }
        }
      } catch (error) {
        console.error(`[PTY] Error handling message:`, error);
      }
    });

    ws.on('close', async () => {
      console.log(`[PTY] Client disconnected from session ${sessionId}`);
      ptyConnections.delete(sessionId);
      // Close PTY session
      await ocService.closePTY(sessionId);
    });

    ws.on('error', (err) => {
      console.error(`[PTY] Error for session ${sessionId}:`, err);
    });
  });

  console.log('[PTY] PTY WebSocket server initialized on /pty');
}

// Broadcast a message to all clients for a session
export function broadcast(sessionId: string, data: object) {
  const clients = connections.get(sessionId);
  if (!clients || clients.size === 0) {
    return; // No clients connected
  }

  const message = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Send streaming output
export function sendOutput(sessionId: string, text: string, type: 'stdout' | 'stderr' = 'stdout') {
  broadcast(sessionId, { type: 'output', text, stream: type, timestamp: Date.now() });
}

// Send task status updates
export function sendTaskStatus(sessionId: string, taskId: string, status: string, result?: string) {
  broadcast(sessionId, { type: 'task_status', taskId, status, result, timestamp: Date.now() });
}

// ==========================================
// Workflow WebSocket Support
// ==========================================

// Register a WebSocket connection for workflow updates
export function registerWorkflowConnection(runId: string, ws: WebSocket) {
  if (!workflowConnections.has(runId)) {
    workflowConnections.set(runId, new Set());
  }
  workflowConnections.get(runId)!.add(ws);
  console.log(`[WS] Workflow connection registered for run ${runId}`);
}

// Unregister a WebSocket connection for workflow updates
export function unregisterWorkflowConnection(runId: string, ws: WebSocket) {
  workflowConnections.get(runId)?.delete(ws);
  if (workflowConnections.get(runId)?.size === 0) {
    workflowConnections.delete(runId);
  }
}

// Broadcast workflow update to all connected clients for a run
export function broadcastWorkflowUpdate(runId: string, data: object) {
  const clients = workflowConnections.get(runId);
  if (!clients || clients.size === 0) return;
  
  const message = JSON.stringify({ ...data, runId, timestamp: Date.now() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Send workflow node status update
export function sendWorkflowNodeStatus(
  runId: string, 
  nodeId: string, 
  nodeName: string,
  nodeType: string,
  status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting',
  output?: string,
  error?: string
) {
  broadcastWorkflowUpdate(runId, { 
    type: 'workflow_node_status',
    nodeId,
    nodeName,
    nodeType,
    status,
    output: output?.slice(0, 500), // Truncate for websocket
    error,
  });
}

// Send workflow run status update
export function sendWorkflowRunStatus(
  runId: string,
  status: 'running' | 'completed' | 'failed' | 'paused' | 'cancelled'
) {
  broadcastWorkflowUpdate(runId, {
    type: 'workflow_run_status',
    status,
  });
}
