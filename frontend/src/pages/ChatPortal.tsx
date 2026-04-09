import React, { useState, useEffect, useRef, FormEvent, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { ShareThreadModal } from '@/components/ShareThreadModal';
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

interface ThinkingEntry {
  type: 'thinking' | 'tool' | 'tool_result' | 'status';
  content: string;
  timestamp: number;
  id?: string;
  toolName?: string;
  duration?: number;
  isError?: boolean;
  input?: unknown;
  result?: unknown;
}

interface ToolActivity {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  startTime: number;
  endTime?: number;
  duration?: number;
}

// ---------- Helpers ----------

// Common file extensions to detect
const FILE_EXTENSIONS = /\.(tsx?|jsx?|py|rb|go|rs|java|cs|cpp|c|h|hpp|css|scss|sass|less|html?|xml|json|ya?ml|md|txt|csv|sql|sh|bash|zsh|ps1|dockerfile|gitignore|env|config|conf|ini|toml|lock|log|pdf|pptx?|xlsx?|docx?|png|jpe?g|gif|svg|webp|bmp|ico|tiff?|mp3|mp4|wav|avi|mov|zip|tar|gz|rar|7z)$/i;

function looksLikeFilename(text: string): boolean {
  return FILE_EXTENSIONS.test(text) || (text.includes('/') && FILE_EXTENSIONS.test(text));
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

// ---------- Component ----------

// Parse persisted thinking_content JSON into ThinkingEntry array
function parseThinkingContent(thinkingContent?: string): ThinkingEntry[] {
  if (!thinkingContent) return [];
  try {
    const parsed = JSON.parse(thinkingContent);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    // Legacy format: raw thinking text
    if (thinkingContent.trim()) {
      return [{ type: 'thinking', content: thinkingContent, timestamp: 0 }];
    }
    return [];
  }
}

// Per-message thinking panel component
function MessageThinkingPanel({ 
  entries, 
  portalName,
  primaryColor,
}: { 
  entries: ThinkingEntry[];
  portalName: string;
  primaryColor: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showJson, setShowJson] = useState(false);

  if (entries.length === 0) return null;

  const toolEntries = entries.filter(e => e.type === 'tool' || e.type === 'tool_result');
  const thinkingEntryItems = entries.filter(e => e.type === 'thinking');

  return (
    <div className="mt-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-[#f1f5f9] transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-[#22c55e]" fill="currentColor" viewBox="0 0 24 24">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
          </svg>
          <span className="text-xs font-medium text-[#334155]">
            {portalName} thinking & tools
          </span>
          {toolEntries.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); setShowJson(!showJson); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setShowJson(!showJson); } }}
              className={`text-xs px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
                showJson ? 'bg-[#3b82f6] text-white' : 'text-[#3b82f6] bg-[#eff6ff] hover:bg-[#dbeafe]'
              }`}
            >
              {toolEntries.length} tool{toolEntries.length !== 1 ? 's' : ''}
            </span>
          )}
          {thinkingEntryItems.length > 0 && (
            <span className="text-xs text-[#94a3b8]">
              {thinkingEntryItems.length} thought{thinkingEntryItems.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <svg
          className={`w-3.5 h-3.5 text-[#94a3b8] transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Tool JSON detail view */}
      {showJson && (
        <div className="border-t border-[#e2e8f0] px-4 py-3 bg-white max-h-[400px] overflow-y-auto">
          <div className="space-y-3">
            {toolEntries.map((entry, i) => (
              <div key={i} className="bg-[#f8fafc] border border-[#e2e8f0] rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-[#f1f5f9] border-b border-[#e2e8f0] flex items-center gap-2">
                  {entry.type === 'tool_result' ? (
                    <svg className="w-3.5 h-3.5 text-[#22c55e]" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" style={{ color: primaryColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                  <span className="text-xs font-medium text-[#334155]">{entry.toolName}</span>
                  {entry.duration && (
                    <span className="text-xs text-[#94a3b8] ml-auto">{entry.duration}ms</span>
                  )}
                </div>
                <div className="p-2.5 space-y-2">
                  {entry.input !== undefined && entry.input !== null && (
                    <div>
                      <div className="text-xs font-medium text-[#64748b] mb-1">Input</div>
                      <pre className="text-xs bg-white p-2.5 rounded border border-[#e2e8f0] overflow-x-auto text-[#334155] whitespace-pre-wrap break-words">
                        {typeof entry.input === 'string' ? entry.input : JSON.stringify(entry.input, null, 2)}
                      </pre>
                    </div>
                  )}
                  {entry.result !== undefined && entry.result !== null && (
                    <div>
                      <div className="text-xs font-medium text-[#64748b] mb-1">Result</div>
                      <pre className="text-xs bg-white p-2.5 rounded border border-[#e2e8f0] overflow-x-auto text-[#334155] whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                        {typeof entry.result === 'string'
                          ? (entry.result.length > 2000 ? entry.result.slice(0, 2000) + '...\n[truncated]' : entry.result)
                          : JSON.stringify(entry.result, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expanded thinking list view */}
      {expanded && !showJson && (
        <div className="border-t border-[#e2e8f0] px-4 py-3 max-h-[500px] overflow-y-auto">
          <div className="space-y-3">
            {entries.map((entry, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                {entry.type === 'thinking' ? (
                  <>
                    <svg className="w-3.5 h-3.5 text-[#a855f7] mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    <div className="text-[#64748b] whitespace-pre-wrap break-words flex-1">{entry.content}</div>
                  </>
                ) : entry.type === 'tool' ? (
                  <>
                    <svg className="w-3.5 h-3.5 text-[#3b82f6] mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="text-[#334155]">{entry.toolName || entry.content}</span>
                  </>
                ) : entry.type === 'tool_result' ? (
                  <>
                    <svg className="w-3.5 h-3.5 text-[#22c55e] mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                    </svg>
                    <span className="text-[#64748b]">{entry.toolName || 'Task'} completed{entry.duration ? ` (${entry.duration}ms)` : ''}</span>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ChatPortal() {
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
  const [previewFile, setPreviewFile] = useState<PortalFile | null>(null);
  const [, setBuckets] = useState<PortalBucket[]>([]);
  const [thinkingEntries, setThinkingEntries] = useState<ThinkingEntry[]>([]);
  const [, setActiveTools] = useState<ToolActivity[]>([]);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareThreadId, setShareThreadId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showFiles, setShowFiles] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const thinkingEntriesRef = useRef<ThinkingEntry[]>([]);

  // Keep ref in sync with state so we can access latest entries in async closures
  useEffect(() => {
    thinkingEntriesRef.current = thinkingEntries;
  }, [thinkingEntries]);

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

        const visitorId = currentVisitorId;
        const sessionStorageKey = `chat_portal_session_${agentId}_${visitorId}`;
        const storedSessionId = sessionStorage.getItem(sessionStorageKey);

        if (storedSessionId) {
          const verifyRes = await fetch(
            `${API_URL}/api/portal/${agentId}/sessions/${storedSessionId}/threads`
          );
          if (verifyRes.ok) {
            setSession({ id: storedSessionId, agent_id: agentId!, visitor_id: visitorId });
            const threadsData = await verifyRes.json();
            setThreads(threadsData.threads);
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

  // ---------- Eager Sandbox Warmup ----------
  // Spin up the sandbox as soon as the portal session is established,
  // so it's ready before the user sends their first message.
  const warmupTriggeredRef = useRef(false);

  useEffect(() => {
    if (!session?.id || !agentId || warmupTriggeredRef.current) return;
    warmupTriggeredRef.current = true;

    console.log('[ChatPortal] Triggering eager sandbox warmup for', session.id);
    fetch(`${API_URL}/api/portal/${agentId}/sessions/${session.id}/warmup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(res => res.json())
      .then(data => {
        console.log('[ChatPortal] Sandbox warmup result:', data.status || data.error);
      })
      .catch(err => {
        console.warn('[ChatPortal] Sandbox warmup failed (will retry on first message):', err.message);
      });
  }, [session?.id, agentId, API_URL]);

  // ---------- Files ----------

  const fetchFiles = async (sessionId: string) => {
    try {
      const bucketsRes = await fetch(`${API_URL}/api/portal/${agentId}/sessions/${sessionId}/buckets`);
      if (!bucketsRes.ok) return;

      const bucketsData = await bucketsRes.json();
      setBuckets(bucketsData.buckets || []);

      if (!bucketsData.buckets || bucketsData.buckets.length === 0) return;

      const primaryBucket = bucketsData.buckets[0];
      const filesRes = await fetch(`${API_URL}/api/portal/${agentId}/sessions/${sessionId}/buckets/${primaryBucket.id}/files`);
      if (filesRes.ok) {
        const filesData = await filesRes.json();
        const allFiles = (filesData.files || []).map((f: PortalFile) => ({ ...f, bucketName: primaryBucket.name }));
        setFiles(allFiles.filter((f: PortalFile) => !f.is_folder));
      }
    } catch (err) {
      console.error('[ChatPortal] Failed to fetch files:', err);
    }
  };

  useEffect(() => {
    if (session?.id && agentId) {
      fetchFiles(session.id);
    }
  }, [session?.id, agentId, API_URL]);

  // ---------- Thread management ----------

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
      setThinkingEntries([]);
    } catch (err) {
      console.error('Failed to load thread:', err);
    }
  };

  const createNewThread = () => {
    setActiveThread(null);
    setMessages([]);
    setInput('');
    setThinkingEntries([]);
    // Focus the right input depending on state
    setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
      if (chatInputRef.current) chatInputRef.current.focus();
    }, 100);
  };

  const handleShareThread = (threadId: string) => {
    setShareThreadId(threadId);
    setShowShareModal(true);
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
    setThinkingEntries([]);
    setActiveTools([]);

    const assistantId = crypto.randomUUID();
    let fullContent = '';
    let currentThinkingId: string | undefined = undefined;
    let accumulatedThinking = '';

    try {
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
                  input: data.input,
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
              const toolName = data.toolName || data.tool || 'Task';
              const toolId = data.toolId;

              setThinkingEntries(prev => {
                const existingIdx = prev.findIndex(e =>
                  (e.type === 'tool' && (e.id === toolId || e.toolName === toolName))
                );
                if (existingIdx >= 0) {
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
              setActiveTools([]);
              currentThinkingId = undefined;
              accumulatedThinking = '';
            } else if (data.type === 'error') {
              // Backend reported an error — stop the spinner and show error content
              console.error('[ChatPortal] Stream error from backend:', data.error);
              setActiveTools([]);
              currentThinkingId = undefined;
              accumulatedThinking = '';
              // If we have some content streamed, keep it. Otherwise show error.
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
              if (data.file) {
                setFiles(prev => {
                  if (prev.some(f => f.id === data.file.id)) return prev;
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

      // Persist collected thinking entries into the assistant message in-memory
      // so the audit panel stays visible after streaming ends (isSending = false).
      // Use the ref to get the latest entries (state captured in closure is stale).
      const latestThinkingEntries = thinkingEntriesRef.current;
      if (latestThinkingEntries.length > 0) {
        setMessages(prev => prev.map(m => {
          if (m.id === assistantId) {
            return { ...m, thinking_content: JSON.stringify(latestThinkingEntries) };
          }
          return m;
        }));
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
      setActiveTools([]);
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
    <div className="chat-portal portal-container flex h-screen bg-white overflow-hidden" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
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
                  {/* Share button on hover */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleShareThread(thread.id);
                    }}
                    className="share-button absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 text-[#94a3b8] hover:bg-[#f1f5f9] rounded transition-all"
                    title="Share"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
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
                      /* Assistant message */
                      <div className="message-bubble message-assistant bg-white border border-[#e2e8f0] rounded-xl p-5 shadow-sm border-l-4 border-l-[#c5f467]">
                        <div className="message-header flex items-center gap-2 mb-3">
                          <div className="assistant-avatar w-6 h-6 rounded-full bg-gradient-to-br from-[#c5f467] to-[#22c55e] flex items-center justify-center">
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                          </div>
                          <span className="assistant-label font-medium text-sm text-[#1e2a4a]">{portalName}</span>
                        </div>
                        <div className="message-content prose prose-slate prose-sm max-w-none text-[#334155] leading-relaxed pl-8 [&_p]:mb-3 [&_ul]:mb-3 [&_ol]:mb-3 [&_li]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-[#1e2a4a] [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-[#1e2a4a] [&_h3]:mt-4 [&_h3]:mb-2 [&_strong]:text-[#1e2a4a] [&_pre]:bg-[#f8fafc] [&_pre]:border [&_pre]:border-[#e2e8f0] [&_pre]:rounded-lg [&_pre]:p-4 [&_a]:text-[#3b82f6] [&_a]:no-underline [&_a:hover]:underline">
                            <ReactMarkdown
                              rehypePlugins={[rehypeRaw]}
                              components={{
                                // Make inline code with filenames clickable
                                code: ({ children, className, ...props }) => {
                                  if (className) {
                                    return <code className={className} {...props}>{children}</code>;
                                  }
                                  const text = getTextFromChildren(children).trim();
                                  const matchedFile = findFileMatch(text);
                                  if (matchedFile && looksLikeFilename(text)) {
                                    return (
                                      <button
                                        onClick={() => setPreviewFile(matchedFile)}
                                        className="px-1.5 py-0.5 bg-[#eff6ff] text-[#3b82f6] rounded text-sm font-mono hover:bg-[#dbeafe] cursor-pointer transition-colors"
                                        title={`Preview ${text}`}
                                      >
                                        {text}
                                      </button>
                                    );
                                  }
                                  return <code className="px-1 py-0.5 bg-[#f1f5f9] rounded text-sm" {...props}>{children}</code>;
                                },
                                // Make bold filenames clickable
                                strong: ({ children, ...props }) => {
                                  const text = getTextFromChildren(children).trim();
                                  const matchedFile = findFileMatch(text);
                                  if (matchedFile && looksLikeFilename(text)) {
                                    return (
                                      <button
                                        onClick={() => setPreviewFile(matchedFile)}
                                        className="font-semibold text-[#3b82f6] hover:underline cursor-pointer"
                                        title={`Preview ${text}`}
                                      >
                                        {text}
                                      </button>
                                    );
                                  }
                                  return <strong className="text-[#1e2a4a]" {...props}>{children}</strong>;
                                },
                                // Styled list items with checkmark icons
                                li: ({ children, ...props }) => {
                                  return (
                                    <li className="flex items-start gap-2.5 list-none mb-2" {...props}>
                                      <svg className="w-4 h-4 text-[#f472b6] mt-1 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                                      </svg>
                                      <span className="flex-1 min-w-0">{children}</span>
                                    </li>
                                  );
                                },
                                // Remove default list styling since li handles it
                                ul: ({ children, ...props }) => {
                                  return <ul className="list-none pl-0 space-y-1 mb-3" {...props}>{children}</ul>;
                                },
                                ol: ({ children, ...props }) => {
                                  return <ol className="list-none pl-0 space-y-1 mb-3" {...props}>{children}</ol>;
                                },
                              }}
                            >
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                          {/* Animated dots indicator while streaming on last message */}
                          {isSending && idx === messages.length - 1 && msg.role === 'assistant' && (
                            <div className="streaming-indicator flex items-center gap-2 mt-3">
                              <div className="flex gap-1">
                                <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: buttonColor, animationDelay: '0ms', animationDuration: '1s' }} />
                                <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: buttonColor, animationDelay: '150ms', animationDuration: '1s' }} />
                                <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: buttonColor, animationDelay: '300ms', animationDuration: '1s' }} />
                              </div>
                              <span className="text-xs text-[#94a3b8]">Processing...</span>
                            </div>
                          )}
                          {/* Persisted thinking/tool entries (loaded from DB) */}
                          {msg.thinking_content && (() => {
                            const persistedEntries = parseThinkingContent(msg.thinking_content);
                            return persistedEntries.length > 0 ? (
                              <MessageThinkingPanel
                                entries={persistedEntries}
                                portalName={portalName}
                                primaryColor={primaryColor}
                              />
                            ) : null;
                          })()}
                          {/* Live thinking entries (current streaming session, last msg only) */}
                          {isSending && idx === messages.length - 1 && !msg.thinking_content && thinkingEntries.length > 0 && (
                            <MessageThinkingPanel
                              entries={thinkingEntries}
                              portalName={portalName}
                              primaryColor={primaryColor}
                            />
                          )}
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
                        <p className="file-name truncate font-medium text-[#1e2a4a]">{file.name}</p>
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

      {/* ===== Modals ===== */}

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
  );
}

export default ChatPortal;
