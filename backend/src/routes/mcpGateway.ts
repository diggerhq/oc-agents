/**
 * MCP Gateway API
 * 
 * Provides a simple REST interface for Claude Code in sandboxes to call MCP servers.
 * This solves the problem that Claude Code in non-interactive mode can't establish
 * MCP connections directly.
 * 
 * Security: URLs are HMAC-signed to prevent unauthorized access.
 * 
 * Claude can call this via curl/WebFetch:
 *   curl -X POST http://localhost:3000/api/mcp-gateway/call \
 *     -H "Content-Type: application/json" \
 *     -d '{"serverUrl": "https://mcp.api.coingecko.com/sse", "sig": "SIGNATURE", "method": "tools/list"}'
 */

import { Router, Request, Response } from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { verifyGatewaySignature } from '../services/oc.js';
import { logEvent } from '../services/analytics.js';
import { query } from '../db/index.js';

const router = Router();

// Lookup stored headers for an MCP server URL
async function getStoredHeaders(serverUrl: string): Promise<Record<string, string>> {
  // Find any agent configs that have this MCP server configured
  const configs = await query<{ mcp_servers: string }>(
    `SELECT mcp_servers FROM agent_configs WHERE mcp_servers IS NOT NULL`,
    []
  );
  
  for (const config of configs) {
    try {
      const servers = JSON.parse(config.mcp_servers || '[]');
      const match = servers.find((s: { url: string }) => s.url === serverUrl);
      if (match?.headers) {
        return match.headers;
      }
    } catch {
      // Ignore parse errors
    }
  }
  
  return {};
}

// Simple in-memory cache for tool lists (TTL: 5 minutes)
const toolListCache = new Map<string, { tools: any[]; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// Clean up old cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of toolListCache.entries()) {
    if (now - value.timestamp > CACHE_TTL_MS) {
      toolListCache.delete(key);
    }
  }
}, 60 * 1000);

/**
 * Detect transport type from URL
 */
function detectTransport(url: string): 'sse' | 'streamable-http' {
  // SSE endpoints typically end with /sse or contain /sse/
  if (url.includes('/sse')) {
    return 'sse';
  }
  return 'streamable-http';
}

/**
 * Connect to an MCP server and execute a method
 */
async function callMcpServer(
  serverUrl: string,
  method: string,
  params: Record<string, any> = {},
  headers: Record<string, string> = {},
  timeoutMs: number = 30000
): Promise<{ success: boolean; result?: any; error?: string }> {
  let client: Client | null = null;
  let transport: SSEClientTransport | StreamableHTTPClientTransport | null = null;

  try {
    const transportType = detectTransport(serverUrl);
    
    // Create transport
    if (transportType === 'sse') {
      transport = new SSEClientTransport(new URL(serverUrl), {
        requestInit: {
          headers: headers,
        },
      });
    } else {
      transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
        requestInit: {
          headers: headers,
        },
      });
    }

    // Create client
    client = new Client(
      { name: 'mcp-gateway', version: '1.0.0' },
      { capabilities: {} }
    );

    // Connect with timeout
    const connectPromise = client.connect(transport);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );
    
    await Promise.race([connectPromise, timeoutPromise]);

    // Execute the method
    let result: any;
    
    if (method === 'tools/list') {
      const response = await client.listTools();
      result = response.tools;
    } else if (method === 'tools/call') {
      const { name, arguments: args } = params;
      if (!name) {
        return { success: false, error: 'Tool name is required for tools/call' };
      }
      const response = await client.callTool({ name, arguments: args || {} });
      result = response;
    } else if (method === 'resources/list') {
      const response = await client.listResources();
      result = response.resources;
    } else if (method === 'resources/read') {
      const { uri } = params;
      if (!uri) {
        return { success: false, error: 'URI is required for resources/read' };
      }
      const response = await client.readResource({ uri });
      result = response;
    } else if (method === 'prompts/list') {
      const response = await client.listPrompts();
      result = response.prompts;
    } else {
      return { success: false, error: `Unknown method: ${method}` };
    }

    return { success: true, result };

  } catch (error) {
    console.error('[MCP Gateway] Error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  } finally {
    // Clean up connection
    if (client) {
      try {
        await client.close();
      } catch (e) {
        // Ignore close errors
      }
    }
  }
}

/**
 * Main gateway endpoint
 * 
 * POST /api/mcp-gateway/call
 * Body: {
 *   serverUrl: string,      // MCP server URL
 *   method: string,         // 'tools/list', 'tools/call', 'resources/list', etc.
 *   params?: object,        // Method-specific parameters
 *   headers?: object,       // Optional headers (e.g., API keys)
 *   useCache?: boolean      // Use cached tool list if available (default: true for tools/list)
 * }
 */
router.post('/call', async (req: Request, res: Response) => {
  const { serverUrl, sig, method, params = {}, headers = {}, useCache = true } = req.body;

  if (!serverUrl) {
    return res.status(400).json({ success: false, error: 'serverUrl is required' });
  }

  if (!sig) {
    return res.status(400).json({ success: false, error: 'sig is required' });
  }

  // Verify signature
  try {
    if (!verifyGatewaySignature(serverUrl, sig)) {
      console.warn(`[MCP Gateway] Invalid signature for serverUrl: ${serverUrl}`);
      return res.status(403).json({ success: false, error: 'Invalid signature' });
    }
  } catch (error) {
    return res.status(403).json({ success: false, error: 'Invalid signature' });
  }

  if (!method) {
    return res.status(400).json({ success: false, error: 'method is required' });
  }

  // Check cache for tools/list
  if (method === 'tools/list' && useCache) {
    const cacheKey = serverUrl;
    const cached = toolListCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.log(`[MCP Gateway] Cache hit for ${serverUrl}`);
      return res.json({ success: true, result: cached.tools, cached: true });
    }
  }

  console.log(`[MCP Gateway] Calling ${method} on ${serverUrl}`);
  
  // Merge stored headers with any passed headers (passed headers take precedence)
  const storedHeaders = await getStoredHeaders(serverUrl);
  const mergedHeaders = { ...storedHeaders, ...headers };
  
  const result = await callMcpServer(serverUrl, method, params, mergedHeaders);

  // Cache successful tools/list responses
  if (result.success && method === 'tools/list') {
    toolListCache.set(serverUrl, { tools: result.result, timestamp: Date.now() });
  }

  res.json(result);
});

/**
 * Simple endpoint to list available tools from an MCP server
 * 
 * GET /api/mcp-gateway/tools?serverUrl=...
 */
router.get('/tools', async (req: Request, res: Response) => {
  const serverUrl = req.query.serverUrl as string;
  const sig = req.query.sig as string;

  if (!serverUrl) {
    return res.status(400).json({ success: false, error: 'serverUrl query param is required' });
  }

  if (!sig) {
    return res.status(400).json({ success: false, error: 'sig query param is required' });
  }

  // Verify signature
  try {
    if (!verifyGatewaySignature(serverUrl, sig)) {
      console.warn(`[MCP Gateway] Invalid signature for serverUrl: ${serverUrl}`);
      return res.status(403).json({ success: false, error: 'Invalid signature' });
    }
  } catch (error) {
    return res.status(403).json({ success: false, error: 'Invalid signature' });
  }

  // Check cache first
  const cached = toolListCache.get(serverUrl);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.json({ success: true, tools: cached.tools, cached: true });
  }

  // Get stored headers for this server
  const storedHeaders = await getStoredHeaders(serverUrl);
  const result = await callMcpServer(serverUrl, 'tools/list', {}, storedHeaders);

  if (result.success) {
    toolListCache.set(serverUrl, { tools: result.result, timestamp: Date.now() });
    return res.json({ success: true, tools: result.result });
  }

  res.status(500).json(result);
});

/**
 * Endpoint to call a specific tool
 * 
 * POST /api/mcp-gateway/tools/call
 * Body: {
 *   serverUrl: string,
 *   toolName: string,
 *   arguments: object
 * }
 */
router.post('/tools/call', async (req: Request, res: Response) => {
  const { serverUrl, sig, toolName, arguments: toolArgs = {}, headers = {}, agentId } = req.body;

  if (!serverUrl) {
    return res.status(400).json({ success: false, error: 'serverUrl is required' });
  }

  if (!sig) {
    return res.status(400).json({ success: false, error: 'sig is required' });
  }

  // Verify signature
  try {
    if (!verifyGatewaySignature(serverUrl, sig)) {
      console.warn(`[MCP Gateway] Invalid signature for serverUrl: ${serverUrl}`);
      return res.status(403).json({ success: false, error: 'Invalid signature' });
    }
  } catch (error) {
    return res.status(403).json({ success: false, error: 'Invalid signature' });
  }

  if (!toolName) {
    return res.status(400).json({ success: false, error: 'toolName is required' });
  }

  console.log(`[MCP Gateway] Calling tool ${toolName} on ${serverUrl}`);
  
  // Emit MCP tool event for portal to track
  // Extract session ID from agentId if it's a portal session
  if (agentId && agentId.startsWith('portal-')) {
    const { terminalEvents } = await import('../services/oc.js');
    terminalEvents.emit(`terminal:${agentId}`, {
      type: 'mcp_tool_call',
      toolName,
      serverUrl,
      timestamp: Date.now(),
    });
  }

  // Merge stored headers with any passed headers (passed headers take precedence)
  const storedHeaders = await getStoredHeaders(serverUrl);
  const mergedHeaders = { ...storedHeaders, ...headers };

  const startTime = Date.now();
  const result = await callMcpServer(
    serverUrl, 
    'tools/call', 
    { name: toolName, arguments: toolArgs },
    mergedHeaders
  );
  const latencyMs = Date.now() - startTime;
  
  // Emit completion event
  if (agentId && agentId.startsWith('portal-')) {
    const { terminalEvents } = await import('../services/oc.js');
    terminalEvents.emit(`terminal:${agentId}`, {
      type: 'mcp_tool_complete',
      toolName,
      serverUrl,
      duration: latencyMs,
      success: result.success,
      timestamp: Date.now(),
    });
  }

  // Log analytics if agentId provided
  if (agentId) {
    logEvent({
      agentId,
      eventType: 'tool_call',
      source: 'chat', // Could be passed as param if needed
      latencyMs,
      success: result.success,
      metadata: { toolName, serverUrl: serverUrl.substring(0, 50) },
      errorMessage: result.success ? undefined : result.error,
    });
  }

  res.json(result);
});

export default router;
