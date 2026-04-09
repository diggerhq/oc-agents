import { useEffect, useRef, useState } from 'react';

interface WebSocketMessage {
  type: string;
  text?: string;
  stream?: 'stdout' | 'stderr';
  taskId?: string;
  status?: string;
  result?: string;
  timestamp?: number;
}

interface UseWebSocketOptions {
  sessionId: string | undefined;
  onOutput?: (text: string, isStatus?: boolean) => void;
  onTaskStatus?: (taskId: string, status: string, result?: string) => void;
}

// Global connection ID to track which connection is "current"
let globalConnectionId = 0;

export function useWebSocket({ sessionId, onOutput, onTaskStatus }: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionIdRef = useRef<number>(0);
  
  // Store callbacks in refs to prevent reconnection when they change
  const onOutputRef = useRef(onOutput);
  const onTaskStatusRef = useRef(onTaskStatus);
  
  useEffect(() => {
    onOutputRef.current = onOutput;
  }, [onOutput]);
  
  useEffect(() => {
    onTaskStatusRef.current = onTaskStatus;
  }, [onTaskStatus]);

  useEffect(() => {
    if (!sessionId) return;
    
    // Generate a unique ID for this connection attempt
    const myConnectionId = ++globalConnectionId;
    connectionIdRef.current = myConnectionId;
    
    const connect = () => {
      // Only proceed if this is still the current connection
      if (connectionIdRef.current !== myConnectionId) {
        console.log('[WS] Stale connection attempt, skipping');
        return;
      }
      
      // In development, connect directly to backend (bypass Vite proxy issues)
      // In production, use same host
      const isDev = window.location.port === '5173';
      const wsHost = isDev ? 'localhost:3000' : window.location.host;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${wsHost}/ws?sessionId=${sessionId}`;
      console.log('[WS] Connecting to', wsUrl, `(id: ${myConnectionId})`);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Only update state if still current
        if (connectionIdRef.current !== myConnectionId) return;
        console.log('[WS] Connected');
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        // Only handle messages if still current
        if (connectionIdRef.current !== myConnectionId) return;
        try {
          const data: WebSocketMessage = JSON.parse(event.data);
          
          if (data.type === 'output' && data.text) {
            const isStatus = data.stream === 'stderr';
            onOutputRef.current?.(data.text, isStatus);
          } else if (data.type === 'task_status' && data.taskId) {
            onTaskStatusRef.current?.(data.taskId, data.status || '', data.result);
          }
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };

      ws.onclose = () => {
        // Only handle close if still current
        if (connectionIdRef.current !== myConnectionId) {
          console.log('[WS] Stale connection closed, ignoring');
          return;
        }
        console.log('[WS] Disconnected');
        setIsConnected(false);
        wsRef.current = null;
        
        // Reconnect after 2 seconds
        reconnectTimeoutRef.current = setTimeout(connect, 2000);
      };

      ws.onerror = (err) => {
        if (connectionIdRef.current !== myConnectionId) return;
        console.error('[WS] Error:', err);
      };
    };
    
    connect();

    return () => {
      // Invalidate this connection
      connectionIdRef.current = 0;
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [sessionId]);

  return { isConnected };
}

