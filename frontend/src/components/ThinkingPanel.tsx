import { useState } from 'react';

export interface ToolActivity {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  startTime: number;
  endTime?: number;
  duration?: number;
  detail?: string;
}

export interface ThinkingEntry {
  type: 'thinking' | 'tool' | 'tool_result' | 'status';
  content: string;
  timestamp: number;
  id?: string;
  toolId?: string;
  toolName?: string;
  duration?: number;
  isError?: boolean;
}

interface ThinkingPanelProps {
  readonly entries: ThinkingEntry[];
  readonly activeTools: ToolActivity[];
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
  readonly themeColor?: string;
  readonly isLightTheme?: boolean;
}

export function ThinkingPanel({
  entries,
  activeTools,
  isExpanded: _isExpanded,
  onToggle: _onToggle,
  themeColor = '#3b82f6',
  isLightTheme = false
}: ThinkingPanelProps) {
  const [expandedThinkingIndices, setExpandedThinkingIndices] = useState<Set<number>>(new Set());
  const [isThinkingSectionExpanded, setIsThinkingSectionExpanded] = useState(false);
  const [isMcpSectionExpanded, setIsMcpSectionExpanded] = useState(false);
  
  // Reserved for future use
  void _isExpanded;
  void _onToggle;
  const hasActiveTools = activeTools.length > 0;
  
  // Filter thinking entries for the expandable section
  const thinkingEntries = entries.filter(e => e.type === 'thinking');
  const toolEntries = entries.filter(e => e.type === 'tool' || e.type === 'tool_result');
  
  // Separate MCP tools from regular tools for prominent display
  const mcpToolEntries = toolEntries.filter(e => {
    const toolName = e.toolName || e.content.replace(/^(?:📖|🔍|✏️|💻|🤔|🌐|🔧|⚙️|📁|📝)\s*/u, '');
    const standardTools = ['Read', 'Write', 'Edit', 'Bash', 'Shell', 'Glob', 'Grep', 'Task', 'WebFetch', 'Fetch'];
    return !standardTools.includes(toolName) && toolName.includes('_');
  });
  const regularToolEntries = toolEntries.filter(e => {
    const toolName = e.toolName || e.content.replace(/^(?:📖|🔍|✏️|💻|🤔|🌐|🔧|⚙️|📁|📝)\s*/u, '');
    const standardTools = ['Read', 'Write', 'Edit', 'Bash', 'Shell', 'Glob', 'Grep', 'Task', 'WebFetch', 'Fetch'];
    return standardTools.includes(toolName) || !toolName.includes('_');
  });
  
  const toggleThinking = (index: number) => {
    setExpandedThinkingIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };
  
  const expandAllThoughts = () => {
    setExpandedThinkingIndices(new Set(thinkingEntries.map((_, i) => i)));
  };
  
  const collapseAllThoughts = () => {
    setExpandedThinkingIndices(new Set());
  };
  
  // Don't show panel if there's nothing meaningful to display
  // (no active tools, no thinking traces, and no tool entries)
  if (!hasActiveTools && thinkingEntries.length === 0 && toolEntries.length === 0 && mcpToolEntries.length === 0) {
    return null;
  }

  // Theme-aware color classes
  const borderColor = isLightTheme ? 'border-gray-200' : 'border-white/10';
  const bgMain = isLightTheme ? 'bg-gray-50' : 'bg-black/40';
  const textMuted = isLightTheme ? 'text-gray-500' : 'text-white/50';
  const textContent = isLightTheme ? 'text-gray-700' : 'text-white/80';
  
  return (
    <div className={`border ${borderColor} rounded-lg overflow-hidden ${bgMain} text-sm`}>
      {/* Expanded content - always shown, NO scroll */}
      {(
        <div className={`border-t ${borderColor}`}>
          {/* MCP Tools section - COLLAPSIBLE, matches reasoning style */}
          {mcpToolEntries.length > 0 && (
            <div className={`border-b-2 ${isLightTheme ? 'border-blue-300' : 'border-blue-500/50'}`}>
              {/* Clickable header - always visible */}
              <button
                onClick={() => setIsMcpSectionExpanded(!isMcpSectionExpanded)}
                className={`w-full p-3 ${isLightTheme ? 'bg-blue-50 hover:bg-blue-100' : 'bg-gradient-to-r from-blue-500/20 to-blue-600/10 hover:from-blue-500/25 hover:to-blue-600/15'} transition-colors flex items-center justify-between`}
              >
                <div className={`flex items-center gap-3 ${isLightTheme ? 'text-blue-700' : 'text-blue-300'}`}>
                  <div className={`p-1.5 ${isLightTheme ? 'bg-blue-100' : 'bg-blue-500/20'} rounded-lg`}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <span className="text-sm font-semibold tracking-wide">MCP Tools</span>
                    <span className={`text-xs ${isLightTheme ? 'text-blue-500' : 'text-blue-400'} ml-2`}>({mcpToolEntries.filter(e => e.type === 'tool_result').length} call{mcpToolEntries.filter(e => e.type === 'tool_result').length !== 1 ? 's' : ''})</span>
                  </div>
                </div>
                <svg 
                  className={`w-5 h-5 ${isLightTheme ? 'text-blue-500' : 'text-blue-400'} transition-transform ${isMcpSectionExpanded ? 'rotate-180' : ''}`} 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {/* Expanded content */}
              {isMcpSectionExpanded && (
                <div className={`p-4 ${isLightTheme ? 'bg-blue-50/50' : 'bg-gradient-to-r from-blue-500/10 to-blue-600/5'}`}>
                  <div className="space-y-3">
                    {mcpToolEntries.map((entry, i) => {
                      const toolName = entry.toolName || entry.content.replace(/^(?:📖|🔍|✏️|💻|🤔|🌐|🔧|⚙️|📁|📝)\s*/u, '');
                      
                      return (
                        <div 
                          key={i} 
                          className={`flex items-center gap-3 px-4 py-3 rounded-md border ${
                            entry.isError 
                              ? isLightTheme ? 'bg-red-50 border-red-200 text-red-700' : 'bg-red-500/20 border-red-500/40 text-red-300'
                              : isLightTheme ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-blue-500/20 border-blue-500/40 text-blue-200'
                          }`}
                        >
                          {entry.type === 'tool_result' ? (
                            entry.isError ? (
                              <span className={`${isLightTheme ? 'text-red-500' : 'text-red-400'} font-bold text-lg`}>✗</span>
                            ) : (
                              <span className={`${isLightTheme ? 'text-emerald-600' : 'text-emerald-400'} font-bold text-lg`}>✓</span>
                            )
                          ) : (
                            <span className={`${isLightTheme ? 'text-blue-500' : 'text-blue-400'} text-lg`}>→</span>
                          )}
                          <span className="text-sm font-medium flex-1">
                            {toolName}
                          </span>
                          {entry.duration !== undefined && entry.duration > 0 && (
                            <span className={`text-sm tabular-nums font-mono px-2 py-0.5 rounded ${isLightTheme ? 'text-blue-600 bg-blue-100' : 'text-blue-400 bg-blue-900/50'}`}>
                              {entry.duration < 1000 ? `${entry.duration}ms` : `${(entry.duration / 1000).toFixed(1)}s`}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Active tools */}
          {activeTools.length > 0 && (
            <div className={`p-3 border-b ${borderColor} ${isLightTheme ? 'bg-blue-50' : 'bg-blue-500/5'}`}>
              <div className={`text-xs ${textMuted} uppercase tracking-wide mb-2`}>Active</div>
              {activeTools.map(tool => (
                <div key={tool.id} className={`flex items-center gap-2 ${textContent}`}>
                  <span 
                    className="w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ backgroundColor: themeColor }}
                  />
                  <span>{tool.name}</span>
                  <span className={`text-xs ${textMuted}`}>
                    {Math.round((Date.now() - tool.startTime) / 1000)}s
                  </span>
                </div>
              ))}
            </div>
          )}
          
          {/* Tool activity log - HIGH CONTRAST (regular tools only) */}
          {regularToolEntries.length > 0 && (
            <div className={`p-4 border-b ${isLightTheme ? 'border-gray-200 bg-gray-50' : 'border-cyan-500/30 bg-slate-900/80'}`}>
              <div className={`flex items-center gap-2 text-sm font-semibold uppercase tracking-wide mb-3 ${isLightTheme ? 'text-gray-600' : 'text-cyan-400'}`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>Other Tools</span>
              </div>
              <div className="space-y-3">
                {/* Show regular tool entries only */}
                {regularToolEntries.map((entry, i) => {
                  const toolName = entry.toolName || entry.content.replace(/^(?:📖|🔍|✏️|💻|🤔|🌐|🔧|⚙️|📁|📝)\s*/u, '');
                  
                  // Detect MCP tools by:
                  // 1. Explicit mcp_ prefix or 'mcp' in name
                  // 2. Common MCP tool patterns (ask_question, search_repos, etc.)
                  // 3. Tools that aren't standard Cursor/Claude tools
                  const standardTools = ['Read', 'Write', 'Edit', 'Bash', 'Shell', 'Glob', 'Grep', 'Task', 'WebFetch', 'Fetch'];
                  const isMcpTool = toolName.toLowerCase().includes('mcp') || 
                                    toolName.toLowerCase().includes('callmcptool') ||
                                    (toolName.includes('_') && !standardTools.includes(toolName));
                  
                  return (
                    <div 
                      key={i} 
                      className={`flex items-center gap-3 px-4 py-3 rounded-md border ${
                        entry.isError 
                          ? isLightTheme ? 'bg-red-50 border-red-200 text-red-700' : 'bg-red-500/20 border-red-500/40 text-red-300'
                          : isMcpTool
                            ? isLightTheme ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-blue-500/20 border-blue-500/40 text-blue-200'
                            : isLightTheme ? 'bg-gray-100 border-gray-200 text-gray-700' : 'bg-slate-800 border-slate-600 text-slate-200'
                      }`}
                    >
                      {entry.type === 'tool_result' ? (
                        entry.isError ? (
                          <span className={`${isLightTheme ? 'text-red-500' : 'text-red-400'} font-bold text-lg`}>✗</span>
                        ) : (
                          <span className={`${isLightTheme ? 'text-emerald-600' : 'text-emerald-400'} font-bold text-lg`}>✓</span>
                        )
                      ) : (
                        <span className={`text-lg ${isMcpTool ? (isLightTheme ? 'text-blue-500' : 'text-blue-400') : (isLightTheme ? 'text-gray-400' : 'text-slate-400')}`}>→</span>
                      )}
                      <span className="text-sm font-medium flex-1">
                        {isMcpTool && <span className={`${isLightTheme ? 'text-blue-600' : 'text-blue-300'} mr-1 font-semibold`}>MCP:</span>}
                        {toolName}
                      </span>
                      {entry.duration !== undefined && entry.duration > 0 && (
                        <span className={`text-sm tabular-nums font-mono px-2 py-0.5 rounded ${isLightTheme ? 'text-gray-500 bg-gray-200' : 'text-slate-400 bg-slate-700/50'}`}>
                          {entry.duration < 1000 ? `${entry.duration}ms` : `${(entry.duration / 1000).toFixed(1)}s`}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          
          {/* Extended thinking section - COLLAPSIBLE by default */}
          {thinkingEntries.length > 0 && (
            <div className={`border-b-2 ${isLightTheme ? 'border-purple-300' : 'border-purple-500/50'}`}>
              {/* Clickable header - always visible */}
              <button
                onClick={() => setIsThinkingSectionExpanded(!isThinkingSectionExpanded)}
                className={`w-full p-3 ${isLightTheme ? 'bg-purple-50 hover:bg-purple-100' : 'bg-gradient-to-r from-purple-500/20 to-purple-600/10 hover:from-purple-500/25 hover:to-purple-600/15'} transition-colors flex items-center justify-between`}
              >
                <div className={`flex items-center gap-3 ${isLightTheme ? 'text-purple-700' : 'text-purple-300'}`}>
                  <div className={`p-1.5 ${isLightTheme ? 'bg-purple-100' : 'bg-purple-500/20'} rounded-lg`}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <span className="text-sm font-semibold tracking-wide">Claude's Reasoning</span>
                    <span className={`text-xs ${isLightTheme ? 'text-purple-500' : 'text-purple-400'} ml-2`}>({thinkingEntries.length} trace{thinkingEntries.length !== 1 ? 's' : ''})</span>
                  </div>
                </div>
                <svg 
                  className={`w-5 h-5 ${isLightTheme ? 'text-purple-500' : 'text-purple-400'} transition-transform ${isThinkingSectionExpanded ? 'rotate-180' : ''}`} 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {/* Expanded content */}
              {isThinkingSectionExpanded && (
                <div className={`p-4 ${isLightTheme ? 'bg-purple-50/50' : 'bg-gradient-to-r from-purple-500/10 to-purple-600/5'}`}>
                  {/* Expand/Collapse all buttons */}
                  <div className="flex gap-2 mb-3">
                    <button
                      onClick={expandAllThoughts}
                      className={`px-2 py-1 text-xs rounded transition-colors ${isLightTheme ? 'bg-purple-100 hover:bg-purple-200 text-purple-700' : 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-300'}`}
                    >
                      Expand All
                    </button>
                    <button
                      onClick={collapseAllThoughts}
                      className={`px-2 py-1 text-xs rounded transition-colors ${isLightTheme ? 'bg-purple-100 hover:bg-purple-200 text-purple-700' : 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-300'}`}
                    >
                      Collapse All
                    </button>
                  </div>
                  
                  {/* Improved scrollbar contrast */}
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-2 thinking-scroll" style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: isLightTheme ? '#9333ea #e9d5ff' : '#a855f7 #1e1b4b'
                  }}>
                    {thinkingEntries.map((entry, i) => {
                      const isExpanded = expandedThinkingIndices.has(i);
                      const preview = entry.content.slice(0, 150);
                      const hasMore = entry.content.length > 150;
                      
                      return (
                        <div key={i} className={`rounded-lg border overflow-hidden ${isLightTheme ? 'bg-white border-purple-200 shadow-sm' : 'bg-black/40 border-purple-500/30 shadow-lg shadow-purple-500/5'}`}>
                          <button
                            onClick={() => toggleThinking(i)}
                            className={`w-full px-4 py-2.5 border-b flex items-center justify-between transition-colors ${isLightTheme ? 'bg-purple-50 border-purple-100 hover:bg-purple-100' : 'bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/15'}`}
                          >
                            <span className={`text-sm font-medium ${isLightTheme ? 'text-purple-600' : 'text-purple-400'}`}>Thought {i + 1}</span>
                            <div className="flex items-center gap-3">
                              <span className={`text-xs ${isLightTheme ? 'text-purple-400' : 'text-purple-500/50'}`}>{entry.content.length} chars</span>
                              <svg 
                                className={`w-4 h-4 ${isLightTheme ? 'text-purple-500' : 'text-purple-400'} transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
                                fill="none" 
                                viewBox="0 0 24 24" 
                                stroke="currentColor"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </button>
                          {isExpanded && (
                            <div className="p-4">
                              <div className={`text-sm leading-relaxed whitespace-pre-wrap font-mono ${isLightTheme ? 'text-gray-700' : 'text-white/80'}`}>
                                {entry.content}
                              </div>
                            </div>
                          )}
                          {!isExpanded && (
                            <div className="px-4 py-3">
                              <div className={`text-sm leading-relaxed whitespace-pre-wrap font-mono truncate ${isLightTheme ? 'text-gray-500' : 'text-white/50'}`}>
                                {preview}{hasMore && '...'}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Empty state */}
          {toolEntries.length === 0 && thinkingEntries.length === 0 && !hasActiveTools && mcpToolEntries.length === 0 && (
            <div className={`p-3 text-center text-xs ${textMuted}`}>
              No detailed activity recorded
            </div>
          )}
        </div>
      )}
    </div>
  );
}
