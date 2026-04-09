/**
 * WebSocket client with auto-reconnect for OpenComputer Agents SDK
 */

import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import type { ServerMessage, ClientMessage } from './types.js';
import { ConnectionError, AuthenticationError } from './errors.js';

export interface WebSocketClientOptions {
  apiKey: string;
  baseUrl: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export class WebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private baseUrl: string;
  private reconnect: boolean;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts: number = 0;
  private connectionId: string | null = null;
  private isConnecting: boolean = false;
  private shouldReconnect: boolean = true;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(options: WebSocketClientOptions) {
    super();
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.reconnect = options.reconnect ?? true;
    this.reconnectInterval = options.reconnectInterval ?? 1000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.isConnecting) {
      // Wait for existing connection attempt
      return new Promise((resolve, reject) => {
        this.once('connected', resolve);
        this.once('error', reject);
      });
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      const wsUrl = this.baseUrl.replace(/^http/, 'ws') + `/ws/v1/tasks?apiKey=${this.apiKey}`;
      
      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
          this.reconnectAttempts = 0;
          this.isConnecting = false;
          this.startPingInterval();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message: ServerMessage = JSON.parse(data.toString());
            this.handleMessage(message, resolve);
          } catch (e) {
            console.error('[OC WS] Failed to parse message:', e);
          }
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          this.isConnecting = false;
          this.stopPingInterval();
          
          if (code === 4001) {
            // Authentication failed
            const error = new AuthenticationError(reason.toString() || 'Invalid API key');
            this.emit('error', error);
            reject(error);
            return;
          }

          this.emit('disconnected', { code, reason: reason.toString() });
          
          if (this.shouldReconnect && this.reconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        });

        this.ws.on('error', (error: Error) => {
          this.isConnecting = false;
          const connError = new ConnectionError(error.message);
          this.emit('error', connError);
          reject(connError);
        });
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  private handleMessage(message: ServerMessage, resolveConnect?: (value: void) => void) {
    switch (message.type) {
      case 'connected':
        this.connectionId = message.connectionId;
        this.emit('connected', message.connectionId);
        if (resolveConnect) resolveConnect();
        break;
      case 'error':
        this.emit('server_error', message);
        break;
      case 'pong':
        // Heartbeat response
        break;
      default:
        // Task events
        this.emit('message', message);
        // Also emit specific event type
        this.emit(message.type, message);
    }
  }

  private startPingInterval() {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, 30000);
  }

  private stopPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[OC WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect().catch((e) => {
          console.error('[OC WS] Reconnection failed:', e);
        });
      }
    }, delay);
  }

  /**
   * Send a message to the server
   */
  send(message: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new ConnectionError('WebSocket not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Submit a task
   */
  submit(agentId: string, prompt: string, priority?: number, sdkSessionId?: string, provision?: boolean): void {
    this.send({ type: 'submit', agentId, prompt, priority, sdkSessionId, provision });
  }

  /**
   * Cancel a task
   */
  cancel(taskId: string): void {
    this.send({ type: 'cancel', taskId });
  }

  /**
   * Subscribe to task events
   */
  subscribe(taskId: string): void {
    this.send({ type: 'subscribe', taskId });
  }

  /**
   * Unsubscribe from task events
   */
  unsubscribe(taskId: string): void {
    this.send({ type: 'unsubscribe', taskId });
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connectionId = null;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection ID
   */
  getConnectionId(): string | null {
    return this.connectionId;
  }
}
