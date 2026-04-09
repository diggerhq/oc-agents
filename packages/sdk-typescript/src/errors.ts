/**
 * OpenComputer Agents SDK Errors
 */

/**
 * Base error class for OpenComputer Agents SDK
 */
export class OCError extends Error {
  public code: string;

  constructor(message: string, code: string = 'OC_ERROR') {
    super(message);
    this.name = 'OCError';
    this.code = code;
  }
}

/**
 * Error thrown when a task is cancelled
 */
export class TaskCancelledError extends OCError {
  public taskId: string;

  constructor(taskId: string) {
    super(`Task ${taskId} was cancelled`, 'TASK_CANCELLED');
    this.name = 'TaskCancelledError';
    this.taskId = taskId;
  }
}

/**
 * Error thrown when a task fails
 */
export class TaskFailedError extends OCError {
  public taskId: string;
  public taskError: string;

  constructor(taskId: string, error: string) {
    super(`Task ${taskId} failed: ${error}`, 'TASK_FAILED');
    this.name = 'TaskFailedError';
    this.taskId = taskId;
    this.taskError = error;
  }
}

/**
 * Error thrown when a task times out
 */
export class TaskTimeoutError extends OCError {
  public taskId: string;
  public timeout: number;

  constructor(taskId: string, timeout: number) {
    super(`Task ${taskId} timed out after ${timeout}ms`, 'TASK_TIMEOUT');
    this.name = 'TaskTimeoutError';
    this.taskId = taskId;
    this.timeout = timeout;
  }
}

/**
 * Error thrown when WebSocket connection fails
 */
export class ConnectionError extends OCError {
  constructor(message: string) {
    super(message, 'CONNECTION_ERROR');
    this.name = 'ConnectionError';
  }
}

/**
 * Error thrown for authentication failures
 */
export class AuthenticationError extends OCError {
  constructor(message: string = 'Invalid API key') {
    super(message, 'AUTHENTICATION_ERROR');
    this.name = 'AuthenticationError';
  }
}

/**
 * Error thrown when an agent is not found
 */
export class AgentNotFoundError extends OCError {
  public agentId: string;

  constructor(agentId: string) {
    super(`Agent ${agentId} not found`, 'AGENT_NOT_FOUND');
    this.name = 'AgentNotFoundError';
    this.agentId = agentId;
  }
}
