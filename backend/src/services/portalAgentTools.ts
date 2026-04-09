/**
 * Portal Agent Tool Definitions & Server-Side Executors
 * 
 * These tools are used by the portal agent (direct Anthropic API mode)
 * and executed server-side in the Node.js process — not in a sandbox.
 */

import Anthropic from '@anthropic-ai/sdk';
import { searchDocuments, isQdrantConfigured } from './qdrant.js';
import { downloadFromR2, uploadToR2, streamDownloadFromR2 } from './storage.js';
import { query, queryOne } from '../db/index.js';

// ==========================================
// Tool Definitions (Anthropic format)
// ==========================================

export const PORTAL_AGENT_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'search_knowledge_base',
    description: 'Search the attached knowledge bases for relevant information. Use this to find answers from indexed documents, files, and data sources.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'The search query to find relevant information',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file from the attached file buckets. Supports text files, markdown, JSON, CSV, and other text formats.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'The file path relative to the bucket root (e.g., "reports/data.csv")',
        },
        bucket_name: {
          type: 'string',
          description: 'The name of the bucket to read from. If not specified, reads from the first attached bucket.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file in the output bucket. Creates the file if it does not exist, or overwrites it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'The file path relative to the bucket root (e.g., "output/report.md")',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
        bucket_name: {
          type: 'string',
          description: 'The name of the bucket to write to. If not specified, writes to the first attached bucket.',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and folders in the attached file buckets.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'The directory path to list (default: root "/")',
        },
        bucket_name: {
          type: 'string',
          description: 'The name of the bucket to list. If not specified, lists from the first attached bucket.',
        },
      },
      required: [],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for up-to-date information. Use this for current events, documentation, or information not in the knowledge base.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
      },
      required: ['query'],
    },
  },
];

// Optional sandbox tool — only included when sandbox is enabled
export const SANDBOX_TOOL: Anthropic.Messages.Tool = {
  name: 'run_code',
  description: 'Execute code in a sandboxed environment. Supports Python, JavaScript/Node.js, and shell commands. Use this for data analysis, calculations, or any code execution.',
  input_schema: {
    type: 'object' as const,
    properties: {
      code: {
        type: 'string',
        description: 'The code to execute',
      },
      language: {
        type: 'string',
        enum: ['python', 'javascript', 'shell'],
        description: 'The programming language (default: python)',
      },
    },
    required: ['code'],
  },
};

// ==========================================
// Tool Context — passed to executors
// ==========================================

export interface ToolContext {
  agentId: string;
  userId: string;
  organizationId?: string | null;
  // Portal user identifier for user-scoped file storage
  portalUserId?: string | null;
  // Resolved bucket info for file operations
  buckets: Array<{
    id: string;
    name: string;
    userId: string;
    readOnly: boolean;
  }>;
  // Knowledge base collection names
  knowledgeBases: Array<{
    id: string;
    name: string;
    collectionName: string;
  }>;
  // MCP server configs
  mcpServers?: Array<{
    id: string;
    name: string;
    url: string;
    transport: string;
    headers?: Record<string, string>;
  }>;
  // SSE emitter for real-time events (e.g., file_created)
  sseEmit?: (event: { type: string; [key: string]: any }) => void;
}

// ==========================================
// Tool Executors
// ==========================================

export type ToolExecutor = (
  input: Record<string, unknown>,
  context: ToolContext
) => Promise<string>;

/**
 * Search attached knowledge bases
 */
async function executeSearchKnowledgeBase(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const searchQuery = input.query as string;
  const limit = (input.limit as number) || 5;

  if (!isQdrantConfigured()) {
    return 'Knowledge base search is not configured. No vector database connection available.';
  }

  if (context.knowledgeBases.length === 0) {
    return 'No knowledge bases are attached to this agent.';
  }

  const allResults: Array<{ source: string; content: string; score: number }> = [];

  for (const kb of context.knowledgeBases) {
    try {
      const results = await searchDocuments(kb.collectionName, searchQuery, limit);
      for (const r of results) {
        allResults.push({
          source: `[${kb.name}] ${(r.payload as any)?.file_name || 'unknown'}`,
          content: (r.payload as any)?.text || '',
          score: r.score,
        });
      }
    } catch (err) {
      console.error(`[PortalAgent] KB search error for ${kb.name}:`, err);
    }
  }

  // Sort by score descending
  allResults.sort((a, b) => b.score - a.score);
  const topResults = allResults.slice(0, limit);

  if (topResults.length === 0) {
    return `No relevant results found for: "${searchQuery}"`;
  }

  return topResults
    .map((r, i) => `### Result ${i + 1} (score: ${r.score.toFixed(3)})\n**Source:** ${r.source}\n\n${r.content}`)
    .join('\n\n---\n\n');
}

/**
 * Read a file from an attached bucket
 */
async function executeReadFile(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const filePath = input.path as string;
  const bucketName = input.bucket_name as string | undefined;

  const bucket = bucketName
    ? context.buckets.find(b => b.name === bucketName)
    : context.buckets[0];

  if (!bucket) {
    return bucketName
      ? `Bucket "${bucketName}" not found. Available buckets: ${context.buckets.map(b => b.name).join(', ')}`
      : 'No file buckets are attached to this agent.';
  }

  try {
    // Look up the file record in the database
    // Filter by portal_visitor_id: NULL (shared) or matching visitor ID
    const normalizedPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
    
    const visitorFilter = context.portalUserId
      ? 'AND (portal_visitor_id IS NULL OR portal_visitor_id = $3)'
      : 'AND portal_visitor_id IS NULL';
    
    const file = await queryOne<{ id: string; storage_key: string; mime_type: string; size: number }>(
      `SELECT id, storage_key, mime_type, size FROM files 
       WHERE bucket_id = $1 AND path = $2 AND (is_folder = false OR is_folder = 0) ${visitorFilter}`,
      context.portalUserId ? [bucket.id, normalizedPath, context.portalUserId] : [bucket.id, normalizedPath]
    );

    if (!file) {
      return `File not found: ${filePath} in bucket "${bucket.name}"`;
    }

    if (!file.storage_key) {
      return `File "${filePath}" has no stored content.`;
    }

    // Size guard: don't read very large files
    if (file.size > 5 * 1024 * 1024) {
      return `File "${filePath}" is too large to read (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.`;
    }

    const data = await downloadFromR2(file.storage_key, bucket.userId);
    if (!data.success || !data.content) {
      return `Error reading file "${filePath}": ${data.error || 'Download failed'}`;
    }
    return data.content.toString('utf-8');
  } catch (err: any) {
    return `Error reading file "${filePath}": ${err.message}`;
  }
}

/**
 * Write a file to an attached bucket
 */
async function executeWriteFile(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const filePath = input.path as string;
  const content = input.content as string;
  const bucketName = input.bucket_name as string | undefined;

  // Find the target bucket - prioritize writable buckets (output buckets)
  const bucket = bucketName
    ? context.buckets.find(b => b.name === bucketName && !b.readOnly)
    : context.buckets.find(b => !b.readOnly) || context.buckets[0];

  if (!bucket) {
    const writableBuckets = context.buckets.filter(b => !b.readOnly);
    if (writableBuckets.length === 0) {
      return 'No writable buckets are attached to this agent. Files cannot be created.';
    }
    return bucketName
      ? `Bucket "${bucketName}" not found or is read-only. Available writable buckets: ${writableBuckets.map(b => b.name).join(', ')}`
      : 'No writable buckets available.';
  }

  if (bucket.readOnly) {
    return `Cannot write to bucket "${bucket.name}" - it is read-only. This bucket is for input files only.`;
  }

  try {
    const normalizedPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
    const fileName = filePath.split('/').pop() || 'file';
    const buffer = Buffer.from(content, 'utf-8');

    // Determine mime type from extension
    const ext = fileName.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      md: 'text/markdown', txt: 'text/plain', json: 'application/json',
      csv: 'text/csv', html: 'text/html', xml: 'text/xml',
      py: 'text/x-python', js: 'text/javascript', ts: 'text/typescript',
      yaml: 'text/yaml', yml: 'text/yaml',
    };
    const mimeType = mimeTypes[ext || ''] || 'text/plain';

    // Generate storage key
    const storageKey = `${bucket.userId}/${bucket.id}${normalizedPath}`;

    // Upload to storage
    await uploadToR2(storageKey, buffer, mimeType, bucket.userId);

    // Upsert file record in database
    const { v4: uuidv4 } = await import('uuid');
    const existingFile = await queryOne<{ id: string }>(
      'SELECT id FROM files WHERE bucket_id = $1 AND path = $2',
      [bucket.id, normalizedPath]
    );

    let fileId: string;
    if (existingFile) {
      const { execute } = await import('../db/index.js');
      await execute(
        `UPDATE files SET storage_key = $1, size = $2, mime_type = $3, portal_visitor_id = $4, updated_at = NOW() WHERE id = $5`,
        [storageKey, buffer.length, mimeType, context.portalUserId || null, existingFile.id]
      );
      fileId = existingFile.id;
    } else {
      const { execute } = await import('../db/index.js');
      fileId = uuidv4();
      // Determine parent folder path
      const parentPath = normalizedPath.split('/').slice(0, -1).join('/') || '/';
      const parentFolder = await queryOne<{ id: string }>(
        'SELECT id FROM files WHERE bucket_id = $1 AND path = $2 AND is_folder = true',
        [bucket.id, parentPath]
      );

      await execute(
        `INSERT INTO files (id, bucket_id, user_id, name, path, parent_id, is_folder, mime_type, size, storage_key, portal_visitor_id)
         VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8, $9, $10)`,
        [fileId, bucket.id, bucket.userId, fileName, normalizedPath, parentFolder?.id || null, mimeType, buffer.length, storageKey, context.portalUserId || null]
      );
    }

    // Emit file_created SSE event with human-readable display name
    if (context.sseEmit) {
      // Create a human-readable display name from the file name
      const displayName = fileName
        .replace(/[-_]/g, ' ')  // Replace hyphens and underscores with spaces
        .replace(/\.\w+$/, '')   // Remove file extension
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))  // Capitalize each word
        .join(' ');
      
      context.sseEmit({
        type: 'file_created',
        fileId,
        fileName,
        displayName,
        path: normalizedPath,
        mimeType,
        size: buffer.length,
        bucketId: bucket.id,
        bucketName: bucket.name,
      });
    }

    return `Successfully wrote ${buffer.length} bytes to "${filePath}" in bucket "${bucket.name}"`;
  } catch (err: any) {
    return `Error writing file "${filePath}": ${err.message}`;
  }
}

/**
 * List files in an attached bucket
 */
async function executeListFiles(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const dirPath = (input.path as string) || '/';
  const bucketName = input.bucket_name as string | undefined;

  const bucket = bucketName
    ? context.buckets.find(b => b.name === bucketName)
    : context.buckets[0];

  if (!bucket) {
    return bucketName
      ? `Bucket "${bucketName}" not found. Available buckets: ${context.buckets.map(b => `${b.name} (${b.readOnly ? 'read-only' : 'writable'})`).join(', ')}`
      : 'No file buckets are attached to this agent.';
  }

  try {
    const normalizedPath = dirPath.startsWith('/') ? dirPath : `/${dirPath}`;
    
    // Find the parent folder
    let parentId: string | null = null;
    if (normalizedPath !== '/') {
      const folder = await queryOne<{ id: string }>(
        'SELECT id FROM files WHERE bucket_id = $1 AND path = $2 AND is_folder = true',
        [bucket.id, normalizedPath]
      );
      if (!folder) {
        return `Directory not found: ${dirPath}`;
      }
      parentId = folder.id;
    }

    // List files in the directory, filtered by portal_visitor_id
    // Files with NULL portal_visitor_id are visible to all (shared/default files)
    // Files with matching portal_visitor_id are visible to that visitor only
    const visitorFilter = context.portalUserId 
      ? 'AND (portal_visitor_id IS NULL OR portal_visitor_id = $3)'
      : 'AND portal_visitor_id IS NULL';
    
    const files = await query<{ name: string; is_folder: boolean | number; size: number; mime_type: string; updated_at: string }>(
      parentId
        ? `SELECT name, is_folder, size, mime_type, updated_at FROM files WHERE bucket_id = $1 AND parent_id = $2 ${visitorFilter} ORDER BY is_folder DESC, name ASC`
        : `SELECT name, is_folder, size, mime_type, updated_at FROM files WHERE bucket_id = $1 AND parent_id IS NULL ${visitorFilter} ORDER BY is_folder DESC, name ASC`,
      parentId 
        ? (context.portalUserId ? [bucket.id, parentId, context.portalUserId] : [bucket.id, parentId])
        : (context.portalUserId ? [bucket.id, context.portalUserId] : [bucket.id])
    );

    if (files.length === 0) {
      return `Directory "${dirPath}" is empty in bucket "${bucket.name}"`;
    }

    const lines = files.map(f => {
      const isDir = f.is_folder === true || f.is_folder === 1;
      const sizeStr = isDir ? '-' : formatSize(f.size);
      const icon = isDir ? '📁' : '📄';
      return `${icon} ${f.name}${isDir ? '/' : ''}  (${sizeStr})`;
    });

    const bucketInfo = bucket.readOnly ? ' (read-only - input bucket)' : ' (writable - output bucket)';
    return `Files in "${dirPath}" (bucket: ${bucket.name}${bucketInfo}):\n\n${lines.join('\n')}`;
  } catch (err: any) {
    return `Error listing files: ${err.message}`;
  }
}

/**
 * Web search (basic implementation using fetch)
 */
async function executeWebSearch(
  input: Record<string, unknown>,
  _context: ToolContext
): Promise<string> {
  const searchQuery = input.query as string;

  // Try using Brave Search API if configured
  const braveApiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (braveApiKey) {
    try {
      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(searchQuery)}&count=5`,
        {
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': braveApiKey,
          },
        }
      );

      if (response.ok) {
        const data = await response.json() as any;
        const results = (data.web?.results || []).slice(0, 5);
        if (results.length > 0) {
          return results
            .map((r: any, i: number) => `### ${i + 1}. ${r.title}\n**URL:** ${r.url}\n${r.description || ''}`)
            .join('\n\n');
        }
      }
    } catch (err) {
      console.error('[PortalAgent] Brave search error:', err);
    }
  }

  // Fallback: return a message indicating web search needs configuration
  return `Web search is not configured. To enable, set BRAVE_SEARCH_API_KEY in your environment. Query: "${searchQuery}"`;
}

/**
 * Run code in a sandbox (optional, only when sandbox is enabled)
 */
async function executeRunCode(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const code = input.code as string;
  const language = (input.language as string) || 'python';

  try {
    // Dynamic import to avoid circular dependencies
    const { ocService } = await import('./oc.js');

    const sandboxKey = `portal-agent-${context.agentId}`;
    
    // Ensure sandbox exists
    let sandbox = await ocService.getSandbox(sandboxKey);
    if (!sandbox) {
      await ocService.createSandbox(sandboxKey, 'claude-code');
      await ocService.installAgentTools(sandboxKey, 'claude-code');
    }

    // Build the command based on language
    let command: string;
    switch (language) {
      case 'javascript':
        command = `node -e ${JSON.stringify(code)}`;
        break;
      case 'shell':
        command = code;
        break;
      case 'python':
      default:
        command = `python3 -c ${JSON.stringify(code)}`;
        break;
    }

    const result = await ocService.runCommand(sandboxKey, command);
    
    const output: string[] = [];
    if (result.stdout) output.push(`stdout:\n${result.stdout}`);
    if (result.stderr) output.push(`stderr:\n${result.stderr}`);
    if (result.exitCode !== 0) output.push(`Exit code: ${result.exitCode}`);
    
    return output.length > 0 ? output.join('\n\n') : 'Code executed successfully (no output)';
  } catch (err: any) {
    return `Error executing code: ${err.message}`;
  }
}

// ==========================================
// Tool Router
// ==========================================

const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  search_knowledge_base: executeSearchKnowledgeBase,
  read_file: executeReadFile,
  write_file: executeWriteFile,
  list_files: executeListFiles,
  web_search: executeWebSearch,
  run_code: executeRunCode,
};

/**
 * Execute a tool by name with given input and context
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const executor = TOOL_EXECUTORS[toolName];
  if (!executor) {
    return `Unknown tool: ${toolName}`;
  }

  const startTime = Date.now();
  try {
    const result = await executor(input, context);
    const duration = Date.now() - startTime;
    console.log(`[PortalAgent] Tool ${toolName} completed in ${duration}ms`);
    return result;
  } catch (err: any) {
    const duration = Date.now() - startTime;
    console.error(`[PortalAgent] Tool ${toolName} failed after ${duration}ms:`, err);
    return `Tool execution error: ${err.message}`;
  }
}

/**
 * Build the list of tools available for a portal agent based on config
 */
export function getPortalAgentTools(options: {
  sandboxEnabled?: boolean;
  enabledTools?: string[];
}): Anthropic.Messages.Tool[] {
  let tools = [...PORTAL_AGENT_TOOLS];

  // Add sandbox tool if enabled
  if (options.sandboxEnabled) {
    tools.push(SANDBOX_TOOL);
  }

  // Filter by enabled tool categories if specified
  if (options.enabledTools && options.enabledTools.length > 0) {
    tools = tools.filter(t => options.enabledTools!.includes(t.name));
  }

  return tools;
}

/**
 * Build tool context from agent configuration
 */
export async function buildToolContext(
  agentId: string,
  userId: string,
  organizationId?: string | null,
  options?: {
    portalUserId?: string | null;
    sseEmit?: (event: { type: string; [key: string]: any }) => void;
  }
): Promise<ToolContext> {
  // Get attached buckets with read_only flag
  const buckets = await query<{ id: string; name: string; user_id: string; read_only: boolean | number }>(
    `SELECT b.id, b.name, b.user_id, ab.read_only
     FROM agent_buckets ab
     JOIN buckets b ON ab.bucket_id = b.id
     WHERE ab.session_id = $1`,
    [agentId]
  );

  // Get attached knowledge bases
  const knowledgeBases = await query<{ id: string; name: string; collection_name: string }>(
    `SELECT kb.id, kb.name, kb.collection_name
     FROM agent_knowledge_bases akb
     JOIN knowledge_bases kb ON akb.knowledge_base_id = kb.id
     WHERE akb.session_id = $1 AND kb.status = 'ready'`,
    [agentId]
  );

  return {
    agentId,
    userId,
    organizationId,
    portalUserId: options?.portalUserId,
    sseEmit: options?.sseEmit,
    buckets: buckets.map(b => ({ 
      id: b.id, 
      name: b.name, 
      userId: b.user_id,
      readOnly: b.read_only === true || b.read_only === 1,
    })),
    knowledgeBases: knowledgeBases.map(kb => ({
      id: kb.id,
      name: kb.name,
      collectionName: kb.collection_name,
    })),
  };
}

// ==========================================
// Helpers
// ==========================================

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
