/**
 * MCP (Model Context Protocol) Service
 * 
 * Manages connections to MCP servers and provides tool discovery/execution.
 * Supports both builtin skills and custom user-provided MCP servers.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { v4 as uuidv4 } from 'uuid';
import { execute, queryOne } from '../db/index.js';
import { BUILTIN_SKILLS, resolveSkillSecrets } from '../config/skills.js';

// MCP Server configuration types
export interface MCPServerConfigBuiltin {
  id: string;
  type: 'builtin';
  skillId: string;
}

// NOTE: STDIO transport is disabled for custom servers in multi-tenant environments
// Users should host their own MCP servers and connect via SSE or Streamable HTTP

export interface MCPServerConfigCustomSSE {
  id: string;
  type: 'custom';
  name: string;
  transport: 'sse';
  url: string;
  headers?: Record<string, string>;
}

export interface MCPServerConfigCustomStreamableHTTP {
  id: string;
  type: 'custom';
  name: string;
  transport: 'streamable-http';
  url: string;
  headers?: Record<string, string>;
  sessionId?: string; // Optional session ID for stateful connections
}

// Custom servers only support remote transports (SSE, Streamable HTTP)
// STDIO is reserved for builtin skills only
export type MCPServerConfigCustom = MCPServerConfigCustomSSE | MCPServerConfigCustomStreamableHTTP;
export type MCPServerConfig = MCPServerConfigBuiltin | MCPServerConfigCustom;

// Tool definition compatible with Anthropic
export interface MCPTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Connection tracking
interface MCPConnectionInternal {
  client: Client;
  transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;
  tools: MCPTool[];
  serverName: string;
  connectedAt: Date;
}

class MCPService {
  // Map of "agentId:serverId" -> connection
  private connections: Map<string, MCPConnectionInternal> = new Map();

  /**
   * Connect to an MCP server for a specific agent
   */
  async connect(
    agentId: string,
    config: MCPServerConfig,
    secrets: Record<string, string>
  ): Promise<{ success: boolean; tools: MCPTool[]; error?: string }> {
    const connectionKey = `${agentId}:${config.id}`;

    // Return existing connection if available
    if (this.connections.has(connectionKey)) {
      const conn = this.connections.get(connectionKey)!;
      return { success: true, tools: conn.tools };
    }

    try {
      let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;
      let serverName: string;

      if (config.type === 'builtin') {
        // Load builtin skill config
        const skill = BUILTIN_SKILLS[config.skillId];
        if (!skill) {
          return { success: false, tools: [], error: `Unknown skill: ${config.skillId}` };
        }

        const resolvedMcp = resolveSkillSecrets(config.skillId, secrets);
        if (!resolvedMcp) {
          return { success: false, tools: [], error: `Failed to resolve skill config: ${config.skillId}` };
        }

        serverName = skill.name;
        console.log(`[MCP] Starting builtin skill: ${serverName}`);
        console.log(`[MCP]   Command: ${resolvedMcp.command}`);
        console.log(`[MCP]   Args: ${resolvedMcp.args.join(' ')}`);
        
        transport = new StdioClientTransport({
          command: resolvedMcp.command,
          args: resolvedMcp.args,
          env: { ...process.env, ...resolvedMcp.env } as Record<string, string>,
          stderr: 'pipe', // Capture stderr for debugging
        });

      } else if (config.transport === 'sse') {
        // Custom SSE server (legacy - deprecated in spec)
        serverName = config.name;
        const resolvedHeaders = this.resolveSecrets(config.headers || {}, secrets);
        console.log(`[MCP] Connecting to SSE server (legacy): ${serverName} at ${config.url}`);
        
        transport = new SSEClientTransport(new URL(config.url), {
          requestInit: {
            headers: resolvedHeaders,
          },
        });

      } else if (config.transport === 'streamable-http') {
        // Streamable HTTP - the modern transport (recommended)
        serverName = config.name;
        const resolvedHeaders = this.resolveSecrets(config.headers || {}, secrets);
        console.log(`[MCP] Connecting to Streamable HTTP server: ${serverName} at ${config.url}`);
        console.log(`[MCP] Headers being sent:`, Object.keys(resolvedHeaders).map(k => `${k}: ${k.toLowerCase().includes('auth') ? '***' : resolvedHeaders[k]}`));
        
        const requestInit: RequestInit = {
          headers: resolvedHeaders,
        };
        
        transport = new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit,
          // Session ID for stateful connections (optional)
          sessionId: config.sessionId,
        });

      } else {
        // STDIO transport is disabled for custom servers
        const transportType = (config as any).transport || 'unknown';
        console.error(`[MCP] STDIO transport not allowed for custom servers: ${(config as any).name || config.id}`);
        return { 
          success: false, 
          tools: [], 
          error: `STDIO transport is not supported for custom MCP servers. Please host your MCP server and use SSE or Streamable HTTP transport. Received transport: ${transportType}` 
        };
      }

      // Create MCP client and connect
      const client = new Client(
        { name: 'prime-agent', version: '1.0.0' },
        { capabilities: {} }
      );

      // Set up stderr handler for debugging before connecting
      if ('stderr' in transport && transport.stderr) {
        const stderrStream = transport.stderr;
        stderrStream.on('data', (data: Buffer) => {
          console.log(`[MCP] ${serverName} stderr:`, data.toString().trim());
        });
      }

      console.log(`[MCP] Connecting to ${serverName}...`);
      await client.connect(transport);
      console.log(`[MCP] Connected to ${serverName}, discovering tools...`);

      // Discover tools
      const { tools: mcpTools } = await client.listTools();
      console.log(`[MCP] ${serverName} provides ${mcpTools.length} tools: ${mcpTools.map(t => t.name).join(', ')}`);

      // Convert to Anthropic-compatible format with namespacing
      const tools: MCPTool[] = mcpTools.map(tool => ({
        name: `mcp_${config.id}_${tool.name}`,
        description: `[${serverName}] ${tool.description || ''}`,
        input_schema: tool.inputSchema as MCPTool['input_schema'],
      }));

      // Store connection
      this.connections.set(connectionKey, {
        client,
        transport,
        tools,
        serverName,
        connectedAt: new Date(),
      });

      // Update database with connection status
      await this.updateConnectionStatus(agentId, config.id, serverName, 'connected', tools);

      console.log(`[MCP] Connected to ${serverName} for agent ${agentId}, discovered ${tools.length} tools`);

      return { success: true, tools };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[MCP] Failed to connect to server ${config.id}:`, errorMsg);
      
      await this.updateConnectionStatus(
        agentId, 
        config.id, 
        config.type === 'builtin' ? BUILTIN_SKILLS[config.skillId]?.name || config.id : config.name,
        'error',
        [],
        errorMsg
      );

      return { success: false, tools: [], error: errorMsg };
    }
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnect(agentId: string, serverId: string): Promise<void> {
    const connectionKey = `${agentId}:${serverId}`;
    const conn = this.connections.get(connectionKey);

    if (conn) {
      try {
        await conn.client.close();
      } catch (error) {
        console.error(`[MCP] Error disconnecting from ${serverId}:`, error);
      }
      this.connections.delete(connectionKey);
      await this.updateConnectionStatus(agentId, serverId, conn.serverName, 'disconnected');
    }
  }

  /**
   * Disconnect all servers for an agent
   */
  async disconnectAll(agentId: string): Promise<void> {
    const prefix = `${agentId}:`;
    const keysToRemove: string[] = [];

    for (const [key, conn] of this.connections) {
      if (key.startsWith(prefix)) {
        try {
          await conn.client.close();
        } catch (error) {
          console.error(`[MCP] Error disconnecting:`, error);
        }
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach(key => this.connections.delete(key));
  }

  /**
   * Get all tools from connected MCP servers for an agent
   */
  getTools(agentId: string): MCPTool[] {
    const prefix = `${agentId}:`;
    const tools: MCPTool[] = [];

    for (const [key, conn] of this.connections) {
      if (key.startsWith(prefix)) {
        tools.push(...conn.tools);
      }
    }

    return tools;
  }

  /**
   * Execute a tool call on an MCP server
   */
  async callTool(
    agentId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    // Parse namespaced tool name: mcp_<serverId>_<toolName>
    const match = toolName.match(/^mcp_([^_]+)_(.+)$/);
    if (!match) {
      return JSON.stringify({ error: `Invalid MCP tool name format: ${toolName}` });
    }

    const [, serverId, actualToolName] = match;
    const connectionKey = `${agentId}:${serverId}`;
    const conn = this.connections.get(connectionKey);

    if (!conn) {
      return JSON.stringify({ error: `MCP server not connected: ${serverId}` });
    }

    try {
      console.log(`[MCP] Calling tool ${actualToolName} on ${conn.serverName}`);
      
      const result = await conn.client.callTool({
        name: actualToolName,
        arguments: args,
      });

      // Update last used timestamp
      await execute(
        'UPDATE mcp_connections SET last_used_at = NOW() WHERE session_id = $1 AND server_id = $2',
        [agentId, serverId]
      );

      // Format result
      if (result.content && Array.isArray(result.content)) {
        const textContent = result.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map(c => c.text)
          .join('\n');
        
        if (textContent) {
          return textContent;
        }
      }

      return JSON.stringify(result.content);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[MCP] Tool call failed:`, errorMsg);
      return JSON.stringify({ error: `Tool execution failed: ${errorMsg}` });
    }
  }

  /**
   * Check if a tool name belongs to an MCP server
   */
  isMCPTool(toolName: string): boolean {
    return toolName.startsWith('mcp_');
  }

  /**
   * Connect to all configured MCP servers for an agent
   */
  async connectAllServers(
    agentId: string,
    mcpServers: MCPServerConfig[],
    skills: string[],
    secrets: Record<string, string>
  ): Promise<{ connectedCount: number; failedCount: number; tools: MCPTool[] }> {
    const allTools: MCPTool[] = [];
    let connectedCount = 0;
    let failedCount = 0;

    // Connect builtin skills
    for (const skillId of skills) {
      const result = await this.connect(
        agentId,
        { id: skillId, type: 'builtin', skillId },
        secrets
      );

      if (result.success) {
        connectedCount++;
        allTools.push(...result.tools);
      } else {
        failedCount++;
      }
    }

    // Connect custom MCP servers
    for (const server of mcpServers) {
      const result = await this.connect(agentId, server, secrets);

      if (result.success) {
        connectedCount++;
        allTools.push(...result.tools);
      } else {
        failedCount++;
      }
    }

    return { connectedCount, failedCount, tools: allTools };
  }

  /**
   * Resolve secret placeholders in a config object
   */
  private resolveSecrets(
    obj: Record<string, string>,
    secrets: Record<string, string>
  ): Record<string, string> {
    const result: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.resolveSecretString(value, secrets);
    }
    
    return result;
  }

  /**
   * Resolve secret placeholders in a single string
   */
  private resolveSecretString(
    value: string,
    secrets: Record<string, string>
  ): string {
    return value.replace(
      /\{\{secrets\.(\w+)\}\}/g,
      (_, secretKey) => secrets[secretKey] || ''
    );
  }

  /**
   * Update MCP connection status in database
   */
  private async updateConnectionStatus(
    agentId: string,
    serverId: string,
    serverName: string,
    status: 'connecting' | 'connected' | 'disconnected' | 'error',
    tools: MCPTool[] = [],
    error?: string
  ): Promise<void> {
    try {
      const existing = await queryOne<{ id: string }>(
        'SELECT id FROM mcp_connections WHERE session_id = $1 AND server_id = $2',
        [agentId, serverId]
      );

      if (existing) {
        await execute(
          `UPDATE mcp_connections 
           SET status = $1, tools_discovered = $2, error = $3, connected_at = CASE WHEN $4 = 'connected' THEN NOW() ELSE connected_at END
           WHERE id = $5`,
          [status, JSON.stringify(tools.map(t => t.name)), error || null, status, existing.id]
        );
      } else {
        const id = uuidv4();
        await execute(
          `INSERT INTO mcp_connections (id, session_id, server_id, server_name, status, tools_discovered, error, connected_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8 = 'connected' THEN NOW() ELSE NULL END)`,
          [id, agentId, serverId, serverName, status, JSON.stringify(tools.map(t => t.name)), error || null, status]
        );
      }
    } catch (dbError) {
      console.error('[MCP] Failed to update connection status:', dbError);
    }
  }
}

// Export singleton instance
export const mcpService = new MCPService();
