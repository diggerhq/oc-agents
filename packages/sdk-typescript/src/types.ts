/**
 * OpenComputer Agents SDK Types
 */

// Task status including cancellation states
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelling' | 'cancelled';

// Agent types
export type AgentType = 'code' | 'task' | 'portal';
export type AgentProvider = 'claude-code' | 'aider' | 'opencode';

/**
 * Task result with optional typed structured output
 */
export interface TaskResult<T = any> {
  id: string;
  agentId: string;
  status: TaskStatus;
  result?: string;           // Raw text output
  output?: T;                // Structured output (if output_schema defined)
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

/**
 * Agent information
 */
export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  provider: AgentProvider;
  model?: string;
  outputSchema?: object;     // JSON Schema for structured output
  apiEnabled: boolean;
  createdAt: string;
}

/**
 * Options for running a task
 */
export interface RunOptions {
  prompt: string;
  priority?: number;
  timeout?: number;          // Max wait time in seconds (default: 600s = 10 minutes)
  sessionId?: string;        // SDK session ID for isolated sandbox (optional)
}

/**
 * Options for submitting a task (non-blocking)
 */
export interface SubmitOptions extends RunOptions {
  provision?: boolean;       // If true, create a new SDK session automatically
}

/**
 * SDK Session for isolated sandbox access
 */
export interface SdkSession {
  id: string;
  agentId: string;
  sandboxId?: string;
  status: 'active' | 'closed';
  createdAt: string;
  lastUsedAt: string;
}

/**
 * Client configuration
 */
export interface OCAgentsConfig {
  apiKey: string;
  baseUrl?: string;          // Default: https://api.opencomputer.dev
  timeout?: number;          // Default timeout for operations in seconds (600s = 10 minutes)
}

/**
 * WebSocket message types from server
 */
export type ServerMessage =
  | { type: 'connected'; connectionId: string }
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong' }
  | { type: 'task_created'; taskId: string; agentId: string; sdkSessionId?: string; status: string; createdAt: string }
  | { type: 'task_started'; taskId: string; timestamp: number }
  | { type: 'task_completed'; taskId: string; result?: string; output?: any; timestamp: number }
  | { type: 'task_failed'; taskId: string; error: string; timestamp: number }
  | { type: 'task_cancelled'; taskId: string; timestamp: number }
  | { type: 'task_cancelling'; taskId: string; timestamp: number }
  | { type: 'task_status'; taskId: string; status: TaskStatus; result?: string; structuredOutput?: any; error?: string; createdAt?: string; startedAt?: string; completedAt?: string }
  | { type: 'stdout'; taskId: string; data: string; timestamp: number }
  | { type: 'stderr'; taskId: string; data: string; timestamp: number }
  | { type: 'tool_start'; taskId: string; tool: string; input?: any; timestamp: number }
  | { type: 'tool_end'; taskId: string; tool: string; output?: any; duration?: number; timestamp: number };

/**
 * WebSocket message types to server
 */
export type ClientMessage =
  | { type: 'submit'; agentId: string; prompt: string; priority?: number; sdkSessionId?: string; provision?: boolean }
  | { type: 'cancel'; taskId: string }
  | { type: 'subscribe'; taskId: string }
  | { type: 'unsubscribe'; taskId: string }
  | { type: 'ping' };

/**
 * Event handler types for TaskHandle
 */
export interface TaskEventHandlers {
  stdout: (data: string) => void;
  stderr: (data: string) => void;
  tool_start: (tool: string, input?: any) => void;
  tool_end: (tool: string, output?: any, duration?: number) => void;
  status: (status: TaskStatus) => void;
}

export type TaskEventType = keyof TaskEventHandlers;
