/**
 * Task handle for managing submitted tasks
 */

import { EventEmitter } from 'node:events';
import type { TaskResult, TaskStatus, ServerMessage, TaskEventType, TaskEventHandlers } from './types.js';
import type { WebSocketClient } from './websocket.js';
import { TaskCancelledError, TaskFailedError, TaskTimeoutError } from './errors.js';

export class TaskHandle<T = any> extends EventEmitter {
  public readonly id: string;
  public readonly agentId: string;
  public readonly sessionId?: string;  // SDK session ID if using isolated sandbox
  private wsClient: WebSocketClient;
  private status: TaskStatus = 'pending';
  private _result: TaskResult<T> | null = null;
  private resultPromise: Promise<TaskResult<T>> | null = null;
  private resolveResult: ((result: TaskResult<T>) => void) | null = null;
  private rejectResult: ((error: Error) => void) | null = null;
  private timeout: number;
  private timeoutHandle: NodeJS.Timeout | null = null;

  constructor(
    id: string,
    agentId: string,
    wsClient: WebSocketClient,
    timeout: number = 600, // 10 minutes default in seconds
    sessionId?: string     // Optional SDK session ID for isolated sandbox
  ) {
    super();
    this.id = id;
    this.agentId = agentId;
    this.sessionId = sessionId;
    this.wsClient = wsClient;
    this.timeout = timeout;

    // Set up message handler
    this.wsClient.on('message', this.handleMessage.bind(this));
  }

  private handleMessage(message: ServerMessage) {
    // Only handle messages for this task
    if (!('taskId' in message) || message.taskId !== this.id) {
      return;
    }

    switch (message.type) {
      case 'task_started':
        this.status = 'processing';
        this.emit('status', 'processing');
        break;

      case 'stdout':
        this.emit('stdout', message.data);
        break;

      case 'stderr':
        this.emit('stderr', message.data);
        break;

      case 'tool_start':
        this.emit('tool_start', message.tool, message.input);
        break;

      case 'tool_end':
        this.emit('tool_end', message.tool, message.output, message.duration);
        break;

      case 'task_completed':
        this.status = 'completed';
        this._result = {
          id: this.id,
          agentId: this.agentId,
          status: 'completed',
          result: message.result,
          output: message.output as T,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
        this.emit('status', 'completed');
        this.clearTimeout();
        if (this.resolveResult) {
          this.resolveResult(this._result);
        }
        this.cleanup();
        break;

      case 'task_failed':
        this.status = 'failed';
        this._result = {
          id: this.id,
          agentId: this.agentId,
          status: 'failed',
          error: message.error,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
        this.emit('status', 'failed');
        this.clearTimeout();
        if (this.rejectResult) {
          this.rejectResult(new TaskFailedError(this.id, message.error));
        }
        this.cleanup();
        break;

      case 'task_cancelled':
        this.status = 'cancelled';
        this._result = {
          id: this.id,
          agentId: this.agentId,
          status: 'cancelled',
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
        this.emit('status', 'cancelled');
        this.clearTimeout();
        if (this.rejectResult) {
          this.rejectResult(new TaskCancelledError(this.id));
        }
        this.cleanup();
        break;

      case 'task_cancelling':
        this.status = 'cancelling';
        this.emit('status', 'cancelling');
        break;

      case 'task_status':
        // Status update from subscription
        this.status = message.status;
        if (message.status === 'completed') {
          this._result = {
            id: this.id,
            agentId: this.agentId,
            status: 'completed',
            result: message.result,
            output: message.structuredOutput as T,
            createdAt: message.createdAt || new Date().toISOString(),
            startedAt: message.startedAt,
            completedAt: message.completedAt,
          };
          if (this.resolveResult) {
            this.resolveResult(this._result);
          }
          this.cleanup();
        } else if (message.status === 'failed') {
          this._result = {
            id: this.id,
            agentId: this.agentId,
            status: 'failed',
            error: message.error,
            createdAt: message.createdAt || new Date().toISOString(),
            completedAt: message.completedAt,
          };
          if (this.rejectResult) {
            this.rejectResult(new TaskFailedError(this.id, message.error || 'Unknown error'));
          }
          this.cleanup();
        } else if (message.status === 'cancelled') {
          this._result = {
            id: this.id,
            agentId: this.agentId,
            status: 'cancelled',
            createdAt: message.createdAt || new Date().toISOString(),
            completedAt: message.completedAt,
          };
          if (this.rejectResult) {
            this.rejectResult(new TaskCancelledError(this.id));
          }
          this.cleanup();
        }
        break;
    }
  }

  private cleanup() {
    this.wsClient.off('message', this.handleMessage.bind(this));
    this.wsClient.unsubscribe(this.id);
  }

  private clearTimeout() {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  /**
   * Register event handler
   */
  on<K extends TaskEventType>(event: K, handler: TaskEventHandlers[K]): this {
    return super.on(event, handler);
  }

  /**
   * Cancel the task
   */
  async cancel(): Promise<void> {
    if (this.status === 'completed' || this.status === 'failed' || this.status === 'cancelled') {
      return; // Already finished
    }
    this.wsClient.cancel(this.id);
  }

  /**
   * Wait for the task to complete
   */
  async result(): Promise<TaskResult<T>> {
    // If already completed, return cached result
    if (this._result) {
      if (this._result.status === 'completed') {
        return this._result;
      } else if (this._result.status === 'failed') {
        throw new TaskFailedError(this.id, this._result.error || 'Unknown error');
      } else if (this._result.status === 'cancelled') {
        throw new TaskCancelledError(this.id);
      }
    }

    // Create promise if not already waiting
    if (!this.resultPromise) {
      this.resultPromise = new Promise<TaskResult<T>>((resolve, reject) => {
        this.resolveResult = resolve;
        this.rejectResult = reject;

        // Set timeout (convert seconds to milliseconds)
        this.timeoutHandle = setTimeout(() => {
          reject(new TaskTimeoutError(this.id, this.timeout));
          this.cleanup();
        }, this.timeout * 1000);
      });
    }

    return this.resultPromise;
  }

  /**
   * Get current status
   */
  getStatus(): TaskStatus {
    return this.status;
  }

  /**
   * Check if task is finished
   */
  isFinished(): boolean {
    return this.status === 'completed' || this.status === 'failed' || this.status === 'cancelled';
  }
}
