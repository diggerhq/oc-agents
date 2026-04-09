/**
 * Agents resource for OpenComputer Agents SDK
 */

import type { Agent, TaskResult, RunOptions, SubmitOptions, ServerMessage, SdkSession } from './types.js';
import type { WebSocketClient } from './websocket.js';
import { TaskHandle } from './task.js';
import { OCError } from './errors.js';

export class AgentsResource {
  private wsClient: WebSocketClient;
  private baseUrl: string;
  private apiKey: string;
  private defaultTimeout: number;

  constructor(wsClient: WebSocketClient, baseUrl: string, apiKey: string, defaultTimeout: number) {
    this.wsClient = wsClient;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.defaultTimeout = defaultTimeout;
  }

  /**
   * Create a new SDK session for isolated sandbox access.
   * This allows multiple isolated sandboxes for the same agent.
   * 
   * @param agentId - The agent to create a session for
   * @returns Session info including the sessionId to use in run/submit calls
   */
  async new(agentId: string): Promise<SdkSession> {
    const response = await fetch(`${this.baseUrl}/api/v1/agents/${agentId}/sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText })) as any;
      throw new OCError(error.error || 'Failed to create session', 'CREATE_SESSION_FAILED');
    }

    const data = await response.json() as any;
    return {
      id: data.sessionId,
      agentId,
      sandboxId: data.sandboxId,
      status: 'active',
      createdAt: data.createdAt,
      lastUsedAt: data.lastUsedAt || data.createdAt,
    };
  }

  /**
   * Close an SDK session and cleanup its sandbox.
   * 
   * @param agentId - The agent the session belongs to
   * @param sessionId - The session ID to close
   */
  async close(agentId: string, sessionId: string): Promise<{ success: boolean; error?: string }> {
    const response = await fetch(`${this.baseUrl}/api/v1/agents/${agentId}/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText })) as any;
      return {
        success: false,
        error: error.error || `HTTP ${response.status}: ${response.statusText}`
      };
    }

    return { success: true };
  }

  /**
   * List all agents accessible via API
   */
  async list(): Promise<Agent[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/agents`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText })) as any;
      throw new OCError(error.error || 'Failed to list agents', 'LIST_AGENTS_FAILED');
    }

    const data = await response.json() as any;
    return data.agents.map((agent: any) => ({
      id: agent.id,
      name: agent.name,
      type: agent.agent_type,
      provider: agent.provider,
      model: agent.model,
      outputSchema: agent.output_schema ? JSON.parse(agent.output_schema) : undefined,
      apiEnabled: agent.api_enabled,
      createdAt: agent.created_at,
    }));
  }

  /**
   * Get a specific agent
   */
  async get(agentId: string): Promise<Agent> {
    const response = await fetch(`${this.baseUrl}/api/v1/agents/${agentId}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText })) as any;
      throw new OCError(error.error || 'Failed to get agent', 'GET_AGENT_FAILED');
    }

    const agent = await response.json() as any;
    return {
      id: agent.id,
      name: agent.name,
      type: agent.agent_type,
      provider: agent.provider,
      model: agent.model,
      outputSchema: agent.output_schema ? JSON.parse(agent.output_schema) : undefined,
      apiEnabled: agent.api_enabled,
      createdAt: agent.created_at,
    };
  }

  /**
   * Submit a task and return a handle (non-blocking)
   * 
   * @param agentId - The agent to run the task on
   * @param options - Task options including prompt, timeout, sessionId, and provision
   * @returns TaskHandle for monitoring and getting results
   */
  async submit<T = any>(agentId: string, options: SubmitOptions): Promise<TaskHandle<T>> {
    return new Promise<TaskHandle<T>>((resolve, reject) => {
      const timeout = options.timeout ?? this.defaultTimeout;

      // Listen for task_created event
      const onMessage = (message: ServerMessage) => {
        if (message.type === 'task_created' && message.agentId === agentId) {
          this.wsClient.off('message', onMessage);
          this.wsClient.off('server_error', onError);
          
          const handle = new TaskHandle<T>(
            message.taskId,
            agentId,
            this.wsClient,
            timeout,
            message.sdkSessionId  // Pass sessionId to handle if created
          );
          resolve(handle);
        }
      };

      const onError = (message: { message: string }) => {
        this.wsClient.off('message', onMessage);
        this.wsClient.off('server_error', onError);
        reject(new OCError(message.message, 'SUBMIT_FAILED'));
      };

      this.wsClient.on('message', onMessage);
      this.wsClient.on('server_error', onError);

      // Submit the task with optional session options
      this.wsClient.submit(agentId, options.prompt, options.priority, options.sessionId, options.provision);
    });
  }

  /**
   * Run a task and wait for completion (blocking)
   * 
   * @param agentId - The agent to run the task on
   * @param options - Task options including prompt, timeout, and sessionId
   * @returns Task result with output
   */
  async run<T = any>(agentId: string, options: RunOptions): Promise<TaskResult<T>> {
    const handle = await this.submit<T>(agentId, options);
    return handle.result();
  }

  /**
   * Warm up sandbox for an agent (improves first-request performance)
   * 
   * @returns Object with:
   *   - success: boolean
   *   - sandboxId: ID of the sandbox
   *   - status: 'created' (new sandbox) | 'extended' (existing sandbox, lifetime extended)
   *   - error: error message if failed
   */
  async warmup(agentId: string): Promise<{ 
    success: boolean; 
    sandboxId?: string; 
    status?: 'created' | 'extended';
    error?: string;
  }> {
    const response = await fetch(`${this.baseUrl}/api/agent/agents/${agentId}/warmup`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText })) as any;
      return {
        success: false,
        error: error.error || `HTTP ${response.status}: ${response.statusText}`
      };
    }

    const result = await response.json() as any;
    return {
      success: result.success,
      sandboxId: result.sandboxId,
      status: result.status,
      error: result.error
    };
  }

  /**
   * Warm up sandboxes for multiple agents in parallel
   */
  async warmupMultiple(agentIds: string[]): Promise<{
    success: boolean;
    results: Array<{ agentId: string; success: boolean; sandboxId?: string; error?: string }>;
  }> {
    const response = await fetch(`${this.baseUrl}/api/agent/agents/warmup`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agentIds }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText })) as any;
      throw new OCError(error.error || 'Failed to warm up agents', 'WARMUP_FAILED');
    }

    const result = await response.json() as any;
    return {
      success: result.success,
      results: result.results
    };
  }
}
