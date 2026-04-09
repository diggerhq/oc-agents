import React, { useState, useEffect, useRef, FormEvent, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { FilePreviewModal } from '@/components/FilePreviewModal';

const DEFAULT_API_URL = import.meta.env.VITE_API_URL || '';

// ---------- Types ----------

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking_content?: string;  // JSON array of thinking/tool entries, persisted for audit
  created_at?: string;
}

interface Thread {
  id: string;
  portal_session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface PortalSession {
  id: string;
  agent_id: string;
  visitor_id: string;
}

interface PortalConfig {
  name: string;
  portalName?: string | null;
  agentName?: string;
  greeting: string;
  portalGreeting?: string | null;
  suggestedQuestions?: string[] | null;
  portalActiveSkills?: Array<{id: string; name: string; friendlyName: string}> | null;
  theme: {
    primaryColor?: string;
    backgroundColor?: string;
    accentColor?: string;
    textColor?: string;
    buttonColor?: string;
  } | null;
  logoUrl?: string | null;
  customCSS?: string | null;
}

interface PortalFile {
  id: string;
  name: string;
  displayName?: string;  // Human-readable name for display
  friendly_name?: string; // AI-generated friendly name from DB
  path: string;
  is_folder: boolean;
  mime_type?: string | null;
  size?: number;
  bucket_id?: string;
  bucketName?: string;
}

interface PortalBucket {
  id: string;
  name: string;
  access_type: string;
}

// Legacy ThinkingEntry shape — the parseContentBlocks function handles this format
// from old DB records: { type: 'thinking', content/thinking: '...' }, { type: 'tool'|'tool_result', toolName, ... }
// No interface needed since we parse via any/unknown

// ---------- Helpers ----------

// Common file extensions to detect
const FILE_EXTENSIONS = /\.(tsx?|jsx?|py|rb|go|rs|java|cs|cpp|c|h|hpp|css|scss|sass|less|html?|xml|json|ya?ml|md|txt|csv|sql|sh|bash|zsh|ps1|dockerfile|gitignore|env|config|conf|ini|toml|lock|log|pdf|pptx?|xlsx?|docx?|png|jpe?g|gif|svg|webp|bmp|ico|tiff?|mp3|mp4|wav|avi|mov|zip|tar|gz|rar|7z)$/i;

function looksLikeFilename(text: string): boolean {
  return FILE_EXTENSIONS.test(text) || (text.includes('/') && FILE_EXTENSIONS.test(text));
}

// Generate a human-readable display name from a filename
function generateDisplayName(filename: string): string {
  return filename
    .replace(/[-_]/g, ' ')  // Replace hyphens and underscores with spaces
    .replace(/\.\w+$/, '')   // Remove file extension
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))  // Capitalize each word
    .join(' ');
}

function getVisitorId(): string {
  const key = 'portal_visitor_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

// --- Content blocks for interleaved Claude Desktop–style rendering ---

interface ContentBlock {
  type: 'thinking' | 'text' | 'tool_use';
  id: string;
  content?: string;        // for text blocks or legacy thinking
  thinking?: string;       // for thinking blocks (Anthropic API format)
  signature?: string | null; // for thinking blocks signature
  toolName?: string;       // for tool_use
  input?: unknown;         // for tool_use
  result?: unknown;        // for tool_use (after completion)
  status?: 'running' | 'completed' | 'error';
  duration?: number;
  isError?: boolean;
}

function getToolDescription(toolName: string, input?: unknown): string {
  const inp = (input || {}) as Record<string, string>;
  switch (toolName) {
    // Portal agent tools
    case 'write_file': return `Created ${inp.path || inp.filename || 'a file'}`;
    case 'read_file': return `Read ${inp.path || inp.filename || 'a file'}`;
    case 'run_code': case 'execute_code': {
      const lang = inp.language ? `${inp.language} ` : '';
      return `Ran ${lang}code`.replace(/  +/g, ' ').trim();
    }
    case 'web_search': return inp.query ? `Searched the web for "${inp.query}"` : 'Searched the web';
    case 'search_knowledge_base': return inp.query ? `Searched knowledge base for "${inp.query}"` : 'Searched knowledge base';
    case 'list_files': return inp.path ? `Listed files in ${inp.path}` : 'Listed files';
    // Claude Code / E2B sandbox tools
    case 'Bash': case 'Shell': {
      const cmd = inp.command || inp.cmd || '';
      if (cmd) {
        const short = cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
        return `Ran command: ${short}`;
      }
      return 'Ran command';
    }
    case 'Read': return inp.file_path || inp.path ? `Read ${inp.file_path || inp.path}` : 'Read file';
    case 'Write': return inp.file_path || inp.path ? `Wrote ${inp.file_path || inp.path}` : 'Wrote file';
    case 'Edit': return inp.file_path || inp.path ? `Edited ${inp.file_path || inp.path}` : 'Edited file';
    case 'Glob': return inp.pattern ? `Found files matching ${inp.pattern}` : 'Searched for files';
    case 'Grep': return inp.pattern ? `Searched for "${inp.pattern}"` : 'Searched code';
    case 'Task': return inp.description || 'Ran subtask';
    case 'WebFetch': case 'Fetch': return inp.url ? `Fetched ${inp.url}` : 'Fetched URL';
    case 'TodoRead': return 'Checked task list';
    case 'TodoWrite': return 'Updated task list';
    default: {
      const friendly = toolName.replace(/_/g, ' ');
      return friendly.charAt(0).toUpperCase() + friendly.slice(1);
    }
  }
}

function getToolIcon(toolName: string): 'file' | 'terminal' | 'search' | 'folder' | 'gear' {
  switch (toolName) {
    case 'write_file': case 'read_file': case 'create_file': case 'Read': case 'Write': case 'Edit': return 'file';
    case 'run_code': case 'execute_code': case 'Bash': case 'Shell': return 'terminal';
    case 'web_search': case 'search_knowledge_base': case 'Grep': case 'WebFetch': case 'Fetch': return 'search';
    case 'list_files': case 'Glob': return 'folder';
    default: return 'gear';
  }
}

/** Parse thinking_content JSON into ContentBlock[]. Handles both new block format and legacy ThinkingEntry[] */
function parseContentBlocks(thinkingContent?: string, messageContent?: string): ContentBlock[] {
  if (!thinkingContent) {
    return messageContent ? [{ type: 'text', id: 'text-0', content: messageContent }] : [];
  }
  try {
    const parsed = JSON.parse(thinkingContent);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return messageContent ? [{ type: 'text', id: 'text-0', content: messageContent }] : [];
    }
    
    const blocks: ContentBlock[] = [];
    let hasTextBlocks = false;
    
    for (let i = 0; i < parsed.length; i++) {
      const entry = parsed[i];
      
      if (entry.type === 'thinking' || entry.type === 'extended_thinking') {
        const thinkingText = entry.thinking || entry.content || '';
        if (thinkingText.trim()) {
          blocks.push({
            type: 'thinking',
            id: entry.id || `t-${i}`,
            content: thinkingText,
            thinking: thinkingText,
            signature: entry.signature || null,
          });
        }
      } else if (entry.type === 'text') {
        if (entry.content?.trim()) {
          hasTextBlocks = true;
          blocks.push({
            type: 'text',
            id: entry.id || `text-${i}`,
            content: entry.content,
          });
        }
      } else if (entry.type === 'tool_use') {
        // Direct ContentBlock format (from portal-agent / Anthropic API)
        blocks.push({
          type: 'tool_use',
          id: entry.id || `tool-${i}`,
          toolName: entry.toolName || entry.name || 'Tool',
          input: entry.input,
          result: entry.result,
          status: entry.status || 'completed',
          duration: entry.duration,
          isError: entry.isError,
        });
      } else if (entry.type === 'tool_result') {
        // E2B format tool completion — this is the only tool entry we render
        blocks.push({
          type: 'tool_use',
          id: entry.toolId || entry.id || `tool-${i}`,
          toolName: entry.toolName || entry.name || 'Tool',
          input: entry.input,
          result: entry.result,
          status: 'completed' as const,
          duration: entry.duration,
          isError: entry.isError,
        });
      } else if (entry.type === 'tool') {
        // Legacy tool_start entry — SKIP entirely (tool_result has the complete info)
        // This avoids duplicate rendering
        continue;
      } else if (entry.name && !entry.type) {
        // Very old format: objects with just 'name' field
        blocks.push({
          type: 'tool_use',
          id: entry.id || `tool-${i}`,
          toolName: entry.name || 'Tool',
          input: entry.input,
          result: entry.result,
          status: 'completed' as const,
          duration: entry.duration,
          isError: entry.isError,
        });
      }
    }
    
    // If no text blocks were saved (old data), append messageContent as final text
    if (!hasTextBlocks && messageContent) {
      blocks.push({ type: 'text', id: 'text-final', content: messageContent });
    }
    
    return blocks;
  } catch {
    const blocks: ContentBlock[] = [];
    if (thinkingContent.trim()) {
      blocks.push({ type: 'thinking', id: 'legacy', content: thinkingContent });
    }
    if (messageContent) {
      blocks.push({ type: 'text', id: 'text-0', content: messageContent });
    }
    return blocks;
  }
}

// ---------- Component ----------

// Generate a descriptive title from thinking content (used as fallback during streaming)
function generateThinkingTitle(content: string): string {
  if (!content || content.trim().length === 0) return 'Thinking...';

  // Clean up the content
  let cleaned = content.trim();

  // For very short thinking blocks, just say "Thinking..." — the AI title will replace this
  if (cleaned.length < 80) return 'Thinking...';

  // Skip system prompt analysis sections - look for the actual reasoning
  const reasoningMarkers = [
    /Given the instructions[^.!?]*[.!?]\s+(.+)/is,
    /The user (?:just sent|wants|needs|is asking)[^.!?]*[.!?]\s+(.+)/is,
    /I (?:need to|should|will|can)\s+(?:respond by|start by|begin by|first)\s+(.+)/is,
  ];

  for (const marker of reasoningMarkers) {
    const match = cleaned.match(marker);
    if (match && match[1]) {
      cleaned = match[1].trim();
      break;
    }
  }

  // Extract key action phrases that indicate what the thinking is about
  const keyPhrases = [
    /(?:analyzing|understanding|examining|reviewing|checking)\s+([^.!?\n]{5,50})/i,
    /(?:looking for|searching for|finding)\s+([^.!?\n]{5,50})/i,
    /(?:creating|building|writing|implementing)\s+([^.!?\n]{5,50})/i,
    /(?:solving|calculating|computing|simulating)\s+([^.!?\n]{5,50})/i,
    /(?:considering|evaluating|determining)\s+([^.!?\n]{5,50})/i,
    /(?:running|executing|installing|setting up)\s+([^.!?\n]{5,50})/i,
  ];

  for (const pattern of keyPhrases) {
    const match = cleaned.match(pattern);
    if (match && match[1]) {
      let title = match[1].trim();
      title = title.charAt(0).toUpperCase() + title.slice(1);
      if (title.length > 50) {
        title = title.slice(0, 47) + '...';
      }
      return title;
    }
  }

  // Try to extract first meaningful sentence (not a quoted instruction)
  const firstSentence = cleaned.match(/^([A-Z][^.!?\n]{15,60})[.!?]/);
  if (firstSentence && firstSentence[1] && !firstSentence[1].includes('"')) {
    let title = firstSentence[1].trim();
    if (title.length > 50) {
      title = title.slice(0, 47) + '...';
    }
    return title;
  }

  // Fallback for longer content: truncated first line
  if (cleaned.length > 50) {
    const firstLine = cleaned.split('\n')[0].slice(0, 47).trim();
    const lastSpace = firstLine.lastIndexOf(' ');
    return (lastSpace > 25 ? firstLine.slice(0, lastSpace) : firstLine) + '...';
  }

  return 'Thinking...';
}

// AI-powered title generation for thinking blocks using backend proxy
async function generateAITitle(content: string, agentId: string, sessionId: string, apiUrl?: string): Promise<string> {
  try {
    const contentPreview = content.slice(0, 1000);
    const baseUrl = apiUrl || '';

    const response = await fetch(`${baseUrl}/api/portal/${agentId}/sessions/${sessionId}/summarize-thinking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: contentPreview }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ThinkingTitle] API error:', response.status, errorText);
      throw new Error(`Failed to generate title: ${response.status}`);
    }

    const data = await response.json();
    console.log('[ThinkingTitle] AI title generated:', data.title);
    return data.title || generateThinkingTitle(content);
  } catch (error) {
    console.error('[ThinkingTitle] Failed to generate AI title:', error);
    return generateThinkingTitle(content);
  }
}

// Collapsible thinking block — each one shows an AI-generated title
function ThinkingBlockView({
  content,
  isStreaming,
  agentId,
  sessionId,
  apiUrl,
}: {
  content: string;
  isStreaming: boolean;
  agentId?: string;
  sessionId?: string;
  apiUrl?: string;
}) {
  const [expanded, setExpanded] = useState(true); // Always start expanded
  const [showFull, setShowFull] = useState(false);
  const [title, setTitle] = useState<string>('Thinking...');
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const hasGeneratedRef = useRef(false);

  const TRUNCATE_LEN = 400;
  const isLong = content.length > TRUNCATE_LEN;

  // Generate AI title when thinking completes
  useEffect(() => {
    console.log('[ThinkingBlockView] Effect running:', {
      isStreaming,
      hasContent: !!content,
      isGeneratingTitle,
      hasGenerated: hasGeneratedRef.current,
      hasAgentId: !!agentId,
      hasSessionId: !!sessionId,
      hasApiUrl: !!apiUrl,
      agentId,
      sessionId,
      contentPreview: content.slice(0, 100)
    });

    if (!isStreaming && content && !isGeneratingTitle && !hasGeneratedRef.current && agentId && sessionId) {
      hasGeneratedRef.current = true;
      setTitle('Generating summary...');
      setIsGeneratingTitle(true);
      generateAITitle(content, agentId, sessionId, apiUrl).then(aiTitle => {
        setTitle(aiTitle);
        setIsGeneratingTitle(false);
      });
    } else if (isStreaming) {
      // While streaming, use the fast regex-based title
      setTitle(generateThinkingTitle(content));
    } else if (!isStreaming && (!agentId || !sessionId)) {
      // Fallback if no API available
      console.log('[ThinkingBlockView] Using fallback title - missing props');
      setTitle(generateThinkingTitle(content));
    }
  }, [isStreaming, content, agentId, sessionId, isGeneratingTitle]);

  return (
    <div className="my-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm hover:opacity-80 transition-opacity"
        title={content.slice(0, 150)} // Show preview on hover
      >
        {isStreaming ? (
          <svg className="w-4 h-4 text-[#94a3b8]" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-[#22c55e]" fill="currentColor" viewBox="0 0 24 24">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
          </svg>
        )}
        <span className="font-medium text-[#475569]">{title}</span>
        <svg
          className={`w-3.5 h-3.5 text-[#94a3b8] transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="mt-2 ml-6 text-sm text-[#64748b] leading-relaxed border-l-2 border-[#e2e8f0] pl-4">
          <div className="whitespace-pre-wrap break-words">
            {/* Show full content while streaming; truncate only when done */}
            {isStreaming || showFull || !isLong ? content : content.slice(0, TRUNCATE_LEN) + '...'}
          </div>
          {!isStreaming && isLong && !showFull && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowFull(true); }}
              className="text-[#3b82f6] text-xs mt-2 hover:underline"
            >
              Show more
            </button>
          )}
          {!isStreaming && (
            <div className="flex items-center gap-1.5 mt-3 text-xs">
              <svg className="w-3.5 h-3.5 text-[#22c55e]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
              <span className="text-[#22c55e] font-medium">Done</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Tool icon component
function ToolIcon({ toolName }: { toolName: string }) {
  const iconType = getToolIcon(toolName);
  switch (iconType) {
    case 'file':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case 'terminal':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    case 'search':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      );
    case 'folder':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      );
    default:
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
  }
}

// Collapsible tool block — shows friendly description, expandable input/output
function ToolBlockView({ block }: { block: ContentBlock }) {
  const [expanded, setExpanded] = useState(false);

  const description = getToolDescription(block.toolName || '', block.input);
  const isComplete = block.status === 'completed' || block.status === 'error';

  // Render code-style input for terminal tools
  const renderToolInput = () => {
    if (!block.input) return null;
    const inp = block.input as Record<string, string>;

    // For run_code — show the code in a dark block
    if ((block.toolName === 'run_code' || block.toolName === 'execute_code') && inp.code) {
      return (
        <div className="mt-2 ml-6">
          <div className="text-xs text-[#94a3b8] mb-1">{inp.language || 'bash'}</div>
          <pre className="text-xs bg-[#1e293b] text-[#e2e8f0] p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-words">
            {inp.code}
          </pre>
        </div>
      );
    }
    // For file operations — show filename as a pill
    if ((block.toolName === 'write_file' || block.toolName === 'read_file') && (inp.path || inp.filename)) {
      return (
        <div className="mt-1.5 ml-6">
          <span className="inline-block px-2.5 py-1 bg-[#f1f5f9] border border-[#e2e8f0] rounded-md text-xs font-mono text-[#475569]">
            {inp.path || inp.filename}
          </span>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="my-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm text-[#64748b] hover:text-[#334155] transition-colors"
      >
        <span className={isComplete ? 'text-[#64748b]' : 'text-[#3b82f6]'}>
          <ToolIcon toolName={block.toolName || ''} />
        </span>
        <span className={!isComplete ? 'animate-pulse' : ''}>
          {description}
          {isComplete && !block.isError && block.result ? ' successfully' : ''}
        </span>
        {isComplete && block.duration != null && (
          <span className="text-xs text-[#94a3b8]">
            {block.duration >= 1000 ? `${(block.duration / 1000).toFixed(1)}s` : `${block.duration}ms`}
          </span>
        )}
        <svg
          className={`w-3 h-3 text-[#94a3b8] transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Always show inline hints (filename pill, code preview) even when collapsed */}
      {!expanded && renderToolInput()}

      {/* Expanded detail view */}
      {expanded && (
        <div className="mt-2 ml-6 space-y-2">
          {block.input !== undefined && block.input !== null && (
            <div>
              <div className="text-xs font-medium text-[#64748b] mb-1">Input</div>
              <pre className="text-xs bg-[#1e293b] text-[#e2e8f0] p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-words">
                {typeof block.input === 'string' ? block.input : JSON.stringify(block.input, null, 2)}
              </pre>
            </div>
          )}
          {block.result !== undefined && block.result !== null && (
            <div>
              <div className="text-xs font-medium text-[#64748b] mb-1">Output</div>
              <pre className="text-xs bg-[#f8fafc] border border-[#e2e8f0] text-[#334155] p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                {typeof block.result === 'string'
                  ? (block.result.length > 2000 ? block.result.slice(0, 2000) + '...\n[truncated]' : block.result)
                  : JSON.stringify(block.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PortalSandboxAgentChat() {
  const { agentId } = useParams<{ agentId: string }>();
  const [searchParams] = useSearchParams();

  const apiUrlParam = searchParams.get('api');
  const API_URL = apiUrlParam || DEFAULT_API_URL;

  // Parse user context from URL params
  const parsedUserContext = useMemo(() => {
    const context: Record<string, string> = {};
    const tokenParam = searchParams.get('token');
    if (tokenParam) {
      try {
        const decoded = JSON.parse(atob(tokenParam));
        if (typeof decoded === 'object' && decoded !== null) {
          Object.entries(decoded).forEach(([key, value]) => {
            if (typeof value === 'string') {
              context[key] = value;
            }
          });
        }
      } catch {
        context['token'] = tokenParam;
      }
    }
    searchParams.forEach((value, key) => {
      if (key !== 'token' && key !== 'api') {
        context[key] = value;
      }
    });
    return context;
  }, [searchParams]);

  const visitorIdFromParams = parsedUserContext.user_id || parsedUserContext.user_email || null;

  // ---------- State ----------

  const [config, setConfig] = useState<PortalConfig | null>(null);
  const [session, setSession] = useState<PortalSession | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<PortalFile[]>([]);
  const [activeSkills, setActiveSkills] = useState<Array<{id: string; name: string; friendlyName: string}>>([]);
  const [referenceFiles, setReferenceFiles] = useState<Array<{id: string; name: string}>>([]);
  const [previewFile, setPreviewFile] = useState<PortalFile | null>(null);
  const [, setBuckets] = useState<PortalBucket[]>([]);
  const [streamBlocks, setStreamBlocks] = useState<ContentBlock[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [filePreviewWidth, setFilePreviewWidth] = useState(600); // Initial width in pixels
  const [isResizing, setIsResizing] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const streamBlocksRef = useRef<ContentBlock[]>([]);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(0);

  // Keep ref in sync with state so we can access latest blocks in async closures
  useEffect(() => {
    streamBlocksRef.current = streamBlocks;
  }, [streamBlocks]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 200);
    textarea.style.height = `${newHeight}px`;
  }, [input]);

  // Auto-resize chat input
  useEffect(() => {
    const textarea = chatInputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 200);
    textarea.style.height = `${newHeight}px`;
  }, [input]);

  // Suggested questions
  const defaultSuggestedQuestions = [
    "What can you help me with?",
    "Summarize the key information in my files",
    "Help me analyze the data I've uploaded",
  ];

  const suggestedQuestions = config?.suggestedQuestions?.length
    ? config.suggestedQuestions
    : defaultSuggestedQuestions;

  // ---------- Resize handlers for file preview ----------

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = filePreviewWidth;
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = resizeStartX.current - e.clientX;
      const newWidth = Math.max(400, Math.min(1200, resizeStartWidth.current + deltaX));
      setFilePreviewWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // ---------- Initialization ----------

  const initializedRef = useRef(false);
  const initializedVisitorRef = useRef<string | null>(null);

  useEffect(() => {
    async function init() {
      if (!agentId) return;

      const currentVisitorId = visitorIdFromParams || getVisitorId();

      if (initializedRef.current && session && initializedVisitorRef.current === currentVisitorId) {
        setIsLoading(false);
        return;
      }

      if (initializedVisitorRef.current && initializedVisitorRef.current !== currentVisitorId) {
        setIsLoading(true);
        setMessages([]);
        setThreads([]);
        setActiveThread(null);
        setSession(null);
        setStreamBlocks([]);
        initializedRef.current = false;
        initializedVisitorRef.current = null;
      }

      try {
        const configRes = await fetch(`${API_URL}/api/portal/${agentId}/config`);
        if (!configRes.ok) {
          if (configRes.status === 404) {
            setError('Portal not found. This agent may not have portal enabled.');
          } else {
            setError('Failed to load portal configuration');
          }
          setIsLoading(false);
          return;
        }
        const configData = await configRes.json();
        setConfig(configData.config);
        
        // Load skills from config
        if (configData.config?.portalActiveSkills) {
          setActiveSkills(configData.config.portalActiveSkills);
        }

        const visitorId = currentVisitorId;
        const sessionStorageKey = `portal_agent_session_${agentId}_${visitorId}`;
        const storedSessionId = sessionStorage.getItem(sessionStorageKey);

        if (storedSessionId) {
          const verifyRes = await fetch(
            `${API_URL}/api/portal/${agentId}/sessions/${storedSessionId}/threads`
          );
          if (verifyRes.ok) {
            setSession({ id: storedSessionId, agent_id: agentId!, visitor_id: visitorId });
            const threadsData = await verifyRes.json();
            const loadedThreads = threadsData.threads || [];
            setThreads(loadedThreads);

            // Auto-select the most recent thread and load its messages, or create a new one if none exist
            if (loadedThreads.length > 0) {
              const mostRecentThread = loadedThreads[0];
              setActiveThread(mostRecentThread);

              // Load messages for the most recent thread
              try {
                const msgRes = await fetch(
                  `${API_URL}/api/portal/${agentId}/sessions/${storedSessionId}/threads/${mostRecentThread.id}/messages`
                );
                if (msgRes.ok) {
                  const msgData = await msgRes.json();
                  setMessages(msgData.messages || []);
                }
              } catch (err) {
                console.error('Failed to load thread messages:', err);
              }
            } else {
              // No threads exist, create an initial one
              try {
                const threadRes = await fetch(
                  `${API_URL}/api/portal/${agentId}/sessions/${storedSessionId}/threads`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: 'New conversation' }),
                  }
                );

                if (threadRes.ok) {
                  const threadData = await threadRes.json();
                  setThreads([threadData.thread]);
                  setActiveThread(threadData.thread);
                }
              } catch (err) {
                console.error('Failed to create initial thread:', err);
              }
            }

            initializedRef.current = true;
            initializedVisitorRef.current = visitorId;
            setIsLoading(false);
            return;
          }
        }

        const token = parsedUserContext.token;
        const requestBody: Record<string, unknown> = { visitorId };
        if (token) {
          requestBody.token = token;
        } else if (Object.keys(parsedUserContext).length > 0) {
          requestBody.userContext = parsedUserContext;
        }

        const sessionRes = await fetch(`${API_URL}/api/portal/${agentId}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!sessionRes.ok) {
          setError('Failed to create session');
          setIsLoading(false);
          return;
        }

        const sessionData = await sessionRes.json();
        setSession(sessionData.session);
        sessionStorage.setItem(sessionStorageKey, sessionData.session.id);
        initializedRef.current = true;
        initializedVisitorRef.current = visitorId;

        let loadedThreads: Thread[] = [];
        if (sessionData.threads) {
          loadedThreads = sessionData.threads;
        } else {
          const threadsRes = await fetch(
            `${API_URL}/api/portal/${agentId}/sessions/${sessionData.session.id}/threads`
          );
          if (threadsRes.ok) {
            const threadsData = await threadsRes.json();
            loadedThreads = threadsData.threads || [];
          }
        }
        setThreads(loadedThreads);

        // Auto-select the most recent thread, or create a new one if none exist
        if (loadedThreads.length > 0) {
          // Load the most recent thread (they're ordered by created_at DESC from backend)
          const mostRecentThread = loadedThreads[0];
          setActiveThread(mostRecentThread);

          // Load messages for the most recent thread
          try {
            const msgRes = await fetch(
              `${API_URL}/api/portal/${agentId}/sessions/${sessionData.session.id}/threads/${mostRecentThread.id}/messages`
            );
            if (msgRes.ok) {
              const msgData = await msgRes.json();
              setMessages(msgData.messages || []);
            }
          } catch (err) {
            console.error('Failed to load thread messages:', err);
          }
        } else {
          // No threads exist, create an initial one
          try {
            const threadRes = await fetch(
              `${API_URL}/api/portal/${agentId}/sessions/${sessionData.session.id}/threads`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: 'New conversation' }),
              }
            );

            if (threadRes.ok) {
              const threadData = await threadRes.json();
              setThreads([threadData.thread]);
              setActiveThread(threadData.thread);
            }
          } catch (err) {
            console.error('Failed to create initial thread:', err);
          }
        }

        setIsLoading(false);
      } catch (err) {
        console.error('Failed to initialize portal:', err);
        setError('Failed to connect to the portal');
        setIsLoading(false);
      }
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, API_URL, visitorIdFromParams]);

  // ---------- Files ----------

  const fetchFiles = async (sessionId: string) => {
    try {
      const bucketsRes = await fetch(`${API_URL}/api/portal/${agentId}/sessions/${sessionId}/buckets`);
      if (!bucketsRes.ok) return;

      const bucketsData = await bucketsRes.json();
      setBuckets(bucketsData.buckets || []);

      if (!bucketsData.buckets || bucketsData.buckets.length === 0) return;

      // Fetch files from ALL buckets (except skills), not just the first one
      const allFiles: PortalFile[] = [];
      for (const bucket of bucketsData.buckets) {
        // Skip skills and input buckets - those are shown in the sidebar
        if (bucket.access_type === 'skills' || bucket.access_type === 'input') continue;
        
        const filesRes = await fetch(`${API_URL}/api/portal/${agentId}/sessions/${sessionId}/buckets/${bucket.id}/files`);
        if (filesRes.ok) {
          const filesData = await filesRes.json();
          const bucketFiles = (filesData.files || []).map((f: PortalFile) => ({
            ...f,
            bucketName: bucket.name,
            displayName: f.friendly_name || generateDisplayName(f.name),
          }));
          allFiles.push(...bucketFiles.filter((f: PortalFile) => !f.is_folder));
        }
      }
      console.log('[PortalSandboxAgentChat] Fetched files from', bucketsData.buckets.length, 'buckets, found', allFiles.length, 'files');
      setFiles(allFiles);
    } catch (err) {
      console.error('[PortalSandboxAgentChat] Failed to fetch files:', err);
    }
  };

  useEffect(() => {
    if (session?.id && agentId) {
      fetchFiles(session.id);
      fetchReferenceFiles(session.id);
    }
  }, [session?.id, agentId, API_URL]);

  // ---------- Eager Sandbox Warmup ----------
  // Spin up the sandbox as soon as the portal session is established,
  // so it's ready before the user sends their first message.
  const warmupTriggeredRef = useRef(false);

  useEffect(() => {
    if (!session?.id || !agentId || warmupTriggeredRef.current) return;
    warmupTriggeredRef.current = true;

    console.log('[PortalSandboxAgentChat] Triggering eager sandbox warmup for', session.id);
    fetch(`${API_URL}/api/portal/${agentId}/sessions/${session.id}/warmup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(res => res.json())
      .then(data => {
        console.log('[PortalSandboxAgentChat] Sandbox warmup result:', data.status || data.error);
      })
      .catch(err => {
        console.warn('[PortalSandboxAgentChat] Sandbox warmup failed (will retry on first message):', err.message);
      });
  }, [session?.id, agentId, API_URL]);

  const fetchReferenceFiles = async (sessionId: string) => {
    try {
      const bucketsRes = await fetch(`${API_URL}/api/portal/${agentId}/sessions/${sessionId}/buckets`);
      if (!bucketsRes.ok) return;
      const bucketsData = await bucketsRes.json();
      if (!bucketsData.buckets) return;
      
      const inputBucket = bucketsData.buckets.find((b: any) => b.access_type === 'input');
      if (!inputBucket) return;
      
      const filesRes = await fetch(`${API_URL}/api/portal/${agentId}/sessions/${sessionId}/buckets/${inputBucket.id}/files`);
      if (filesRes.ok) {
        const filesData = await filesRes.json();
        const refFiles = (filesData.files || [])
          .filter((f: any) => !f.is_folder)
          .map((f: any) => ({ id: f.id, name: f.name }));
        setReferenceFiles(refFiles);
      }
    } catch (err) {
      console.error('[PortalSandboxAgentChat] Failed to fetch reference files:', err);
    }
  };

  // ---------- Thread management ----------

  const loadThread = async (thread: Thread) => {
    if (!session) return;

    try {
      const res = await fetch(
        `${API_URL}/api/portal/${agentId}/sessions/${session.id}/threads/${thread.id}/messages`
      );
      if (!res.ok) throw new Error('Failed to load messages');

      const data = await res.json();
      console.log('[PortalAgentChat] Loaded messages:', {
        threadId: thread.id,
        messageCount: data.messages.length,
        messagesWithThinking: data.messages.filter((m: Message) => m.thinking_content).length,
        sampleThinkingContent: data.messages.find((m: Message) => m.thinking_content)?.thinking_content?.substring(0, 100),
      });
      setActiveThread(thread);
      setMessages(data.messages);
      setStreamBlocks([]);
    } catch (err) {
      console.error('Failed to load thread:', err);
    }
  };

  const createNewThread = () => {
    setActiveThread(null);
    setMessages([]);
    setInput('');
    setStreamBlocks([]);
    // Focus the right input depending on state
    setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
      if (chatInputRef.current) chatInputRef.current.focus();
    }, 100);
  };

  const handleDeleteThread = async (threadId: string) => {
    if (!session) return;

    // Confirm deletion
    if (!window.confirm('Are you sure you want to delete this conversation? This action cannot be undone.')) {
      return;
    }

    try {
      const res = await fetch(
        `${API_URL}/api/portal/${agentId}/sessions/${session.id}/threads/${threadId}`,
        { method: 'DELETE' }
      );

      if (!res.ok) throw new Error('Failed to delete thread');

      // Remove from local state
      setThreads(prev => prev.filter(t => t.id !== threadId));

      // If we deleted the active thread, create a new one
      if (activeThread?.id === threadId) {
        createNewThread();
      }
    } catch (err) {
      console.error('Failed to delete thread:', err);
      alert('Failed to delete conversation. Please try again.');
    }
  };

  // ---------- Send message ----------

  const handleSubmit = async (e: FormEvent, questionOverride?: string) => {
    e.preventDefault();
    const question = questionOverride || input.trim();
    if (!question || !session || isSending) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: question,
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsSending(true);
    setStreamBlocks([]);

    const assistantId = crypto.randomUUID();
    let fullContent = '';
    // Track the current block type and ID for appending deltas
    let lastBlockType = '';
    let currentThinkingBlockId: string | undefined;
    let currentTextBlockId: string | undefined;
    let accumulatedThinking = '';
    let accumulatedText = '';

    try {
      let threadId = activeThread?.id;
      if (!threadId) {
        // This should rarely happen now since we create an initial thread during init
        const threadRes = await fetch(
          `${API_URL}/api/portal/${agentId}/sessions/${session.id}/threads`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: question.slice(0, 50) }),
          }
        );

        if (!threadRes.ok) throw new Error('Failed to create thread');

        const threadData = await threadRes.json();
        threadId = threadData.thread.id;
        setActiveThread(threadData.thread);
        setThreads(prev => [threadData.thread, ...prev]);
      } else if (activeThread?.title === 'New conversation') {
        // First message in the auto-created initial thread — update its title
        const newTitle = question.slice(0, 50);
        fetch(
          `${API_URL}/api/portal/${agentId}/sessions/${session.id}/threads/${threadId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTitle }),
          }
        ).catch(() => { /* ignore title update failure */ });
        setActiveThread(prev => prev ? { ...prev, title: newTitle } : prev);
        setThreads(prev => prev.map(t => t.id === threadId ? { ...t, title: newTitle } : t));
      }

      const res = await fetch(
        `${API_URL}/api/portal/${agentId}/sessions/${session.id}/threads/${threadId}/stream`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: question }),
        }
      );

      if (!res.ok) throw new Error(`Failed to send message: ${res.status}`);
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantMessageCreated = false;
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(line.slice(6));

            // --- Build interleaved content blocks ---
            if (data.type === 'thinking' || data.type === 'extended_thinking') {
              const newContent = data.content || '';
              if (newContent) {
                // Ensure assistant message exists so thinking blocks can render
                if (!assistantMessageCreated) {
                  setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }]);
                  assistantMessageCreated = true;
                }
                accumulatedThinking += newContent;
                if (lastBlockType !== 'thinking') {
                  // Start a new thinking block
                  currentThinkingBlockId = `thinking-${Date.now()}`;
                  currentTextBlockId = undefined;
                  setStreamBlocks(prev => [...prev, {
                    type: 'thinking',
                    id: currentThinkingBlockId!,
                    content: accumulatedThinking,
                    thinking: accumulatedThinking, // Store in both fields for consistency
                  }]);
                  lastBlockType = 'thinking';
                } else {
                  // Append to current thinking block
                  setStreamBlocks(prev => prev.map(b =>
                    b.id === currentThinkingBlockId ? {
                      ...b,
                      content: accumulatedThinking,
                      thinking: accumulatedThinking
                    } : b
                  ));
                }
              }
            } else if (data.type === 'text') {
              fullContent += data.content;
              if (lastBlockType !== 'text') {
                // Start a new text block
                currentTextBlockId = `text-${Date.now()}`;
                currentThinkingBlockId = undefined;
                accumulatedThinking = '';
                accumulatedText = data.content;
                setStreamBlocks(prev => [...prev, {
                  type: 'text',
                  id: currentTextBlockId!,
                  content: accumulatedText,
                }]);
                lastBlockType = 'text';
              } else {
                // Append to current text block
                accumulatedText += data.content;
                setStreamBlocks(prev => prev.map(b =>
                  b.id === currentTextBlockId ? { ...b, content: accumulatedText } : b
                ));
              }
              // Also update the message content for persistence/fallback
              if (!assistantMessageCreated) {
                setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: fullContent }]);
                assistantMessageCreated = true;
              } else {
                setMessages(prev => prev.map(m =>
                  m.id === assistantId ? { ...m, content: fullContent } : m
                ));
              }
            } else if (data.type === 'tool_start') {
              const toolName = data.tool || data.toolName || 'Processing';
              const toolId = data.toolUseId || data.toolId || `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              currentThinkingBlockId = undefined;
              currentTextBlockId = undefined;
              accumulatedThinking = '';
              accumulatedText = '';
              lastBlockType = 'tool_use';

              setStreamBlocks(prev => {
                // Avoid duplicates
                if (prev.some(b => b.type === 'tool_use' && b.toolName === toolName && b.status === 'running')) return prev;
                return [...prev, {
                  type: 'tool_use',
                  id: toolId,
                  toolName,
                  input: data.input,
                  status: 'running' as const,
                }];
              });

              // Ensure assistant message exists so blocks have somewhere to render
              if (!assistantMessageCreated) {
                setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }]);
                assistantMessageCreated = true;
              }
            } else if (data.type === 'tool_result') {
              const toolName = data.tool || data.toolName || 'Task';
              const toolId = data.toolUseId || data.toolId;

              setStreamBlocks(prev => {
                const idx = prev.findIndex(b =>
                  b.type === 'tool_use' && (b.id === toolId || (b.toolName === toolName && b.status === 'running'))
                );
                if (idx >= 0) {
                  const updated = [...prev];
                  updated[idx] = {
                    ...updated[idx],
                    status: 'completed' as const,
                    result: data.result,
                    input: data.input || updated[idx].input,
                    duration: data.duration,
                    isError: data.isError,
                  };
                  return updated;
                }
                // Not found — add as completed
                return [...prev, {
                  type: 'tool_use',
                  id: toolId || `tool-result-${Date.now()}`,
                  toolName,
                  input: data.input,
                  result: data.result,
                  status: 'completed' as const,
                  duration: data.duration,
                  isError: data.isError,
                }];
              });
            } else if (data.type === 'done') {
              lastBlockType = '';
              currentThinkingBlockId = undefined;
              currentTextBlockId = undefined;
              accumulatedThinking = '';
              accumulatedText = '';
            } else if (data.type === 'error') {
              console.error('[PortalAgentChat] Stream error from backend:', data.error);
              lastBlockType = '';
              currentThinkingBlockId = undefined;
              currentTextBlockId = undefined;
              if (!fullContent) {
                fullContent = 'I encountered an issue processing your request. Please try again.';
                if (!assistantMessageCreated) {
                  setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: fullContent }]);
                  assistantMessageCreated = true;
                } else {
                  setMessages(prev => prev.map(m =>
                    m.id === assistantId ? { ...m, content: fullContent } : m
                  ));
                }
              }
            } else if (data.type === 'file_created') {
              // File was created by the agent - add to files list with display name
              const f = data.file || data; // Backend wraps in 'file' object
              setFiles(prev => {
                const fileId = f.id || data.fileId;
                if (prev.some(p => p.id === fileId)) return prev;
                const fileName = f.name || data.fileName || 'Untitled';
                return [...prev, {
                  id: fileId,
                  name: fileName,
                  displayName: f.displayName || data.displayName || generateDisplayName(fileName),
                  path: f.path || data.path || '/',
                  bucket_id: f.bucket_id || data.bucketId,
                  bucketName: f.bucket_name || data.bucketName,
                  mime_type: f.mime_type || data.mimeType,
                  size: f.size || data.size || 0,
                  is_folder: false,
                }];
              });
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      // After streaming is done, reload messages from DB to get the properly
      // persisted thinking_content (with all tool calls and thinking blocks).
      // This ensures what the user sees matches what's in the database.
      if (activeThread?.id || threadId) {
        const reloadThreadId = threadId;
        try {
          const msgRes = await fetch(
            `${API_URL}/api/portal/${agentId}/sessions/${session.id}/threads/${reloadThreadId}/messages`
          );
          if (msgRes.ok) {
            const msgData = await msgRes.json();
            console.log('[PortalSandboxAgentChat] Reloaded messages from DB after stream:', {
              count: msgData.messages.length,
              withThinking: msgData.messages.filter((m: Message) => m.thinking_content).length,
            });
            setMessages(msgData.messages);
          }
        } catch (err) {
          console.error('[PortalSandboxAgentChat] Failed to reload messages after stream:', err);
        }
      }

      // Clear stream blocks since we now have the persisted version
      setStreamBlocks([]);

      // Re-fetch files to pick up any new files created during the stream
      if (session?.id) {
        fetchFiles(session.id);
      }

      // Refresh threads list
      const threadsRes = await fetch(
        `${API_URL}/api/portal/${agentId}/sessions/${session.id}/threads`
      );
      if (threadsRes.ok) {
        const data = await threadsRes.json();
        setThreads(data.threads);
      }

      await fetchFiles(session.id);

    } catch (err) {
      console.error('Failed to send:', err);
      setMessages(prev => prev.filter(m => m.id !== assistantId));
    } finally {
      setIsSending(false);
    }
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ---------- Derived state ----------

  const portalName = config?.portalName || config?.agentName || config?.name || 'AI Assistant';
  const theme = config?.theme || {};
  const primaryColor = theme.primaryColor || '#6366f1';
  const buttonColor = theme.buttonColor || '#6366f1';

  // Are we in "chat mode" (have messages) or "landing mode" (empty)?
  const isChatMode = messages.length > 0;

  // ---------- Loading & Error ----------

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 rounded-full mx-auto mb-4" style={{ borderRightColor: primaryColor, borderBottomColor: primaryColor, borderLeftColor: primaryColor, borderTopColor: 'transparent' }} />
          <p className="text-[#64748b]">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <div className="text-center max-w-md mx-auto px-4">
          <div className="w-16 h-16 bg-[#fef2f2] rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[#ef4444]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-[#1e2a4a] mb-2">Unable to Load Portal</h1>
          <p className="text-[#64748b]">{error}</p>
        </div>
      </div>
    );
  }

  // ---------- Helpers for ReactMarkdown ----------
  
  // Extract plain text from React children (ReactMarkdown passes ReactNode, not string)
  const getTextFromChildren = (children: React.ReactNode): string => {
    if (typeof children === 'string') return children;
    if (typeof children === 'number') return String(children);
    if (Array.isArray(children)) return children.map(getTextFromChildren).join('');
    if (children && typeof children === 'object' && 'props' in children) {
      return getTextFromChildren((children as React.ReactElement).props.children);
    }
    return '';
  };
  
  // Find a file match by name
  const findFileMatch = (text: string) => {
    const clean = text.trim();
    if (!clean) return null;
    return files.find(f =>
      f.name === clean ||
      f.name.endsWith(clean) ||
      f.path?.endsWith(clean) ||
      clean.endsWith(f.name)
    ) || null;
  };

  // ---------- Render ----------

  return (
    <div className="chat-portal portal-container flex h-screen bg-white overflow-hidden" style={{ 
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      cursor: isResizing ? 'col-resize' : 'default',
      userSelect: isResizing ? 'none' : 'auto'
    }}>
      {/* Custom CSS injection */}
      {config?.customCSS && <style>{config.customCSS}</style>}
      <style>{`
        .chat-portal *::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .chat-portal *::-webkit-scrollbar-track {
          background: transparent;
        }
        .chat-portal *::-webkit-scrollbar-thumb {
          background: rgba(0,0,0,0.12);
          border-radius: 3px;
        }
        .chat-portal *::-webkit-scrollbar-thumb:hover {
          background: rgba(0,0,0,0.2);
        }
        .chat-portal * {
          scrollbar-width: thin;
          scrollbar-color: rgba(0,0,0,0.12) transparent;
        }
        .chat-portal .input-field:focus-within {
          border-color: ${primaryColor} !important;
          box-shadow: 0 0 0 3px ${primaryColor}20;
        }
        
        /* Slide animation for file drawer */
        @keyframes slide-in-right {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        
        .animate-slide-in-right {
          animation: slide-in-right 0.2s ease-out;
        }
      `}</style>

      {/* ===== Sidebar ===== */}
      <div
        className={`portal-sidebar flex-shrink-0 border-r border-[#e2e8f0] bg-white flex flex-col transition-all duration-200 ${
          sidebarCollapsed ? 'w-0 overflow-hidden border-r-0' : 'w-64'
        }`}
      >
        {/* Sidebar header */}
        <div className="portal-header p-4 flex items-center justify-between flex-shrink-0 border-b border-[#f1f5f9]">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" style={{ color: primaryColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <h2 className="portal-title text-base font-semibold text-[#1e2a4a]">Conversations</h2>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="sidebar-collapse-btn p-1.5 text-[#94a3b8] hover:text-[#64748b] hover:bg-[#f1f5f9] rounded-md transition-colors"
              title="Collapse sidebar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={createNewThread}
              className="sidebar-new-btn p-1.5 text-[#94a3b8] hover:text-[#64748b] hover:bg-[#f1f5f9] rounded-md transition-colors"
              title="New chat"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>

        {/* New Chat button */}
        <div className="p-3 border-b border-[#f1f5f9] flex-shrink-0">
          <button
            onClick={createNewThread}
            className="new-thread-button w-full px-4 py-2.5 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 text-white"
            style={{ backgroundColor: primaryColor }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New conversation
          </button>
        </div>

        {/* Thread list */}
        <div className="thread-list flex-1 overflow-y-auto p-2">
          {threads.length === 0 ? (
            <div className="thread-empty flex flex-col items-center justify-center py-12 text-center px-4">
              <div className="w-12 h-12 rounded-full bg-[#f1f5f9] flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-[#94a3b8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <p className="text-sm text-[#64748b] font-medium">No conversations yet</p>
              <p className="text-xs text-[#94a3b8] mt-1">Start by asking a question</p>
            </div>
          ) : (
            <div className="space-y-1">
              {threads.map(thread => (
                <div key={thread.id} className="group relative">
                  <button
                    onClick={() => loadThread(thread)}
                    className={`thread-item w-full px-3 py-3 text-sm text-left rounded-lg transition-all ${
                      activeThread?.id === thread.id
                        ? 'thread-active font-medium'
                        : 'text-[#4b5563] hover:bg-[#f8fafc] border border-transparent'
                    }`}
                    style={activeThread?.id === thread.id ? {
                      backgroundColor: `${primaryColor}15`,
                      border: `1px solid ${primaryColor}40`,
                      color: primaryColor,
                    } : undefined}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`thread-icon mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          activeThread?.id === thread.id
                            ? 'text-white'
                            : 'bg-[#f1f5f9] text-[#64748b] group-hover:bg-[#e2e8f0]'
                        }`}
                        style={activeThread?.id === thread.id ? { backgroundColor: primaryColor } : undefined}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="thread-title truncate">{thread.title || 'Untitled conversation'}</p>
                        <p className="thread-date text-xs text-[#94a3b8] mt-0.5">
                          {new Date(thread.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit'
                          })}
                        </p>
                      </div>
                    </div>
                  </button>
                  {/* Delete button - shows on hover */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteThread(thread.id);
                    }}
                    className="absolute top-2 right-2 p-1.5 rounded-md text-[#94a3b8] hover:text-[#ef4444] hover:bg-[#fee2e2] opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete conversation"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active Skills Section - Always visible */}
        {activeSkills.length > 0 && (
          <div className="skills-section border-t border-[#e2e8f0] p-3 bg-gradient-to-b from-white to-[#f8fafc]">
            <div className="flex items-center gap-2 mb-2 px-1">
              <svg className="w-4 h-4" style={{ color: primaryColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="text-xs font-semibold text-[#64748b] uppercase tracking-wide">Active Skills</span>
              <span className="ml-auto text-xs font-medium text-[#94a3b8]">{activeSkills.length}</span>
            </div>
            <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: '200px' }}>
              {activeSkills.map((skill) => (
                <div
                  key={skill.id}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white border border-[#e2e8f0] hover:border-[#cbd5e1] transition-colors"
                >
                  <div 
                    className="w-2 h-2 rounded-full flex-shrink-0" 
                    style={{ backgroundColor: primaryColor }}
                  ></div>
                  <span className="text-xs text-[#334155] font-medium truncate">{skill.friendlyName}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reference Files Section - Always visible */}
        {referenceFiles.length > 0 && (
          <div className="reference-files-section border-t border-[#e2e8f0] p-3 bg-gradient-to-b from-white to-[#f8fafc]">
            <div className="flex items-center gap-2 mb-2 px-1">
              <svg className="w-4 h-4" style={{ color: primaryColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-xs font-semibold text-[#64748b] uppercase tracking-wide">Reference Files</span>
              <span className="ml-auto text-xs font-medium text-[#94a3b8]">{referenceFiles.length}</span>
            </div>
            <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: '200px' }}>
              {referenceFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white border border-[#e2e8f0] hover:border-[#cbd5e1] transition-colors"
                >
                  <svg className="w-3.5 h-3.5 text-[#94a3b8] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <span className="text-xs text-[#334155] font-medium truncate">{file.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ===== Main Content ===== */}
      <div className="portal-main flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="portal-topbar flex-shrink-0 border-b border-[#e2e8f0] flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            {sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="sidebar-expand-btn p-1.5 text-[#94a3b8] hover:text-[#64748b] hover:bg-[#f1f5f9] rounded-md transition-colors"
                title="Show sidebar"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
              </button>
            )}
            {config?.logoUrl ? (
              <img src={config.logoUrl} alt="" className="portal-logo h-6 w-auto" />
            ) : (
              <span className="portal-name text-sm font-semibold text-[#1e2a4a]">{portalName}</span>
            )}
            <span
              className="portal-badge inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full"
              style={{ backgroundColor: `${primaryColor}20`, color: primaryColor }}
            >
              Beta
            </span>
          </div>
          {/* Files button */}
          <button
            onClick={() => setShowFiles(!showFiles)}
            className={`files-button flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              showFiles
                ? 'files-active'
                : 'text-[#64748b] hover:bg-[#f8fafc] hover:text-[#1e2a4a]'
            }`}
            style={showFiles ? { backgroundColor: `${primaryColor}15`, color: primaryColor } : undefined}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className="text-sm font-medium">Files</span>
            {files.length > 0 && (
              <span className="files-count px-1.5 py-0.5 text-xs font-medium bg-[#e2e8f0] text-[#64748b] rounded-full">{files.length}</span>
            )}
          </button>
        </div>

        {/* Content area */}
        {!isChatMode ? (
          /* ===== Landing State ===== */
          <div className="portal-landing flex-1 flex flex-col items-center justify-center px-6">
            <div className="portal-hero w-full max-w-2xl text-center">
              {/* Logo or Name */}
              {config?.logoUrl ? (
                <div className="landing-logo mb-4">
                  <img src={config.logoUrl} alt="" className="portal-logo h-12 w-auto mx-auto" />
                </div>
              ) : (
                <h1 className="landing-title text-2xl font-semibold text-[#1e2a4a] mb-1">
                  {portalName}
                  <span
                    className="portal-badge ml-2 inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full align-middle"
                    style={{ backgroundColor: `${primaryColor}20`, color: primaryColor }}
                  >
                    Beta
                  </span>
                </h1>
              )}
              {/* Greeting */}
              <p className="portal-greeting text-[#64748b] mt-1 mb-8">
                {config?.portalGreeting
                  ? config.portalGreeting.replace('{name}', portalName)
                  : (config?.greeting || "How can I help you today?")}
              </p>

              {/* Search input */}
              <form onSubmit={handleSubmit} className="landing-form mb-8">
                <div className="input-field relative flex items-center bg-white border border-[#e2e8f0] rounded-xl shadow-sm hover:border-[#cbd5e1] transition-all">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (input.trim() && !isSending) {
                          const form = e.currentTarget.closest('form');
                          if (form) form.requestSubmit();
                        }
                      }
                    }}
                    placeholder="What would you like to know? (Shift+Enter for new line)"
                    rows={3}
                    className="flex-1 px-4 py-3.5 text-[#1e2a4a] placeholder-[#94a3b8] bg-transparent border-none focus:outline-none text-[15px] resize-none"
                    style={{ minHeight: '80px', maxHeight: '300px', overflow: 'auto' }}
                    disabled={isSending}
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || isSending}
                    className="send-button mr-2 px-5 py-2 text-white font-medium rounded-lg border-none outline-none disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm"
                    style={{ backgroundColor: buttonColor }}
                  >
                    {isSending ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      'Ask'
                    )}
                  </button>
                </div>
              </form>

              {/* Active Skills - Show uploaded custom instructions */}
              {activeSkills.length > 0 && (
                <div className="active-skills mb-6">
                  <div className="flex items-center gap-2 text-[#64748b] text-sm mb-3">
                    <svg className="w-4 h-4 text-[#c5f467]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <span className="font-medium">Active Skills</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activeSkills.map((skill) => (
                      <div
                        key={skill.id}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-lg text-sm"
                      >
                        <div className="w-2 h-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-full"></div>
                        <span className="text-purple-900 font-medium">{skill.friendlyName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reference Files - Show uploaded reference material */}
              {referenceFiles.length > 0 && (
                <div className="reference-files mb-6">
                  <div className="flex items-center gap-2 text-[#64748b] text-sm mb-3">
                    <svg className="w-4 h-4 text-[#c5f467]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="font-medium">Reference Files</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {referenceFiles.map((file) => (
                      <div
                        key={file.id}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-200 rounded-lg text-sm"
                      >
                        <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        <span className="text-blue-900 font-medium">{file.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggested questions */}
              <div className="suggested-questions space-y-2">
                <div className="suggested-questions-header flex items-center gap-2 text-[#64748b] text-sm mb-3">
                  <svg className="w-4 h-4 text-[#c5f467]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-medium">Previously asked questions</span>
                </div>
                {suggestedQuestions.slice(0, 5).map((question, idx) => (
                  <button
                    key={idx}
                    onClick={(e) => {
                      setInput(question);
                      handleSubmit(e as unknown as FormEvent, question);
                    }}
                    className="suggested-question w-full text-left px-4 py-3.5 bg-white rounded-xl border border-[#e2e8f0] text-[#334155] hover:border-[#cbd5e1] hover:shadow-sm transition-all group flex items-center justify-between"
                    style={{ borderLeftWidth: '4px', borderLeftColor: idx === 0 ? '#c5f467' : '#e2e8f0' }}
                  >
                    <span className="text-[15px]">{question}</span>
                    <span
                      className={`px-4 py-1.5 text-white text-sm font-medium rounded-lg transition-opacity ${idx === 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                      style={{ backgroundColor: buttonColor }}
                    >
                      Ask
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="portal-footer mt-8 text-center">
              <p className="portal-disclaimer text-xs text-[#94a3b8]">AI can make mistakes; always verify.</p>
            </div>
          </div>
        ) : (
          /* ===== Chat State ===== */
          <div className="flex-1 flex flex-col min-h-0">
            {/* Messages area */}
            <div className="chat-container flex-1 overflow-y-auto">
              <div className="chat-messages max-w-3xl mx-auto px-6 py-6 space-y-6">
                {messages.map((msg, idx) => (
                  <div key={msg.id || idx}>
                    {msg.role === 'user' ? (
                      /* User message */
                      <div className="message-bubble message-user bg-white border border-[#e2e8f0] rounded-xl p-4 shadow-sm border-l-4 border-l-[#3b82f6]">
                        <div className="message-header flex items-center gap-2 mb-2">
                          <div className="user-avatar w-6 h-6 rounded-full bg-[#3b82f6] flex items-center justify-center">
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                          </div>
                          <span className="user-label font-medium text-sm text-[#1e2a4a]">You</span>
                        </div>
                        <p className="message-content text-[15px] text-[#1e2a4a] leading-relaxed whitespace-pre-wrap pl-8">{msg.content}</p>
                      </div>
                    ) : (
                      /* Assistant message — interleaved blocks rendering */
                      <div className="message-bubble message-assistant bg-white border border-[#e2e8f0] rounded-xl p-5 shadow-sm border-l-4 border-l-[#c5f467]">
                        <div className="message-header flex items-center gap-2 mb-3">
                          <div className="assistant-avatar w-6 h-6 rounded-full bg-gradient-to-br from-[#c5f467] to-[#22c55e] flex items-center justify-center">
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                          </div>
                          <span className="assistant-label font-medium text-sm text-[#1e2a4a]">{portalName}</span>
                        </div>
                        <div className="message-content pl-8">
                          {(() => {
                            // Determine content blocks: live stream, persisted, or plain text
                            const isStreamingThisMsg = isSending && idx === messages.length - 1;
                            const blocks: ContentBlock[] = isStreamingThisMsg && streamBlocks.length > 0
                              ? streamBlocks
                              : msg.thinking_content
                                ? parseContentBlocks(msg.thinking_content, msg.content)
                                : msg.content
                                  ? [{ type: 'text' as const, id: 'content-only', content: msg.content }]
                                  : [];

                            return blocks.map((block, bi) => {
                              if (block.type === 'thinking') {
                                const isLastBlock = bi === blocks.length - 1;
                                return (
                                  <ThinkingBlockView
                                    key={block.id}
                                    content={block.content || ''}
                                    isStreaming={isStreamingThisMsg && isLastBlock}
                                    agentId={agentId}
                                    sessionId={session?.id}
                                    apiUrl={API_URL}
                                  />
                                );
                              }
                              if (block.type === 'tool_use') {
                                return <ToolBlockView key={block.id} block={block} />;
                              }
                              if (block.type === 'text') {
                                return (
                                  <div
                                    key={block.id}
                                    className="prose prose-slate prose-sm max-w-none text-[#334155] leading-relaxed [&_p]:mb-3 [&_ul]:mb-3 [&_ol]:mb-3 [&_li]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-[#1e2a4a] [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-[#1e2a4a] [&_h3]:mt-4 [&_h3]:mb-2 [&_strong]:text-[#1e2a4a] [&_pre]:bg-[#f8fafc] [&_pre]:border [&_pre]:border-[#e2e8f0] [&_pre]:rounded-lg [&_pre]:p-4 [&_a]:text-[#3b82f6] [&_a]:no-underline [&_a:hover]:underline"
                                  >
                                    <ReactMarkdown
                                      rehypePlugins={[rehypeRaw]}
                                      components={{
                                        code: ({ children, className: cn, ...props }) => {
                                          if (cn) return <code className={cn} {...props}>{children}</code>;
                                          const t = getTextFromChildren(children).trim();
                                          const mf = findFileMatch(t);
                                          if (mf && looksLikeFilename(t)) {
                                            return (
                                              <button onClick={() => setPreviewFile(mf)} className="px-1.5 py-0.5 bg-[#eff6ff] text-[#3b82f6] rounded text-sm font-mono hover:bg-[#dbeafe] cursor-pointer transition-colors" title={`Preview ${mf.name}`}>
                                                {mf.displayName || mf.name}
                                              </button>
                                            );
                                          }
                                          return <code className="px-1 py-0.5 bg-[#f1f5f9] rounded text-sm" {...props}>{children}</code>;
                                        },
                                        strong: ({ children, ...props }) => {
                                          const t = getTextFromChildren(children).trim();
                                          const mf = findFileMatch(t);
                                          if (mf && looksLikeFilename(t)) {
                                            return (
                                              <button onClick={() => setPreviewFile(mf)} className="font-semibold text-[#3b82f6] hover:underline cursor-pointer" title={`Preview ${mf.name}`}>
                                                {mf.displayName || mf.name}
                                              </button>
                                            );
                                          }
                                          return <strong className="text-[#1e2a4a]" {...props}>{children}</strong>;
                                        },
                                        li: ({ children, ...props }) => (
                                          <li className="flex items-start gap-2.5 list-none mb-2" {...props}>
                                            <svg className="w-4 h-4 text-[#f472b6] mt-1 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                                            </svg>
                                            <span className="flex-1 min-w-0">{children}</span>
                                          </li>
                                        ),
                                        ul: ({ children, ...props }) => <ul className="list-none pl-0 space-y-1 mb-3" {...props}>{children}</ul>,
                                        ol: ({ children, ...props }) => <ol className="list-none pl-0 space-y-1 mb-3" {...props}>{children}</ol>,
                                      }}
                                    >
                                      {block.content || ''}
                                    </ReactMarkdown>
                                  </div>
                                );
                              }
                              return null;
                            });
                          })()}
                          {/* Streaming dots — shown when waiting for first content */}
                          {isSending && idx === messages.length - 1 && streamBlocks.length === 0 && !msg.content && (
                            <div className="streaming-indicator flex items-center gap-2 mt-1">
                              <div className="flex gap-1">
                                <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: buttonColor, animationDelay: '0ms', animationDuration: '1s' }} />
                                <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: buttonColor, animationDelay: '150ms', animationDuration: '1s' }} />
                                <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: buttonColor, animationDelay: '300ms', animationDuration: '1s' }} />
                              </div>
                              <span className="text-xs text-[#94a3b8]">Processing...</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Thinking indicator (before first response appears) */}
                {isSending && messages[messages.length - 1]?.role === 'user' && (
                  <div className="thinking-panel bg-white border border-[#e2e8f0] rounded-xl p-5 shadow-sm border-l-4 border-l-[#c5f467]">
                    <div className="message-header flex items-center gap-2 mb-3">
                      <div className="assistant-avatar w-6 h-6 rounded-full bg-gradient-to-br from-[#c5f467] to-[#22c55e] flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      </div>
                      <span className="assistant-label font-medium text-sm text-[#1e2a4a]">{portalName}</span>
                    </div>
                    <div className="thinking-dots flex items-center gap-3 pl-8">
                      <div className="flex gap-1.5">
                        <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: primaryColor, animationDelay: '0ms', animationDuration: '1.2s' }} />
                        <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: primaryColor, animationDelay: '200ms', animationDuration: '1.2s' }} />
                        <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: primaryColor, animationDelay: '400ms', animationDuration: '1.2s' }} />
                      </div>
                      <span className="text-sm text-[#94a3b8]">Thinking...</span>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Bottom input area */}
            <div className="input-container flex-shrink-0 border-t border-[#e2e8f0] bg-white">
              <div className="max-w-3xl mx-auto px-6 py-3">
                <form onSubmit={handleSubmit}>
                  <div className="input-field flex items-center gap-2 border border-[#e2e8f0] rounded-xl hover:border-[#cbd5e1] transition-all bg-white shadow-sm px-4">
                    <textarea
                      ref={chatInputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (input.trim() && !isSending) {
                            const form = e.currentTarget.closest('form');
                            if (form) form.requestSubmit();
                          }
                        }
                      }}
                      placeholder="Ask a follow up..."
                      rows={1}
                      className="flex-1 py-3.5 text-[15px] text-[#1e2a4a] placeholder-[#94a3b8] bg-transparent border-none focus:outline-none resize-none"
                      style={{ minHeight: '44px', maxHeight: '200px' }}
                      disabled={isSending}
                    />
                    <button
                      type="submit"
                      disabled={!input.trim() || isSending}
                      className="send-button flex-shrink-0 px-4 py-2 text-sm font-medium rounded-lg border-none outline-none text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ backgroundColor: buttonColor }}
                    >
                      {isSending ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        'Ask'
                      )}
                    </button>
                  </div>
                </form>
                <p className="portal-disclaimer text-center text-xs text-[#94a3b8] mt-2">AI can make mistakes; always verify.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ===== File Preview Drawer ===== */}
      {previewFile && session && (
        <>
          {/* Resizable Divider */}
          <div
            className={`flex-shrink-0 w-1 bg-[#e2e8f0] hover:bg-[#3b82f6] transition-colors cursor-col-resize group relative ${
              isResizing ? 'bg-[#3b82f6]' : ''
            }`}
            onMouseDown={handleResizeStart}
          >
            {/* Visual indicator on hover */}
            <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-[#3b82f6]/10" />
          </div>
          
          {/* File Preview Panel */}
          <div style={{ width: `${filePreviewWidth}px` }} className="flex-shrink-0">
            <FilePreviewModal
              fileId={previewFile.id}
              fileName={previewFile.displayName || previewFile.name}
              filePath={previewFile.path || previewFile.name}
              mimeType={previewFile.mime_type || null}
              agentId={agentId!}
              sessionId={session.id}
              apiUrl={API_URL}
              onClose={() => setPreviewFile(null)}
              onDownload={() => {
                window.open(`${API_URL}/api/portal/${agentId}/sessions/${session.id}/files/${previewFile.id}/download`, '_blank');
              }}
              themeColor={primaryColor}
            />
          </div>
        </>
      )}

      {/* ===== Files Sidebar ===== */}
      {showFiles && (
        <div className="files-overlay fixed inset-0 z-50 bg-black/20" onClick={() => setShowFiles(false)}>
          <div
            className="files-sidebar absolute right-0 top-0 bottom-0 w-80 bg-white shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="files-header p-4 border-b border-[#e2e8f0] flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" style={{ color: primaryColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <h3 className="font-semibold text-[#1e2a4a]">Files</h3>
                {files.length > 0 && (
                  <span className="px-1.5 py-0.5 text-xs font-medium rounded-full" style={{ backgroundColor: `${primaryColor}15`, color: primaryColor }}>{files.length}</span>
                )}
              </div>
              <button
                onClick={() => setShowFiles(false)}
                className="p-1.5 text-[#94a3b8] hover:text-[#64748b] hover:bg-[#f1f5f9] rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* File list */}
            <div className="files-list flex-1 overflow-y-auto p-3 space-y-1">
              {files.length === 0 ? (
                <div className="files-empty flex flex-col items-center justify-center py-12 text-center px-4">
                  <div className="w-12 h-12 rounded-full bg-[#f1f5f9] flex items-center justify-center mb-3">
                    <svg className="w-6 h-6 text-[#94a3b8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                  </div>
                  <p className="text-sm text-[#64748b] font-medium">No files available</p>
                  <p className="text-xs text-[#94a3b8] mt-1">Files created during conversations will appear here</p>
                </div>
              ) : (
                files.map(file => (
                  <div
                    key={file.id}
                    className="file-item flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-all text-[#64748b] hover:bg-[#f8fafc] hover:text-[#1e2a4a] group border border-transparent hover:border-[#e2e8f0]"
                  >
                    <button
                      onClick={() => {
                        setPreviewFile(file);
                        setShowFiles(false);
                      }}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <div className="file-icon flex-shrink-0 w-8 h-8 bg-[#f1f5f9] rounded-lg flex items-center justify-center group-hover:bg-[#e2e8f0]">
                        {file.mime_type?.startsWith('image/') ? (
                          <svg className="w-4 h-4 text-[#8b5cf6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        ) : file.mime_type?.includes('pdf') ? (
                          <svg className="w-4 h-4 text-[#ef4444]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        ) : file.mime_type?.includes('spreadsheet') || file.name.endsWith('.csv') || file.name.endsWith('.xlsx') ? (
                          <svg className="w-4 h-4 text-[#22c55e]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        ) : file.name.endsWith('.pptx') || file.name.endsWith('.ppt') ? (
                          <svg className="w-4 h-4 text-[#f97316]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-[#64748b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="file-name truncate font-medium text-[#1e2a4a]">
                          {file.displayName || file.name}
                        </p>
                        {file.size && (
                          <p className="text-xs text-[#94a3b8]">
                            {file.size < 1024 ? `${file.size} B` :
                             file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` :
                             `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
                          </p>
                        )}
                      </div>
                    </button>
                    <a
                      href={`${API_URL}/api/portal/${agentId}/sessions/${session?.id}/files/${file.id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-md hover:bg-[#e2e8f0] transition-colors opacity-0 group-hover:opacity-100"
                      title="Download"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg className="w-4 h-4 text-[#64748b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </a>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PortalSandboxAgentChat;
