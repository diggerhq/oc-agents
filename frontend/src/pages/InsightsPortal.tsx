import React, { useState, useEffect, useRef, FormEvent, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { ShareThreadModal } from '@/components/ShareThreadModal';
import { FilePreviewModal } from '@/components/FilePreviewModal';

const DEFAULT_API_URL = import.meta.env.VITE_API_URL || '';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
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
  portalGreeting?: string | null; // Custom greeting like "Hey there, I'm {name}"
  suggestedQuestions?: string[] | null; // Custom suggested questions
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
  path: string;
  is_folder: boolean;
  mime_type?: string | null;
  size?: number;
}

interface PortalBucket {
  id: string;
  name: string;
  access_type: string;
}

// Thinking/Tool tracking interfaces
interface ThinkingEntry {
  type: 'thinking' | 'tool' | 'tool_result' | 'status';
  content: string;
  timestamp: number;
  id?: string;
  toolName?: string;
  duration?: number;
  isError?: boolean;
  input?: unknown; // Tool input JSON
  result?: unknown; // Tool result JSON
}

interface ToolActivity {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  startTime: number;
  endTime?: number;
  duration?: number;
}

// Get or create visitor ID from localStorage
function getVisitorId(): string {
  const key = 'portal_visitor_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

// Parse assistant response into structured sections
interface ContentItem {
  text: string;
  type: 'bullet' | 'prose';  // 'bullet' for list items, 'prose' for paragraphs
  count?: number;
}

interface InsightSection {
  title: string;
  summary?: string;
  items: ContentItem[];  // Renamed from observations
  expanded?: boolean;
}

interface ParsedInsights {
  summary: string;
  sections: InsightSection[];
}

// Common file extensions to detect
const FILE_EXTENSIONS = /\.(tsx?|jsx?|py|rb|go|rs|java|cs|cpp|c|h|hpp|css|scss|sass|less|html?|xml|json|ya?ml|md|txt|csv|sql|sh|bash|zsh|ps1|dockerfile|gitignore|env|config|conf|ini|toml|lock|log|pdf|pptx?|xlsx?|docx?)$/i;

// Check if a string looks like a filename
function looksLikeFilename(text: string): boolean {
  return FILE_EXTENSIONS.test(text) || text.includes('/') && FILE_EXTENSIONS.test(text);
}

// Format text with inline markdown (bold, code, etc.) and clickable file links
function formatInlineMarkdown(
  text: string, 
  options?: { 
    files?: PortalFile[]; 
    onFileClick?: (file: PortalFile) => void;
  }
): React.ReactNode {
  const { files = [], onFileClick } = options || {};
  
  // Split by **bold** and `code` patterns
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  
  while (remaining.length > 0) {
    // Find the next markdown pattern
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const codeMatch = remaining.match(/`(.+?)`/);
    
    // Find which comes first
    let firstMatch: { match: RegExpMatchArray; type: 'bold' | 'code' } | null = null;
    if (boldMatch && (!codeMatch || (boldMatch.index || 0) < (codeMatch.index || 0))) {
      firstMatch = { match: boldMatch, type: 'bold' };
    } else if (codeMatch) {
      firstMatch = { match: codeMatch, type: 'code' };
    }
    
    if (!firstMatch) {
      // Check for bare filenames in remaining text (e.g., "created filename.tsx", "saved as filename.pptx")
      const bareFileMatch = remaining.match(/(?:created|wrote|generated|saved|updated|modified)(?:\s+as)?\s+(\S+\.\w+)/i);
      if (bareFileMatch && looksLikeFilename(bareFileMatch[1])) {
        const beforeIndex = bareFileMatch.index || 0;
        const filename = bareFileMatch[1];
        const matchedFile = files.find(f => 
          f.name === filename || 
          f.name.endsWith(filename) || 
          f.path?.endsWith(filename)
        );
        
        if (beforeIndex > 0) {
          parts.push(remaining.slice(0, beforeIndex + bareFileMatch[0].indexOf(filename)));
        }
        
        if (matchedFile && onFileClick) {
          parts.push(
            <button
              key={key++}
              onClick={() => onFileClick(matchedFile)}
              className="text-[#3b82f6] hover:underline cursor-pointer font-medium"
              title={`Preview ${filename}`}
            >
              {filename}
            </button>
          );
        } else {
          parts.push(<span key={key++} className="font-medium">{filename}</span>);
        }
        
        remaining = remaining.slice((bareFileMatch.index || 0) + bareFileMatch[0].length);
        continue;
      }
      
      // Check for standalone filenames anywhere in text (e.g., section titles like "Presentation.pptx")
      const standaloneFileMatch = remaining.match(/(\S+\.(tsx?|jsx?|py|rb|go|rs|java|cs|cpp|c|h|hpp|css|scss|sass|less|html?|xml|json|ya?ml|md|txt|csv|sql|sh|bash|zsh|ps1|dockerfile|gitignore|env|config|conf|ini|toml|lock|log|pdf|pptx?|xlsx?|docx?))\b/i);
      if (standaloneFileMatch) {
        const beforeIndex = standaloneFileMatch.index || 0;
        const filename = standaloneFileMatch[1];
        const matchedFile = files.find(f => 
          f.name === filename || 
          f.name.endsWith(filename) || 
          f.path?.endsWith(filename) ||
          filename.endsWith(f.name)
        );
        
        if (beforeIndex > 0) {
          parts.push(remaining.slice(0, beforeIndex));
        }
        
        if (matchedFile && onFileClick) {
          parts.push(
            <button
              key={key++}
              onClick={() => onFileClick(matchedFile)}
              className="text-[#3b82f6] hover:underline cursor-pointer font-medium"
              title={`Preview ${filename}`}
            >
              {filename}
            </button>
          );
        } else {
          // Still show as styled text even if no file match (file might not be synced yet)
          parts.push(<span key={key++} className="font-medium text-[#475569]">{filename}</span>);
        }
        
        remaining = remaining.slice((standaloneFileMatch.index || 0) + standaloneFileMatch[0].length);
        continue;
      }
      
      parts.push(remaining);
      break;
    }
    
    // Add text before the match
    const beforeIndex = firstMatch.match.index || 0;
    if (beforeIndex > 0) {
      parts.push(remaining.slice(0, beforeIndex));
    }
    
    // Add the formatted match
    if (firstMatch.type === 'bold') {
      // Check if bold text is a filename
      const boldContent = firstMatch.match[1];
      const matchedBoldFile = files.find(f => 
        f.name === boldContent || 
        f.name.endsWith(boldContent) || 
        f.path?.endsWith(boldContent) ||
        boldContent.endsWith(f.name)
      );
      
      if (matchedBoldFile && onFileClick && looksLikeFilename(boldContent)) {
        parts.push(
          <button
            key={key++}
            onClick={() => onFileClick(matchedBoldFile)}
            className="font-semibold text-[#3b82f6] hover:underline cursor-pointer"
            title={`Preview ${boldContent}`}
          >
            {boldContent}
          </button>
        );
      } else {
        parts.push(<strong key={key++} className="font-semibold">{boldContent}</strong>);
      }
    } else {
      // Check if this code block contains a filename
      const codeContent = firstMatch.match[1];
      const matchedFile = files.find(f => 
        f.name === codeContent || 
        f.name.endsWith(codeContent) || 
        f.path?.endsWith(codeContent) ||
        codeContent.endsWith(f.name)
      );
      
      if (matchedFile && onFileClick && looksLikeFilename(codeContent)) {
        parts.push(
          <button
            key={key++}
            onClick={() => onFileClick(matchedFile)}
            className="px-1.5 py-0.5 bg-[#eff6ff] text-[#3b82f6] rounded text-sm font-mono hover:bg-[#dbeafe] cursor-pointer transition-colors"
            title={`Preview ${codeContent}`}
          >
            {codeContent}
          </button>
        );
      } else {
        parts.push(<code key={key++} className="px-1 py-0.5 bg-slate-100 rounded text-sm">{codeContent}</code>);
      }
    }
    
    // Continue with the rest
    remaining = remaining.slice(beforeIndex + firstMatch.match[0].length);
  }
  
  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : <>{parts}</>;
}

function parseInsightsFromContent(content: string): ParsedInsights | null {
  const lines = content.split('\n');
  let summary = '';
  const sections: InsightSection[] = [];
  let currentSection: InsightSection | null = null;
  let inSummary = true;
  let proseBuffer: string[] = [];
  
  const flushProseBuffer = () => {
    if (proseBuffer.length > 0 && currentSection) {
      // Join prose lines into a single paragraph
      const proseText = proseBuffer.join(' ').trim();
      if (proseText) {
        currentSection.items.push({ text: proseText, type: 'prose' });
      }
      proseBuffer = [];
    }
  };
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Empty lines flush prose buffer
    if (!trimmed) {
      flushProseBuffer();
      continue;
    }
    
    // Check for section headers (## or ** bold **)
    const h2Match = trimmed.match(/^##\s*(.+)$/);
    const boldMatch = trimmed.match(/^\*\*(.+)\*\*$/);
    const h3Match = trimmed.match(/^###\s*(.+)$/);
    
    if (h2Match || boldMatch || h3Match) {
      inSummary = false;
      flushProseBuffer();
      if (currentSection && currentSection.items.length > 0) {
        sections.push(currentSection);
      }
      const title = (h2Match?.[1] || boldMatch?.[1] || h3Match?.[1] || '').trim();
      currentSection = { title, items: [], expanded: false };
      continue;
    }
    
    // Collect summary text (first paragraph before any headers)
    if (inSummary && !trimmed.startsWith('-') && !trimmed.startsWith('*') && !trimmed.startsWith('•')) {
      summary += (summary ? ' ' : '') + trimmed;
      continue;
    }
    
    // Check for bullet points
    const bulletMatch = trimmed.match(/^[-*•]\s*(.+)$/);
    if (bulletMatch && currentSection) {
      flushProseBuffer(); // Flush any prose before this bullet
      const text = bulletMatch[1].trim();
      // Try to extract count from text like "Issue description (42)"
      const countMatch = text.match(/\s*[\(\[]?(\d+)[\)\]]?\s*$/);
      const count = countMatch ? Number.parseInt(countMatch[1]) : undefined;
      const cleanText = count ? text.replace(/\s*[\(\[]?\d+[\)\]]?\s*$/, '').trim() : text;
      if (cleanText) {
        currentSection.items.push({ text: cleanText, type: 'bullet', count });
      }
    } else if (currentSection && !inSummary) {
      // Non-bullet text - collect as prose
      proseBuffer.push(trimmed);
    }
  }
  
  // Flush any remaining prose
  flushProseBuffer();
  
  if (currentSection && currentSection.items.length > 0) {
    sections.push(currentSection);
  }
  
  // Expand first section by default
  if (sections.length > 0) {
    sections[0].expanded = true;
  }
  
  if (summary || sections.length > 0) {
    return { summary, sections };
  }
  
  return null;
}

export function InsightsPortal() {
  const { agentId } = useParams<{ agentId: string }>();
  const [searchParams] = useSearchParams();
  
  const apiUrlParam = searchParams.get('api');
  const API_URL = apiUrlParam || DEFAULT_API_URL;
  
  // Parse user context from URL params (supports JWT tokens and direct params)
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
        // Not a base64 JSON - treat as opaque token
        context['token'] = tokenParam;
      }
    }

    // Also capture other URL params as context
    searchParams.forEach((value, key) => {
      if (key !== 'token' && key !== 'api') {
        context[key] = value;
      }
    });

    return context;
  }, [searchParams]);
  
  // Stable visitor ID derived from URL params - use this as useEffect dependency
  const visitorIdFromParams = parsedUserContext.user_id || parsedUserContext.user_email || null;
  
  const [config, setConfig] = useState<PortalConfig | null>(null);
  const [session, setSession] = useState<PortalSession | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0]));
  const [showHistory, setShowHistory] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [files, setFiles] = useState<PortalFile[]>([]);
  const [previewFile, setPreviewFile] = useState<PortalFile | null>(null);
  const [, setBuckets] = useState<PortalBucket[]>([]);
  const [thinkingEntries, setThinkingEntries] = useState<ThinkingEntry[]>([]);
  const [, setActiveTools] = useState<ToolActivity[]>([]);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [showToolJson, setShowToolJson] = useState(false);
  const [expandedObservations, setExpandedObservations] = useState<Set<number>>(new Set());
  const [showFullThread, setShowFullThread] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareThreadId, setShareThreadId] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  
  // Auto-resize textarea as user types
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    
    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    // Set height to scrollHeight (content height) with max of 200px
    const newHeight = Math.min(textarea.scrollHeight, 200);
    textarea.style.height = `${newHeight}px`;
  }, [input]);
  
  // Default suggested questions (can be customized per agent via config)
  const defaultSuggestedQuestions = [
    "What can you help me with?",
    "Summarize the key information in my files",
    "Help me analyze the data I've uploaded",
    "What insights can you find in my documents?",
    "Create a report based on my data",
    "Answer questions about my uploaded content",
  ];
  
  // Use custom questions from config if available, otherwise use defaults
  const suggestedQuestions = config?.suggestedQuestions?.length 
    ? config.suggestedQuestions 
    : defaultSuggestedQuestions;

  // Track if we've already initialized to avoid re-creating session on HMR
  const initializedRef = useRef(false);
  const initializedVisitorRef = useRef<string | null>(null);
  
  useEffect(() => {
    async function init() {
      if (!agentId) return;
      
      // Calculate the visitor ID that will be used (use stable param or generate random)
      const currentVisitorId = visitorIdFromParams || getVisitorId();
      
      // Skip if already initialized for the same visitor (e.g., on HMR)
      // But re-initialize if visitor changed (different URL params)
      if (initializedRef.current && session && initializedVisitorRef.current === currentVisitorId) {
        setIsLoading(false);
        return;
      }
      
      // Reset state if switching visitors
      if (initializedVisitorRef.current && initializedVisitorRef.current !== currentVisitorId) {
        console.log('[InsightsPortal] Visitor changed from', initializedVisitorRef.current, 'to', currentVisitorId);
        setIsLoading(true);
        setMessages([]);
        setThreads([]);
        setActiveThread(null);
        setSession(null);
        setThinkingEntries([]);
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
        
        // Use currentVisitorId calculated earlier (user_id/user_email from context, or random ID)
        const visitorId = currentVisitorId;
        
        // Session storage key includes visitor ID so different users get different sessions
        const sessionStorageKey = `insights_session_${agentId}_${visitorId}`;
        
        // Try to restore existing session from sessionStorage
        const storedSessionId = sessionStorage.getItem(sessionStorageKey);
        
        if (storedSessionId) {
          // Verify session still exists
          const verifyRes = await fetch(
            `${API_URL}/api/portal/${agentId}/sessions/${storedSessionId}/threads`
          );
          if (verifyRes.ok) {
            setSession({ id: storedSessionId, agent_id: agentId!, visitor_id: visitorId });
            console.log('[InsightsPortal] Restored existing session for visitor:', visitorId, storedSessionId);
            
            const threadsData = await verifyRes.json();
            setThreads(threadsData.threads);
            initializedRef.current = true;
            initializedVisitorRef.current = visitorId;
            setIsLoading(false);
            return;
          }
        }
        
        // Build session request with token/userContext support
        const token = parsedUserContext.token;
        const requestBody: Record<string, unknown> = { visitorId: visitorId };
        if (token) {
          requestBody.token = token;
        } else if (Object.keys(parsedUserContext).length > 0) {
          requestBody.userContext = parsedUserContext;
        }
        
        // Create new session (or get existing one from backend by visitor_id)
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
        console.log('[InsightsPortal] Session for visitor:', visitorId, sessionData.session.id, sessionData.isExisting ? '(existing)' : '(new)');
        
        // Use threads from response if available (existing session), otherwise fetch
        if (sessionData.threads) {
          setThreads(sessionData.threads);
        } else {
          const threadsRes = await fetch(
            `${API_URL}/api/portal/${agentId}/sessions/${sessionData.session.id}/threads`
          );
          if (threadsRes.ok) {
            const threadsData = await threadsRes.json();
            setThreads(threadsData.threads);
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

  // Fetch files from agent's buckets
  const fetchFiles = async (sessionId: string) => {
    try {
      console.log('[InsightsPortal] Fetching buckets for agent:', agentId, 'session:', sessionId);
      
      // Get buckets first
      const bucketsRes = await fetch(`${API_URL}/api/portal/${agentId}/sessions/${sessionId}/buckets`);
      if (!bucketsRes.ok) {
        console.error('[InsightsPortal] Failed to fetch buckets:', bucketsRes.status, await bucketsRes.text());
        return;
      }
      
      const bucketsData = await bucketsRes.json();
      console.log('[InsightsPortal] Buckets response:', bucketsData);
      setBuckets(bucketsData.buckets || []);
      
      if (!bucketsData.buckets || bucketsData.buckets.length === 0) {
        console.log('[InsightsPortal] No buckets found for this agent');
        return;
      }
      
      // Use only the first visible bucket (simplified - no multi-bucket support)
      const primaryBucket = bucketsData.buckets[0];
      console.log('[InsightsPortal] Using primary bucket:', primaryBucket.id, primaryBucket.name);
      
      const filesRes = await fetch(`${API_URL}/api/portal/${agentId}/sessions/${sessionId}/buckets/${primaryBucket.id}/files`);
      if (filesRes.ok) {
        const filesData = await filesRes.json();
        console.log('[InsightsPortal] Files in primary bucket:', filesData.files?.length || 0);
        const allFiles = (filesData.files || []).map((f: PortalFile) => ({ ...f, bucketName: primaryBucket.name }));
        setFiles(allFiles.filter((f: PortalFile) => !f.is_folder));
      } else {
        console.error('[InsightsPortal] Failed to fetch files from bucket:', primaryBucket.id, filesRes.status);
      }
    } catch (err) {
      console.error('[InsightsPortal] Failed to fetch files:', err);
    }
  };
  
  // Fetch files when session is available
  useEffect(() => {
    if (session?.id && agentId) {
      fetchFiles(session.id);
    }
  }, [session?.id, agentId, API_URL]);

  const loadThread = async (thread: Thread) => {
    if (!session) return;
    
    try {
      const res = await fetch(
        `${API_URL}/api/portal/${agentId}/sessions/${session.id}/threads/${thread.id}/messages`
      );
      
      if (!res.ok) throw new Error('Failed to load messages');
      
      const data = await res.json();
      setActiveThread(thread);
      setMessages(data.messages);
      setExpandedSections(new Set([0]));
      setExpandedObservations(new Set());
      setThinkingEntries([]);
      setShowToolJson(false);
    } catch (err) {
      console.error('Failed to load thread:', err);
    }
  };

  const createNewThread = () => {
    setActiveThread(null);
    setMessages([]);
    setInput('');
    setExpandedSections(new Set([0]));
    setExpandedObservations(new Set());
    setThinkingEntries([]);
    setShowToolJson(false);
    inputRef.current?.focus();
  };

  const handleShareThread = (threadId: string) => {
    setShareThreadId(threadId);
    setShowShareModal(true);
  };

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
    setExpandedSections(new Set([0]));
    setExpandedObservations(new Set());
    // Clear previous thinking state
    setThinkingEntries([]);
    setActiveTools([]);
    setShowToolJson(false);

    const assistantId = crypto.randomUUID();
    let fullContent = '';
    let currentThinkingId: string | undefined = undefined;
    let accumulatedThinking = '';

    try {
      // Create a thread first if we don't have one
      let threadId = activeThread?.id;
      if (!threadId) {
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
      }

      const res = await fetch(
        `${API_URL}/api/portal/${agentId}/sessions/${session.id}/threads/${threadId}/stream`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: question }),
        }
      );

      if (!res.ok) {
        const errorText = await res.text();
        console.error('[InsightsPortal] Stream error:', res.status, errorText, { threadId, sessionId: session.id, agentId });
        throw new Error(`Failed to send message: ${res.status}`);
      }
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
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          try {
            const data = JSON.parse(line.slice(6));
            
            if (data.type === 'text') {
              fullContent += data.content;
              
              if (!assistantMessageCreated) {
                setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: fullContent }]);
                assistantMessageCreated = true;
              } else {
                setMessages(prev => prev.map(m =>
                  m.id === assistantId ? { ...m, content: fullContent } : m
                ));
              }
                            } else if (data.type === 'thinking') {
                              // Tool start/status event - avoid duplicates
                              const toolName = data.content || 'Processing';
                              const toolId = data.toolId || `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                              
                              setThinkingEntries(prev => {
                                const exists = prev.some(e => e.type === 'tool' && e.toolName === toolName);
                                if (exists) return prev;
                                return [...prev, {
                                  type: 'tool',
                                  content: toolName,
                                  timestamp: Date.now(),
                                  id: toolId,
                                  toolName,
                                  input: data.input, // Store tool input for exploration
                                }];
                              });
                              
                              setActiveTools(prev => {
                                const exists = prev.some(t => t.name === toolName);
                                if (exists) return prev;
                                return [...prev, {
                                  id: toolId,
                                  name: toolName,
                                  status: 'running',
                                  startTime: Date.now(),
                                }];
                              });
            } else if (data.type === 'extended_thinking') {
              // Extended thinking content - avoid duplicates
              const newContent = data.content || '';
              if (newContent && !accumulatedThinking.endsWith(newContent)) {
                accumulatedThinking += newContent;
                
                if (!currentThinkingId) {
                  currentThinkingId = `thinking-${Date.now()}`;
                  setThinkingEntries(prev => [...prev, {
                    type: 'thinking',
                    content: accumulatedThinking,
                    timestamp: Date.now(),
                    id: currentThinkingId,
                  }]);
                } else {
                  setThinkingEntries(prev => prev.map(e =>
                    e.id === currentThinkingId ? { ...e, content: accumulatedThinking } : e
                  ));
                }
              }
                            } else if (data.type === 'tool_result') {
                              // Tool completed - update the tool entry with result data
                              const toolName = data.toolName || data.tool || 'Task';
                              const toolId = data.toolId;
                              
                              setThinkingEntries(prev => {
                                // First, try to update existing tool entry with result
                                const existingIdx = prev.findIndex(e => 
                                  (e.type === 'tool' && (e.id === toolId || e.toolName === toolName))
                                );
                                
                                if (existingIdx >= 0) {
                                  // Update existing entry with result
                                  const updated = [...prev];
                                  updated[existingIdx] = {
                                    ...updated[existingIdx],
                                    type: 'tool_result',
                                    result: data.result,
                                    input: data.input || updated[existingIdx].input,
                                    duration: data.duration,
                                    isError: data.isError,
                                  };
                                  return updated;
                                }
                                
                                // Otherwise add new entry
                                const exists = prev.some(e => e.type === 'tool_result' && e.toolName === toolName);
                                if (exists) return prev;
                                return [...prev, {
                                  type: 'tool_result',
                                  content: toolName,
                                  timestamp: Date.now(),
                                  toolName,
                                  input: data.input,
                                  result: data.result,
                                  duration: data.duration,
                                  isError: data.isError,
                                }];
                              });
                              
                              setActiveTools(prev => prev.map(t => 
                                t.status === 'running' ? { ...t, status: 'completed' as const, endTime: Date.now() } : t
                              ));
            } else if (data.type === 'done') {
              // Clear active tools when done
              setActiveTools([]);
              currentThinkingId = undefined;
              accumulatedThinking = '';
            } else if (data.type === 'file_created') {
              // Add newly created file to the files list
              console.log('[InsightsPortal] File created event received:', data.file);
              if (data.file) {
                setFiles(prev => {
                  // Avoid duplicates
                  if (prev.some(f => f.id === data.file.id)) {
                    console.log('[InsightsPortal] File already exists, skipping:', data.file.name);
                    return prev;
                  }
                  console.log('[InsightsPortal] Adding file to list:', data.file.name);
                  return [...prev, {
                    id: data.file.id,
                    name: data.file.name,
                    path: data.file.path,
                    bucket_id: data.file.bucket_id,
                    bucketName: data.file.bucket_name,
                    mime_type: data.file.mime_type,
                    size: data.file.size,
                    is_folder: false,
                  }];
                });
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
      
      // Refresh threads list
      const threadsRes = await fetch(
        `${API_URL}/api/portal/${agentId}/sessions/${session.id}/threads`
      );
      if (threadsRes.ok) {
        const data = await threadsRes.json();
        setThreads(data.threads);
      }
      
      // Refresh files list to pick up any new files created by the agent
      await fetchFiles(session.id);
      
    } catch (err) {
      console.error('Failed to send:', err);
      setMessages(prev => prev.filter(m => m.id !== assistantId));
    } finally {
      setIsSending(false);
      setActiveTools([]);
    }
  };

  const toggleSection = (index: number) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Get the last assistant message for displaying insights
  const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  const insights = lastAssistantMessage ? parseInsightsFromContent(lastAssistantMessage.content) : null;

  // Expand all sections and observations by default when insights change
  useEffect(() => {
    if (insights?.sections) {
      // Expand all sections
      setExpandedSections(new Set(insights.sections.map((_, idx) => idx)));
      // Expand all observations
      setExpandedObservations(new Set(insights.sections.map((_, idx) => idx)));
    }
  }, [insights?.sections?.length]);

  // Portal name
  const portalName = config?.portalName || config?.agentName || config?.name || 'AI Assistant';

  // Theme colors (defaults)
  const theme = config?.theme || {};
  const primaryColor = theme.primaryColor || '#3b5998';
  const buttonColor = theme.buttonColor || '#3b5998';

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <div className="text-center max-w-md mx-auto px-4">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-slate-800 mb-2">Unable to Load Portal</h1>
          <p className="text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="insights-portal min-h-screen bg-white" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Custom CSS injection + scrollbar overrides */}
      {config?.customCSS && <style>{config.customCSS}</style>}
      <style>{`
        .insights-portal *::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .insights-portal *::-webkit-scrollbar-track {
          background: transparent;
        }
        .insights-portal *::-webkit-scrollbar-thumb {
          background: rgba(0,0,0,0.15);
          border-radius: 3px;
        }
        .insights-portal *::-webkit-scrollbar-thumb:hover {
          background: rgba(0,0,0,0.25);
        }
        .insights-portal * {
          scrollbar-width: thin;
          scrollbar-color: rgba(0,0,0,0.15) transparent;
        }
      `}</style>
      
      <div className="insights-portal-content max-w-3xl mx-auto px-6 py-10">
        {/* Header with nav buttons */}
        <div className="insights-header flex items-start justify-between mb-2">
          {/* Left: Conversations button */}
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`insights-btn-conversations flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              showHistory 
                ? 'bg-[#eff6ff] text-[#3b82f6]' 
                : 'text-[#64748b] hover:bg-[#f8fafc] hover:text-[#1e2a4a]'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
            <span className="text-sm font-medium">Conversations</span>
            {threads.length > 0 && (
              <span className="px-1.5 py-0.5 text-xs font-medium bg-[#e2e8f0] text-[#64748b] rounded-full">
                {threads.length}
              </span>
            )}
          </button>
          
          {/* Center: Logo & Title */}
          <div className="insights-greeting text-center flex-1 px-4">
            {config?.logoUrl && (
              <img src={config.logoUrl} alt="" className="insights-logo h-8 w-auto mx-auto mb-4" />
            )}
            <h1 className="insights-title text-2xl font-semibold text-[#1e2a4a]">
              {config?.portalGreeting 
                ? config.portalGreeting.replace('{name}', portalName)
                : `Hey there, I'm ${portalName}`}
              <span 
                className="insights-badge ml-2 inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full"
                style={{ backgroundColor: `${primaryColor}20`, color: primaryColor }}
              >
                Beta
              </span>
            </h1>
            <p className="insights-subtitle text-[#64748b] mt-1">
              {config?.greeting || "I can help you find insights in your customer feedback."}
            </p>
          </div>
          
          {/* Right: Files button */}
          <button
            onClick={() => setShowFiles(!showFiles)}
            className={`insights-btn-files flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              showFiles 
                ? 'bg-[#eff6ff] text-[#3b82f6]' 
                : 'text-[#64748b] hover:bg-[#f8fafc] hover:text-[#1e2a4a]'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className="text-sm font-medium">Files</span>
            {files.length > 0 && (
              <span className="px-1.5 py-0.5 text-xs font-medium bg-[#e2e8f0] text-[#64748b] rounded-full">
                {files.length}
              </span>
            )}
          </button>
        </div>

        {/* Search Input */}
        <form onSubmit={handleSubmit} className="insights-input mt-6 mb-8">
          <div className="insights-input-box relative flex items-center bg-white border border-[#e2e8f0] rounded-xl shadow-sm hover:border-[#cbd5e1] focus-within:border-[#3b82f6] focus-within:ring-2 focus-within:ring-[#3b82f6]/20 transition-all">
            {input && (
              <button
                type="button"
                onClick={() => setInput('')}
                className="insights-input-clear ml-3 p-1 text-[#94a3b8] hover:text-[#64748b]"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
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
              className="insights-input-textarea flex-1 px-4 py-3.5 text-[#1e2a4a] placeholder-[#94a3b8] bg-transparent border-none focus:outline-none text-[15px] resize-none"
              style={{ minHeight: '80px', maxHeight: '300px', overflow: 'auto' }}
              disabled={isSending}
            />
            <button
              type="submit"
              disabled={!input.trim() || isSending}
              className="insights-input-submit mr-2 px-5 py-2 text-white font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm"
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

        {/* Results Area */}
        {messages.length > 0 ? (
          <div className="insights-results space-y-4">
            {/* Filters bar - only show if we have results */}
            {lastAssistantMessage && (
              <div className="insights-filters bg-white border border-[#e2e8f0] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-[#1e2a4a]">Your question</p>
                  {/* Thread toggle */}
                  {messages.length > 2 && (
                    <button
                      onClick={() => setShowFullThread(!showFullThread)}
                      className={`insights-btn-thread flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        showFullThread 
                          ? 'bg-[#3b82f6] text-white' 
                          : 'bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0]'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                      </svg>
                      {showFullThread ? 'Show latest' : `View thread (${Math.floor(messages.length / 2)})`}
                    </button>
                  )}
                </div>
                
                <p className="text-[#334155] text-sm leading-relaxed whitespace-pre-wrap">{lastUserMessage?.content}</p>
              </div>
            )}

            {/* Thinking Panel */}
            {(isSending || thinkingEntries.length > 0) && (
              <div className="insights-thinking bg-white border border-[#e2e8f0] rounded-xl overflow-hidden shadow-sm">
                <div className="px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isSending ? (
                      <div className="w-4 h-4 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-4 h-4 text-[#22c55e]" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                      </svg>
                    )}
                    <span className="font-medium text-[#1e2a4a] text-sm">
                      {isSending ? `${portalName} is thinking...` : `${portalName} finished thinking`}
                    </span>
                    {thinkingEntries.filter(e => e.type === 'tool' || e.type === 'tool_result').length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowToolJson(!showToolJson);
                        }}
                        className={`text-xs px-2 py-1 rounded-md transition-colors ${
                          showToolJson 
                            ? 'bg-[#3b82f6] text-white' 
                            : 'text-[#3b82f6] hover:bg-[#eff6ff]'
                        }`}
                      >
                        ({thinkingEntries.filter(e => e.type === 'tool' || e.type === 'tool_result').length} tools used)
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => setThinkingExpanded(!thinkingExpanded)}
                    className="p-1.5 rounded hover:bg-[#f1f5f9] transition-colors"
                  >
                    <svg 
                      className={`w-4 h-4 text-[#94a3b8] transition-transform ${thinkingExpanded ? 'rotate-180' : ''}`} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                
                {/* Tool JSON View - shows when "(N tools used)" is clicked */}
                {showToolJson && (
                  <div className="border-t border-[#f1f5f9] px-5 py-4 bg-[#fafafa] max-h-[500px] overflow-y-auto">
                    <div className="space-y-4">
                      {thinkingEntries
                        .filter(e => e.type === 'tool' || e.type === 'tool_result')
                        .map((entry, idx) => (
                          <div key={idx} className="bg-white border border-[#e2e8f0] rounded-lg overflow-hidden">
                            <div className="px-4 py-2 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center gap-2">
                              {entry.type === 'tool_result' ? (
                                <svg className="w-4 h-4 text-[#22c55e]" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                                </svg>
                              ) : (
                                <svg className="w-4 h-4 text-[#3b82f6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                              )}
                              <span className="font-medium text-[#1e2a4a] text-sm">{entry.toolName}</span>
                              {entry.duration && (
                                <span className="text-xs text-[#94a3b8] ml-auto">{entry.duration}ms</span>
                              )}
                            </div>
                            <div className="p-3 space-y-3">
                              {entry.input !== undefined && entry.input !== null ? (
                                <div>
                                  <div className="text-xs font-medium text-[#64748b] mb-1">Input</div>
                                  <pre className="text-xs bg-[#f8fafc] p-3 rounded-md overflow-x-auto text-[#334155] whitespace-pre-wrap break-words">
                                    {typeof entry.input === 'string' 
                                      ? entry.input 
                                      : JSON.stringify(entry.input, null, 2)}
                                  </pre>
                                </div>
                              ) : null}
                              {entry.result !== undefined && entry.result !== null ? (
                                <div>
                                  <div className="text-xs font-medium text-[#64748b] mb-1">Result</div>
                                  <pre className="text-xs bg-[#f8fafc] p-3 rounded-md overflow-x-auto text-[#334155] whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                                    {typeof entry.result === 'string' 
                                      ? (entry.result.length > 2000 ? entry.result.slice(0, 2000) + '...\n[truncated]' : entry.result)
                                      : JSON.stringify(entry.result, null, 2)}
                                  </pre>
                                </div>
                              ) : null}
                              {entry.input === undefined && entry.result === undefined && (
                                <div className="text-xs text-[#94a3b8] italic">
                                  {entry.type === 'tool' ? 'Running...' : 'No data available'}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
                
                {/* Simple tool list view - shows when expanded chevron is clicked */}
                {thinkingExpanded && !showToolJson && thinkingEntries.length > 0 && (
                  <div className="border-t border-[#f1f5f9] px-5 py-3 bg-[#f8fafc] max-h-96 overflow-y-auto">
                    <div className="space-y-3">
                      {thinkingEntries.map((entry, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-sm">
                          {entry.type === 'thinking' ? (
                            <>
                              <svg className="w-4 h-4 text-[#a855f7] mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                              </svg>
                              <div className="text-[#64748b] whitespace-pre-wrap break-words flex-1">{entry.content}</div>
                            </>
                          ) : entry.type === 'tool' ? (
                            <>
                              <svg className="w-4 h-4 text-[#3b82f6] mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              <span className="text-[#1e2a4a]">{entry.toolName || entry.content}</span>
                            </>
                          ) : entry.type === 'tool_result' ? (
                            <>
                              <svg className="w-4 h-4 text-[#22c55e] mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                              </svg>
                              <span className="text-[#64748b]">{entry.toolName || 'Task'} completed</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 text-[#94a3b8] mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span className="text-[#64748b]">{entry.content}</span>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Full Thread View */}
            {showFullThread && messages.length > 2 && (
              <div className="space-y-4">
                {messages.slice(0, -2).map((msg, idx) => {
                  const isUser = msg.role === 'user';
                  return (
                    <div 
                      key={idx}
                      className={`bg-white border border-[#e2e8f0] rounded-xl p-4 shadow-sm ${
                        isUser ? 'border-l-4 border-l-[#3b82f6]' : 'border-l-4 border-l-[#c5f467]'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        {isUser ? (
                          <>
                            <div className="w-6 h-6 rounded-full bg-[#3b82f6] flex items-center justify-center">
                              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                            </div>
                            <span className="font-medium text-sm text-[#1e2a4a]">You</span>
                          </>
                        ) : (
                          <>
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#c5f467] to-[#22c55e] flex items-center justify-center">
                              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                              </svg>
                            </div>
                            <span className="font-medium text-sm text-[#1e2a4a]">{portalName}</span>
                          </>
                        )}
                      </div>
                      <div className="prose prose-slate prose-sm max-w-none text-[#334155] pl-8">
                        {isUser ? (
                          <p className="text-[15px]">{msg.content}</p>
                        ) : (
                          <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                            {msg.content}
                          </ReactMarkdown>
                        )}
                      </div>
                    </div>
                  );
                })}
                
                {/* Divider */}
                <div className="flex items-center gap-3 my-2">
                  <div className="flex-1 h-px bg-[#e2e8f0]" />
                  <span className="text-xs font-medium text-[#94a3b8] uppercase tracking-wider">Latest response</span>
                  <div className="flex-1 h-px bg-[#e2e8f0]" />
                </div>
              </div>
            )}

            {/* Response Card - shows while streaming */}
            {insights ? (
              <div className="insights-summary bg-white border border-[#e2e8f0] rounded-xl overflow-hidden shadow-sm">
                {/* Response Section */}
                <div className="insights-summary-header p-5 border-l-4 border-[#dbeafe]">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 mb-3">
                      <svg className="w-5 h-5 text-[#3b82f6]" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                      </svg>
                      <span className="font-semibold text-[#1e2a4a]">Response</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button className="p-1.5 text-[#94a3b8] hover:text-[#64748b] hover:bg-slate-100 rounded">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                        </svg>
                      </button>
                      <button className="p-1.5 text-[#94a3b8] hover:text-[#64748b] hover:bg-slate-100 rounded">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <p className="text-[#334155] leading-relaxed text-[15px] break-words">
                    {formatInlineMarkdown(
                      insights.summary || (lastAssistantMessage?.content.slice(0, 500) + (lastAssistantMessage?.content && lastAssistantMessage.content.length > 500 ? '...' : '')),
                      { files, onFileClick: setPreviewFile }
                    )}
                  </p>
                  {/* Animated dots to show still processing */}
                  {isSending && (
                    <div className="flex items-center gap-2.5 mt-3 pt-3 border-t border-[#f1f5f9]">
                      <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: buttonColor, animationDelay: '0ms', animationDuration: '1s' }} />
                        <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: buttonColor, animationDelay: '150ms', animationDuration: '1s' }} />
                        <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: buttonColor, animationDelay: '300ms', animationDuration: '1s' }} />
                      </div>
                      <span className="text-xs text-[#94a3b8]">Processing...</span>
                    </div>
                  )}
                </div>

                {/* Insight Sections */}
                {insights.sections.map((section, idx) => (
                  <div key={idx} className="insights-section border-t border-[#f1f5f9]">
                    <button
                      onClick={() => toggleSection(idx)}
                      className="w-full px-5 py-4 flex items-center justify-between hover:bg-[#f8fafc] transition-colors text-left"
                    >
                      <h4 className="font-semibold text-[#1e2a4a] text-[15px]">{formatInlineMarkdown(section.title, { files, onFileClick: setPreviewFile })}</h4>
                      <svg 
                        className={`w-5 h-5 text-[#94a3b8] transition-transform ${expandedSections.has(idx) ? 'rotate-180' : ''}`} 
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    
                    {expandedSections.has(idx) && (
                      <div className="px-5 pb-4 space-y-3">
                        {section.summary && (
                          <p className="text-[#64748b] text-sm mb-3">{formatInlineMarkdown(section.summary, { files, onFileClick: setPreviewFile })}</p>
                        )}
                        {(() => {
                          // Count bullet items to decide rendering style
                          const bulletItems = section.items.filter(item => item.type === 'bullet');
                          const showAsList = bulletItems.length >= 2;
                          const itemsToShow = expandedObservations.has(idx) ? section.items : section.items.slice(0, 5);
                          
                          return itemsToShow.map((item, itemIdx) => {
                            // Render prose items as regular paragraphs
                            if (item.type === 'prose') {
                              return (
                                <p key={itemIdx} className="text-[#334155] text-[15px] leading-relaxed break-words">
                                  {formatInlineMarkdown(item.text, { files, onFileClick: setPreviewFile })}
                                </p>
                              );
                            }
                            
                            // Render bullet items - with checkmarks only if there are 2+ bullet items
                            if (showAsList) {
                              return (
                                <div key={itemIdx} className="flex items-start gap-3 group min-w-0">
                                  <div className="mt-1.5 w-4 h-4 flex items-center justify-center flex-shrink-0">
                                    <svg className="w-4 h-4 text-[#f472b6]" viewBox="0 0 24 24" fill="currentColor">
                                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                                    </svg>
                                  </div>
                                  <span className="text-[#334155] text-[15px] flex-1 min-w-0 break-words">{formatInlineMarkdown(item.text, { files, onFileClick: setPreviewFile })}</span>
                                  {item.count && (
                                    <span className="text-[#94a3b8] text-sm font-medium flex-shrink-0">{item.count}</span>
                                  )}
                                </div>
                              );
                            }
                            
                            // Single bullet item - render as paragraph (no bullet styling)
                            return (
                              <p key={itemIdx} className="text-[15px] leading-relaxed break-words">
                                {formatInlineMarkdown(item.text, { files, onFileClick: setPreviewFile })}
                                {item.count && <span className="text-[#94a3b8] text-sm font-medium ml-2">({item.count})</span>}
                              </p>
                            );
                          });
                        })()}
                        {section.items.length > 5 && (
                          <button 
                            onClick={() => {
                              setExpandedObservations(prev => {
                                const next = new Set(prev);
                                if (next.has(idx)) {
                                  next.delete(idx);
                                } else {
                                  next.add(idx);
                                }
                                return next;
                              });
                            }}
                            className="text-sm text-[#3b82f6] hover:underline"
                          >
                            {expandedObservations.has(idx) 
                              ? 'Show less' 
                              : `+${section.items.length - 5} more`
                            }
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : lastAssistantMessage ? (
              /* Fallback to markdown if can't parse structure - shows while streaming */
              <div className="bg-white border border-[#e2e8f0] rounded-xl p-5 shadow-sm border-l-4 border-l-[#dbeafe]">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-[#3b82f6]" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                  </svg>
                  <span className="font-semibold text-[#1e2a4a]">Response</span>
                </div>
                <div className="prose prose-slate prose-sm max-w-none text-[#334155]">
                  <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                    {lastAssistantMessage.content}
                  </ReactMarkdown>
                </div>
              </div>
            ) : null}
            
            <div ref={messagesEndRef} />
          </div>
        ) : (
          /* Previously Asked Questions */
          <div className="insights-suggested">
            <div className="insights-suggested-header flex items-center gap-2 text-[#64748b] text-sm mb-4">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium">Previously asked questions</span>
            </div>
            <div className="insights-suggested-list space-y-2">
              {suggestedQuestions.map((question, idx) => (
                <button
                  key={idx}
                  onClick={(e) => {
                    setInput(question);
                    handleSubmit(e as unknown as FormEvent, question);
                  }}
                  className="insights-suggested-item w-full text-left px-4 py-3.5 bg-white rounded-xl border border-[#e2e8f0] text-[#334155] hover:border-[#cbd5e1] hover:shadow-sm transition-all group flex items-center justify-between"
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
        )}

        {/* Threads Sidebar (Left) */}
        {showHistory && (
          <div className="insights-sidebar-overlay fixed inset-0 z-50 bg-black/20" onClick={() => setShowHistory(false)}>
            <div 
              className="insights-sidebar-history absolute left-0 top-0 bottom-0 w-72 bg-white shadow-2xl flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-4 border-b border-[#e2e8f0] flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-[#3b82f6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  <h3 className="font-semibold text-[#1e2a4a]">Conversations</h3>
                </div>
                <button
                  onClick={() => setShowHistory(false)}
                  className="p-1.5 text-[#94a3b8] hover:text-[#64748b] hover:bg-slate-100 rounded"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* New conversation button */}
              <div className="p-3 border-b border-[#f1f5f9] flex-shrink-0">
                <button
                  onClick={() => {
                    createNewThread();
                    setShowHistory(false);
                  }}
                  className="w-full px-4 py-2.5 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                  style={{ backgroundColor: primaryColor, color: 'white' }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New conversation
                </button>
              </div>
              
              {/* Thread list */}
              <div className="flex-1 overflow-y-auto p-2">
                {threads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center px-4">
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
                      <div
                        key={thread.id}
                        onClick={() => {
                          loadThread(thread);
                          setShowHistory(false);
                        }}
                        className={`w-full px-3 py-3 text-left text-sm rounded-lg transition-all group cursor-pointer ${
                          activeThread?.id === thread.id
                            ? 'bg-[#eff6ff] border border-[#bfdbfe]'
                            : 'hover:bg-[#f8fafc] border border-transparent'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            activeThread?.id === thread.id 
                              ? 'bg-[#3b82f6] text-white' 
                              : 'bg-[#f1f5f9] text-[#64748b] group-hover:bg-[#e2e8f0]'
                          }`}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`truncate font-medium ${
                              activeThread?.id === thread.id ? 'text-[#1e40af]' : 'text-[#1e2a4a]'
                            }`}>
                              {thread.title || 'Untitled conversation'}
                            </p>
                            <p className="text-xs text-[#94a3b8] mt-0.5">
                              {new Date(thread.created_at).toLocaleDateString('en-US', { 
                                month: 'short', 
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit'
                              })}
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleShareThread(thread.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1.5 text-[#94a3b8] hover:text-[#3b82f6] hover:bg-[#eff6ff] rounded transition-all"
                            title="Share thread"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Files Sidebar */}
        {showFiles && (
          <div className="insights-sidebar-overlay fixed inset-0 z-50 bg-black/20" onClick={() => setShowFiles(false)}>
            <div 
              className="insights-sidebar-files absolute right-0 top-0 bottom-0 w-80 bg-white shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 border-b border-[#e2e8f0] flex items-center justify-between">
                <h3 className="font-semibold text-[#1e2a4a]">Files</h3>
                <button
                  onClick={() => setShowFiles(false)}
                  className="p-1.5 text-[#94a3b8] hover:text-[#64748b] hover:bg-slate-100 rounded"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-3 space-y-1 overflow-y-auto max-h-[calc(100vh-60px)]">
                {files.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                    <div className="w-12 h-12 rounded-full bg-[#f1f5f9] flex items-center justify-center mb-3">
                      <svg className="w-6 h-6 text-[#94a3b8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    </div>
                    <p className="text-sm text-[#64748b] font-medium">No files available</p>
                    <p className="text-xs text-[#94a3b8] mt-1">Files uploaded to this agent will appear here</p>
                  </div>
                ) : (
                  files.map(file => (
                    <div
                      key={file.id}
                      className="flex items-center gap-3 px-3 py-2.5 text-left text-sm rounded-lg transition-colors text-[#64748b] hover:bg-[#f8fafc] hover:text-[#1e2a4a] group"
                    >
                      <button
                        onClick={() => setPreviewFile(file)}
                        className="flex items-center gap-3 flex-1 min-w-0 text-left"
                      >
                        <div className="flex-shrink-0 w-8 h-8 bg-[#f1f5f9] rounded-lg flex items-center justify-center group-hover:bg-[#e2e8f0]">
                          {file.mime_type?.startsWith('image/') ? (
                            <svg className="w-4 h-4 text-[#64748b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                          ) : (
                            <svg className="w-4 h-4 text-[#64748b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="truncate font-medium text-[#1e2a4a]">{file.name}</p>
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

        {/* Share Thread Modal */}
        {showShareModal && shareThreadId && session && (
          <ShareThreadModal
            agentId={agentId!}
            sessionId={session.id}
            threadId={shareThreadId}
            threadTitle={threads.find(t => t.id === shareThreadId)?.title || 'Thread'}
            apiUrl={API_URL}
            onClose={() => {
              setShowShareModal(false);
              setShareThreadId(null);
            }}
            themeColor={primaryColor}
          />
        )}

        {/* File Preview Modal */}
        {previewFile && session && (
          <FilePreviewModal
            fileId={previewFile.id}
            fileName={previewFile.name}
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
        )}
      </div>
    </div>
  );
}

export default InsightsPortal;
