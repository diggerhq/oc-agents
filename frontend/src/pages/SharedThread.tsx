import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';

const DEFAULT_API_URL = import.meta.env.VITE_API_URL || '';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking_content?: string;
  created_at?: string;
}

interface Thread {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface PortalConfig {
  name: string;
  theme?: {
    primaryColor?: string;
    backgroundColor?: string;
    accentColor?: string;
    textColor?: string;
    buttonColor?: string;
  } | null;
  logoUrl?: string | null;
  customCSS?: string | null;
}

interface ThinkingEntry {
  type: 'thinking' | 'tool' | 'tool_result' | 'status';
  content: string;
  timestamp: number;
  id?: string;
  toolName?: string;
  input?: unknown;
  output?: string;
  duration?: number;
  isError?: boolean;
}

// Parse persisted thinking_content JSON into ThinkingEntry array
function parseThinkingContent(thinkingContent?: string): ThinkingEntry[] {
  if (!thinkingContent) return [];
  try {
    const parsed = JSON.parse(thinkingContent);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    if (thinkingContent.trim()) {
      return [{ type: 'thinking', content: thinkingContent, timestamp: 0 }];
    }
    return [];
  }
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

export function SharedThread() {
  const { agentId, shareToken } = useParams<{ agentId: string; shareToken: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // Get API URL from URL params or environment
  const API_URL = useMemo(() => {
    const piBackendUrl = searchParams.get('pi_backend_url') || searchParams.get('pi_api_url');
    if (piBackendUrl) return piBackendUrl;
    
    const tokenParam = searchParams.get('token');
    if (tokenParam) {
      try {
        const decoded = JSON.parse(atob(tokenParam));
        if (decoded.pi_backend_url) return decoded.pi_backend_url;
      } catch {
        // Ignore
      }
    }
    
    return DEFAULT_API_URL;
  }, [searchParams]);
  
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [portalConfig, setPortalConfig] = useState<PortalConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isContinuing, setIsContinuing] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (agentId && shareToken) {
      loadSharedThread();
    }
  }, [agentId, shareToken]);

  const loadSharedThread = async () => {
    try {
      const res = await fetch(`${API_URL}/api/portal/${agentId}/shared/${shareToken}`);
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('This shared thread could not be found or the link has expired.');
        }
        throw new Error('Failed to load shared thread');
      }
      
      const data = await res.json();
      setThread(data.thread);
      setMessages(data.messages);
      setPortalConfig(data.portalConfig);
    } catch (err) {
      console.error('Failed to load shared thread:', err);
      setError(err instanceof Error ? err.message : 'Failed to load shared thread');
    } finally {
      setIsLoading(false);
    }
  };

  // Theme — same defaults as ChatPortal
  const theme = portalConfig?.theme || {};
  const primaryColor = theme.primaryColor || '#6366f1';
  const buttonColor = theme.buttonColor || '#6366f1';
  const portalName = portalConfig?.name || 'AI Assistant';

  const toggleThinking = (msgId: string) => {
    setExpandedThinking(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  const handleContinueConversation = async () => {
    setIsContinuing(true);
    try {
      const visitorId = getVisitorId();
      
      const res = await fetch(`${API_URL}/api/portal/${agentId}/shared/${shareToken}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId }),
      });
      
      if (!res.ok) {
        throw new Error('Failed to continue conversation');
      }
      
      await res.json();
      
      const params = new URLSearchParams(searchParams);
      navigate(`/chat/${agentId}?${params.toString()}`);
    } catch (err) {
      console.error('Failed to continue conversation:', err);
      alert('Failed to continue conversation. Please try again.');
    } finally {
      setIsContinuing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="chat-portal portal-container h-screen flex items-center justify-center bg-white" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full animate-bounce" style={{ backgroundColor: primaryColor, animationDelay: '0ms', animationDuration: '1.2s' }} />
            <div className="w-2.5 h-2.5 rounded-full animate-bounce" style={{ backgroundColor: primaryColor, animationDelay: '200ms', animationDuration: '1.2s' }} />
            <div className="w-2.5 h-2.5 rounded-full animate-bounce" style={{ backgroundColor: primaryColor, animationDelay: '400ms', animationDuration: '1.2s' }} />
          </div>
          <div className="text-sm text-[#94a3b8]">Loading shared thread...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="chat-portal portal-container h-screen flex items-center justify-center bg-white" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <div className="text-center max-w-md mx-4">
          <div className="text-red-400 text-4xl mb-4">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p className="text-[#64748b] text-sm mb-4">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="send-button px-5 py-2 rounded-lg text-white text-sm font-medium transition-all hover:opacity-90"
            style={{ backgroundColor: buttonColor }}
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-portal portal-container flex flex-col h-screen bg-white overflow-hidden" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Custom CSS injection — same as ChatPortal */}
      {portalConfig?.customCSS && <style>{portalConfig.customCSS}</style>}
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
      `}</style>

      {/* Top bar — matches ChatPortal's .portal-topbar */}
      <div className="portal-topbar flex-shrink-0 border-b border-[#e2e8f0] flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-3">
          {portalConfig?.logoUrl ? (
            <img src={portalConfig.logoUrl} alt="" className="portal-logo h-6 w-auto" />
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
        <div className="flex items-center gap-2 text-[#94a3b8]">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          <span className="text-xs font-medium">Shared thread</span>
        </div>
      </div>

      {/* Thread title bar */}
      <div className="flex-shrink-0 border-b border-[#f1f5f9] px-6 py-2.5">
        <h1 className="thread-title text-sm font-medium text-[#1e2a4a] truncate">{thread?.title}</h1>
        <p className="thread-date text-xs text-[#94a3b8] mt-0.5">
          {thread?.created_at && new Date(thread.created_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
          })}
          {' '}• {messages.length} message{messages.length !== 1 ? 's' : ''} • Read-only
        </p>
      </div>

      {/* Messages area — same structure as ChatPortal's .chat-container */}
      <div className="chat-container flex-1 overflow-y-auto">
        <div className="chat-messages max-w-3xl mx-auto px-6 py-6 space-y-6">
          {messages.length === 0 ? (
            <div className="text-center py-12 text-[#94a3b8] text-sm">
              This conversation has no messages yet.
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id}>
                {msg.role === 'user' ? (
                  /* User message — matches ChatPortal */
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
                  /* Assistant message — matches ChatPortal */
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
                          code: ({ children, className, ...props }) => {
                            if (className) {
                              return <code className={className} {...props}>{children}</code>;
                            }
                            return <code className="px-1 py-0.5 bg-[#f1f5f9] rounded text-sm" {...props}>{children}</code>;
                          },
                          strong: ({ children, ...props }) => <strong className="text-[#1e2a4a]" {...props}>{children}</strong>,
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
                        {msg.content}
                      </ReactMarkdown>
                    </div>

                    {/* Thinking/tool entries (audit trail) */}
                    {msg.thinking_content && (() => {
                      const entries = parseThinkingContent(msg.thinking_content);
                      if (entries.length === 0) return null;
                      const thinkingEntries = entries.filter(e => e.type === 'thinking');
                      const toolEntries = entries.filter(e => e.type === 'tool' || e.type === 'tool_result');
                      const isExpanded = expandedThinking.has(msg.id);

                      return (
                        <div className="thinking-panel mt-4 ml-8">
                          <button
                            onClick={() => toggleThinking(msg.id)}
                            className="flex items-center gap-2 text-xs text-[#94a3b8] hover:text-[#64748b] transition-colors"
                          >
                            <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            <span style={{ color: primaryColor }} className="font-medium">{portalName}</span>
                            <span>thinking & tools</span>
                            {thinkingEntries.length > 0 && (
                              <span className="px-1.5 py-0.5 bg-[#f1f5f9] rounded-full text-[10px]">
                                {thinkingEntries.length} thought{thinkingEntries.length !== 1 ? 's' : ''}
                              </span>
                            )}
                            {toolEntries.length > 0 && (
                              <span className="px-1.5 py-0.5 bg-[#f1f5f9] rounded-full text-[10px]">
                                {toolEntries.length} tool{toolEntries.length !== 1 ? 's' : ''}
                              </span>
                            )}
                          </button>

                          {isExpanded && (
                            <div className="mt-3 space-y-2 border-l-2 border-[#e2e8f0] pl-3 max-h-[500px] overflow-y-auto">
                              {entries.map((entry, idx) => (
                                <div key={idx} className="thinking-entry text-xs">
                                  {entry.type === 'thinking' ? (
                                    <div className="bg-[#fafbfc] border border-[#e2e8f0] rounded-lg p-3">
                                      <div className="flex items-center gap-1.5 mb-1.5 text-[#94a3b8]">
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                        </svg>
                                        <span className="font-medium">Thinking</span>
                                      </div>
                                      <p className="text-[#64748b] whitespace-pre-wrap leading-relaxed">{entry.content}</p>
                                    </div>
                                  ) : entry.type === 'tool' ? (
                                    <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg p-3">
                                      <div className="flex items-center gap-1.5 text-[#16a34a]">
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                        <span className="font-medium">{entry.toolName || entry.content}</span>
                                        {entry.duration && (
                                          <span className="text-[10px] text-[#94a3b8] ml-auto">{(entry.duration / 1000).toFixed(1)}s</span>
                                        )}
                                      </div>
                                    </div>
                                  ) : entry.type === 'tool_result' ? (
                                    <div className={`border rounded-lg p-3 ${entry.isError ? 'bg-[#fef2f2] border-[#fecaca]' : 'bg-[#f0fdf4] border-[#bbf7d0]'}`}>
                                      <div className="flex items-center gap-1.5 mb-1">
                                        <span className={`font-medium ${entry.isError ? 'text-[#dc2626]' : 'text-[#16a34a]'}`}>
                                          {entry.isError ? '✗' : '✓'} {entry.toolName || 'Result'}
                                        </span>
                                      </div>
                                      {entry.output && (
                                        <p className="text-[#64748b] whitespace-pre-wrap mt-1 line-clamp-4">{entry.output}</p>
                                      )}
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Continue conversation footer — matches ChatPortal's .input-container */}
      <div className="input-container flex-shrink-0 border-t border-[#e2e8f0] bg-white">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <button
            onClick={handleContinueConversation}
            disabled={isContinuing}
            className="send-button w-full py-3 px-6 rounded-xl font-medium text-sm text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 border-none outline-none"
            style={{ backgroundColor: buttonColor }}
          >
            {isContinuing ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Starting your session...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Continue this conversation
              </>
            )}
          </button>
          <p className="portal-disclaimer text-center text-xs text-[#94a3b8] mt-2">
            Start your own session to continue chatting
          </p>
        </div>
      </div>
    </div>
  );
}
