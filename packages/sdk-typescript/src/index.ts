/**
 * OpenComputer Agents SDK for TypeScript
 * 
 * @example
 * ```typescript
 * import { OCAgents } from '@opencomputer/agents-sdk';
 * 
 * const client = new OCAgents({ apiKey: 'flt_xxx' });
 * await client.connect();
 * 
 * // Simple: run and wait for result
 * const result = await client.agents.run('agent-id', { prompt: 'Analyze this data' });
 * console.log(result.output);
 * 
 * // Advanced: stream events and control task
 * const task = await client.agents.submit('agent-id', { prompt: 'Long running task' });
 * task.on('stdout', (data) => console.log(data));
 * task.on('tool_start', (tool) => console.log(`Using ${tool}...`));
 * 
 * // Cancel if needed
 * setTimeout(() => task.cancel(), 60000);
 * 
 * // Wait for final result
 * const result = await task.result();
 * ```
 */

// Main client
export { OCAgents } from './client.js';

// Task handle
export { TaskHandle } from './task.js';

// Types
export type {
  OCAgentsConfig,
  Agent,
  AgentType,
  AgentProvider,
  TaskResult,
  TaskStatus,
  RunOptions,
  SubmitOptions,
  ServerMessage,
  ClientMessage,
  TaskEventType,
  TaskEventHandlers,
} from './types.js';

// Errors
export {
  OCError,
  TaskCancelledError,
  TaskFailedError,
  TaskTimeoutError,
  ConnectionError,
  AuthenticationError,
  AgentNotFoundError,
} from './errors.js';
