/**
 * OpenComputer Agents SDK Client
 */

import type { OCAgentsConfig } from './types.js';
import { WebSocketClient } from './websocket.js';
import { AgentsResource } from './agents.js';
import { OCError } from './errors.js';

const DEFAULT_BASE_URL = 'https://api.opencomputer.dev';
const DEFAULT_TIMEOUT = 600; // 10 minutes in seconds

export class OCAgents {
  private config: Required<OCAgentsConfig>;
  private wsClient: WebSocketClient;
  private _agents: AgentsResource | null = null;
  private connected: boolean = false;

  /**
   * Create a new OpenComputer Agents client
   * 
   * @example
   * ```typescript
   * const client = new OCAgents({ apiKey: 'flt_xxx' });
   * await client.connect();
   * const result = await client.agents.run('agent-id', { prompt: 'Hello' });
   * ```
   */
  constructor(config: OCAgentsConfig) {
    if (!config.apiKey) {
      throw new OCError('API key is required', 'MISSING_API_KEY');
    }

    if (!config.apiKey.startsWith('flt_')) {
      throw new OCError('Invalid API key format. API keys must start with "flt_"', 'INVALID_API_KEY');
    }

    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
      timeout: config.timeout || DEFAULT_TIMEOUT,
    };

    this.wsClient = new WebSocketClient({
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
    });
  }

  /**
   * Connect to the OpenComputer Agents service
   * Must be called before using the SDK
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    await this.wsClient.connect();
    this.connected = true;

    // Initialize agents resource
    this._agents = new AgentsResource(
      this.wsClient,
      this.config.baseUrl,
      this.config.apiKey,
      this.config.timeout
    );
  }

  /**
   * Disconnect from the OpenComputer Agents service
   */
  disconnect(): void {
    this.wsClient.disconnect();
    this.connected = false;
    this._agents = null;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected && this.wsClient.isConnected();
  }

  /**
   * Access agents resource
   * 
   * @example
   * ```typescript
   * // List all agents
   * const agents = await client.agents.list();
   * 
   * // Run a task (blocking)
   * const result = await client.agents.run('agent-id', { prompt: 'Hello' });
   * 
   * // Submit a task (non-blocking)
   * const task = await client.agents.submit('agent-id', { prompt: 'Hello' });
   * task.on('stdout', console.log);
   * await task.result();
   * ```
   */
  get agents(): AgentsResource {
    if (!this._agents) {
      throw new OCError('Not connected. Call connect() first.', 'NOT_CONNECTED');
    }
    return this._agents;
  }
}
