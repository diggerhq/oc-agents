import { useEffect, useState, useRef } from 'react';
import { builder, BuilderConversation, BuilderMessage } from '@/lib/api';
import { Modal } from '@/components/Modal';

export function Builder() {
  const [conversations, setConversations] = useState<BuilderConversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<BuilderConversation | null>(null);
  const [messages, setMessages] = useState<BuilderMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  
  // Modal state
  const [modal, setModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'alert' | 'confirm' | 'danger';
    onConfirm?: () => void;
  }>({ isOpen: false, title: '', message: '', type: 'alert' });
  const closeModal = () => setModal(prev => ({ ...prev, isOpen: false }));

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    // Auto-resize textarea
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  const loadConversations = async () => {
    try {
      const { conversations: convs } = await builder.listConversations();
      setConversations(convs);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  };

  const selectConversation = async (conv: BuilderConversation) => {
    setCurrentConversation(conv);
    setIsLoading(true);
    try {
      const { messages: msgs } = await builder.getMessages(conv.id);
      setMessages(msgs);
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const startNewConversation = async () => {
    try {
      const { conversation } = await builder.createConversation();
      setConversations(prev => [conversation, ...prev]);
      setCurrentConversation(conversation);
      setMessages([]);
      inputRef.current?.focus();
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isSending) return;

    let conv = currentConversation;
    
    // Create conversation if none selected
    if (!conv) {
      try {
        const { conversation } = await builder.createConversation();
        setConversations(prev => [conversation, ...prev]);
        setCurrentConversation(conversation);
        conv = conversation;
      } catch (err) {
        console.error('Failed to create conversation:', err);
        return;
      }
    }

    const userMessage: BuilderMessage = {
      id: 'temp-' + Date.now(),
      conversation_id: conv.id,
      role: 'user',
      content: input,
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsSending(true);

    try {
      const { message } = await builder.sendMessage(conv.id, userMessage.content);
      setMessages(prev => [...prev.filter(m => m.id !== userMessage.id), 
        { ...userMessage, id: 'user-' + message.id },
        message
      ]);
      
      // Update conversation in sidebar
      loadConversations();
    } catch (err) {
      console.error('Failed to send message:', err);
      // Remove temp message on error
      setMessages(prev => prev.filter(m => m.id !== userMessage.id));
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const deleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setModal({
      isOpen: true,
      title: 'Delete Conversation',
      message: 'Delete this conversation?',
      type: 'danger',
      onConfirm: async () => {
    try {
      await builder.deleteConversation(convId);
      setConversations(prev => prev.filter(c => c.id !== convId));
      if (currentConversation?.id === convId) {
        setCurrentConversation(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
      },
    });
  };

  const renderToolActivity = (message: BuilderMessage) => {
    if (!message.tool_calls?.length) return null;
    
    return (
      <div className="mt-3 space-y-2">
        {message.tool_calls.map((tc, i) => {
          const result = message.tool_results?.find(tr => tr.tool_use_id === tc.id);
          let resultData: { success?: boolean; message?: string; error?: string; agents?: unknown[]; repos?: unknown[] } | null = null;
          try {
            resultData = result ? JSON.parse(result.content) : null;
          } catch {
            // ignore
          }

          return (
            <div key={i} className="bg-slate-100 dark:bg-black/30 rounded-lg p-3 text-xs">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 mb-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="font-medium">{tc.name.replace(/_/g, ' ')}</span>
              </div>
              {resultData && (
                <div className="text-slate-600 dark:text-gray-400 mt-1">
                  {resultData.success === true && resultData.message && (
                    <span className="text-green-600 dark:text-green-400">✓ {resultData.message}</span>
                  )}
                  {resultData.success === false && resultData.error && (
                    <span className="text-red-600 dark:text-red-400">✗ {resultData.error}</span>
                  )}
                  {resultData.agents && (
                    <span>Found {resultData.agents.length} agents</span>
                  )}
                  {resultData.repos && (
                    <span>Found {resultData.repos.length} repositories</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex">
      {/* Sidebar */}
      <div className={`${showSidebar ? 'w-72' : 'w-0'} transition-all duration-200 border-r border-slate-200 dark:border-slate-700 flex flex-col bg-white dark:bg-slate-800/30 overflow-hidden`}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <button
            onClick={startNewConversation}
            className="w-full bg-slate-800 dark:bg-blue-500 hover:bg-slate-900 dark:hover:bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Chat
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <p className="text-slate-500 dark:text-slate-400 text-sm text-center py-8">No conversations yet</p>
          ) : (
            <div className="space-y-1">
              {conversations.map(conv => (
                <div
                  key={conv.id}
                  onClick={() => selectConversation(conv)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && selectConversation(conv)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors group flex items-center justify-between cursor-pointer ${
                    currentConversation?.id === conv.id
                      ? 'bg-white/10 text-slate-900 dark:text-white'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-white/5 hover:text-slate-900 dark:text-white'
                  }`}
                >
                  <span className="truncate flex-1">
                    {conv.title || 'New conversation'}
                  </span>
                  <button
                    onClick={(e) => deleteConversation(conv.id, e)}
                    className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 p-1"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="h-14 border-b border-slate-200 dark:border-slate-700 flex items-center px-4 gap-4">
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white p-1"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="font-medium">
            Builder
            <span className="text-slate-500 dark:text-slate-400 font-normal ml-2 text-sm">AI Assistant</span>
          </h1>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 && !isLoading ? (
            <div className="h-full flex flex-col items-center justify-center px-6">
              <div className="max-w-lg text-center">
                <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
                  <svg className="w-8 h-8 text-slate-900 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold mb-3">Builder</h2>
                <p className="text-slate-500 dark:text-slate-400 mb-8">
                  I can help you create and configure AI agents through conversation. 
                  Just tell me what you want to build!
                </p>
                <div className="grid grid-cols-2 gap-3 text-left">
                  {[
                    'Create a code agent for my React project',
                    'Set up a task agent with API access',
                    'List my existing agents',
                    'Help me configure webhooks',
                  ].map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setInput(suggestion);
                        inputRef.current?.focus();
                      }}
                      className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-left text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white hover:border-gray-600 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
              {isLoading ? (
                <div className="text-center py-8 text-slate-500 dark:text-slate-400">Loading conversation...</div>
              ) : (
                messages.map(msg => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                        msg.role === 'user'
                          ? 'bg-white text-black'
                          : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <div className="text-sm whitespace-pre-wrap leading-relaxed">
                        {msg.content}
                      </div>
                      {msg.role === 'assistant' && renderToolActivity(msg)}
                    </div>
                  </div>
                ))
              )}
              
              {isSending && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span className="text-sm">Builder is thinking...</span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-slate-200 dark:border-slate-700 p-4">
          <div className="max-w-3xl mx-auto">
            <div className="relative flex items-end gap-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tell me what you want to build..."
                rows={1}
                className="flex-1 bg-transparent text-slate-900 dark:text-white placeholder-gray-500 resize-none focus:outline-none text-sm leading-relaxed max-h-48"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isSending}
                className="bg-white text-black p-2 rounded-lg hover:bg-gray-200 disabled:bg-gray-600 disabled:text-gray-400 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center mt-2">
              Builder can create agents, list repos, and configure settings for you
            </p>
          </div>
        </div>
      </div>

      {/* Modal */}
      <Modal
        isOpen={modal.isOpen}
        onClose={closeModal}
        title={modal.title}
        message={modal.message}
        type={modal.type}
        onConfirm={modal.onConfirm}
      />
    </div>
  );
}
