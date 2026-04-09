import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  analytics, 
  SystemStats, 
  TopAgent, 
  AnalyticsSummary, 
  UsageOverTimeData, 
  UsageBySourceData, 
  LatencyPercentiles, 
  ToolUsageData, 
  RecentError, 
  KBAnalytics, 
  SandboxStats, 
  ActiveSessions, 
  SessionDurations, 
  StorageUsage,
  WoWComparison,
  SourceDistribution,
  PeakHourData,
  ConversationDepth,
  ApiStats,
  ResponseLengthStats,
  SandboxUsageToday,
  SystemToolUsage,
} from '@/lib/api';
import { 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
} from 'recharts';

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// Helper function to format large numbers
function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

// Helper function to format duration
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

// WoW Change Indicator
function ChangeIndicator({ value, label }: { value: number; label?: string }) {
  const isPositive = value > 0;
  const isNeutral = value === 0;
  
  return (
    <div className={`flex items-center gap-1 text-xs ${
      isNeutral ? 'text-slate-500 dark:text-slate-400' : isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
    }`}>
      {!isNeutral && (
        <span>{isPositive ? '↑' : '↓'}</span>
      )}
      <span>{Math.abs(value).toFixed(1)}%</span>
      {label && <span className="text-slate-500 dark:text-slate-400">{label}</span>}
    </div>
  );
}

// Peak Hours Heatmap Component
function PeakHoursHeatmap({ data, compact = false }: { data: PeakHourData[]; compact?: boolean }) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = Array.from({ length: 24 }, (_, i) => i);
  
  // Build a map for quick lookup
  const dataMap = new Map<string, number>();
  data.forEach(d => dataMap.set(`${d.dayOfWeek}-${d.hour}`, d.count));
  
  const maxCount = Math.max(...data.map(d => d.count), 1);
  
  const getColor = (count: number) => {
    if (count === 0) return 'bg-slate-100 dark:bg-slate-700';
    const intensity = count / maxCount;
    if (intensity < 0.25) return 'bg-blue-100 dark:bg-blue-900/40';
    if (intensity < 0.5) return 'bg-blue-200 dark:bg-blue-700/60';
    if (intensity < 0.75) return 'bg-blue-300 dark:bg-blue-500/80';
    return 'bg-blue-400';
  };

  return (
    <div className="w-full">
      {/* Hour labels */}
      <div className="flex text-[9px] text-slate-500 dark:text-slate-400 mb-1" style={{ paddingLeft: compact ? '24px' : '28px' }}>
        {hours.filter((_, i) => i % 3 === 0).map(h => (
          <div key={h} className="flex-1 text-center">{h}</div>
        ))}
      </div>
      {/* Grid */}
      <div className="space-y-0.5">
        {days.map((day, dayIndex) => (
          <div key={day} className="flex items-center gap-1">
            <div className={`${compact ? 'w-5 text-[9px]' : 'w-6 text-[10px]'} text-slate-500 dark:text-slate-400 flex-shrink-0`}>{day}</div>
            <div className="flex-1 flex gap-px">
              {hours.map(hour => {
                const count = dataMap.get(`${dayIndex}-${hour}`) || 0;
                return (
                  <div
                    key={hour}
                    className={`flex-1 ${compact ? 'h-3' : 'h-4'} rounded-sm ${getColor(count)} transition-all hover:ring-1 hover:ring-white/50`}
                    title={`${day} ${hour}:00 - ${count} events`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Source distribution colors
const SOURCE_COLORS: Record<string, string> = {
  portal: '#3b82f6',
  embed: '#a855f7',
  api: '#22c55e',
  chat: '#f59e0b',
  schedule: '#06b6d4',
};

// Agent Observability Panel Component
function AgentObservabilityPanel({ 
  agent, 
  onClose,
  onViewSessions,
}: { 
  agent: TopAgent; 
  onClose: () => void;
  onViewSessions: () => void;
}) {
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [usageOverTime, setUsageOverTime] = useState<UsageOverTimeData[]>([]);
  const [usageBySource, setUsageBySource] = useState<UsageBySourceData[]>([]);
  const [latency, setLatency] = useState<LatencyPercentiles | null>(null);
  const [toolUsage, setToolUsage] = useState<ToolUsageData[]>([]);
  const [recentErrors, setRecentErrors] = useState<RecentError[]>([]);
  const [hasKBs, setHasKBs] = useState(false);
  const [kbAnalytics, setKBAnalytics] = useState<KBAnalytics | null>(null);
  const [sandboxStats, setSandboxStats] = useState<SandboxStats | null>(null);
  const [activeSessions, setActiveSessions] = useState<ActiveSessions | null>(null);
  const [sessionDurations, setSessionDurations] = useState<SessionDurations | null>(null);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  // New states
  const [conversationDepth, setConversationDepth] = useState<ConversationDepth | null>(null);
  const [peakHours, setPeakHours] = useState<PeakHourData[]>([]);
  const [apiStats, setApiStats] = useState<ApiStats | null>(null);
  const [responseLength, setResponseLength] = useState<ResponseLengthStats | null>(null);

  const loadAgentData = useCallback(async () => {
    setIsLoading(true);
    try {
      const endDate = new Date();
      const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
      const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();

      const [
        summaryRes,
        usageRes,
        sourceRes,
        latencyRes,
        toolsRes,
        errorsRes,
        hasKbRes,
        sandboxRes,
        activeRes,
        durationRes,
        storageRes,
        depthRes,
        peakRes,
        apiRes,
        respLenRes,
      ] = await Promise.all([
        analytics.getSummary(agent.agentId, startStr, endStr),
        analytics.getUsageOverTime(agent.agentId, startStr, endStr, days <= 7 ? 'hour' : 'day'),
        analytics.getUsageBySource(agent.agentId, startStr, endStr),
        analytics.getLatency(agent.agentId, startStr, endStr),
        analytics.getToolUsage(agent.agentId, startStr, endStr),
        analytics.getRecentErrors(agent.agentId, 5),
        analytics.hasKnowledgeBases(agent.agentId),
        analytics.getSandboxStats(agent.agentId, startStr, endStr),
        analytics.getActiveSessions(agent.agentId),
        analytics.getSessionDurations(agent.agentId, startStr, endStr),
        analytics.getStorageUsage(agent.agentId),
        analytics.getConversationDepth(agent.agentId, startStr, endStr),
        analytics.getPeakHours(agent.agentId, days),
        analytics.getApiStats(agent.agentId, startStr, endStr),
        analytics.getResponseLength(agent.agentId, startStr, endStr),
      ]);

      setSummary(summaryRes.summary);
      setUsageOverTime(usageRes.data);
      setUsageBySource(sourceRes.data);
      setLatency(latencyRes.percentiles);
      setToolUsage(toolsRes.data);
      setRecentErrors(errorsRes.errors);
      setHasKBs(hasKbRes.hasKnowledgeBases);
      setSandboxStats(sandboxRes.data);
      setActiveSessions(activeRes.data);
      setSessionDurations(durationRes.data);
      setStorageUsage(storageRes.data);
      setConversationDepth(depthRes.data);
      setPeakHours(peakRes.data);
      setApiStats(apiRes.data);
      setResponseLength(respLenRes.data);

      if (hasKbRes.hasKnowledgeBases) {
        const kbRes = await analytics.getKBAnalytics(agent.agentId, startStr, endStr);
        setKBAnalytics(kbRes.data);
      }
    } catch (err) {
      console.error('Failed to load agent analytics:', err);
    } finally {
      setIsLoading(false);
    }
  }, [agent.agentId, dateRange]);

  useEffect(() => {
    loadAgentData();
  }, [loadAgentData]);

  // Format chart data
  const chartData = usageOverTime.map(d => ({
    ...d,
    name: new Date(d.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));

  // API chart data
  const apiChartData = apiStats?.requestsOverTime.map(d => ({
    ...d,
    name: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  })) || [];

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-start justify-center pt-4 overflow-y-auto">
      <div className="bg-background border border-slate-200 dark:border-slate-700 rounded-xl max-w-6xl w-full mx-4 mb-8">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-background z-10">
          <div>
            <h2 className="text-xl font-semibold">{agent.agentName}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Agent Observability</p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={onViewSessions}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-lg hover:bg-blue-500/20 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
              </svg>
              View Sessions
            </button>
            <div className="flex gap-1">
              {(['7d', '30d', '90d'] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setDateRange(range)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    dateRange === range
                      ? 'bg-white text-black'
                      : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-gray-900'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="text-slate-500 dark:text-slate-400 hover:text-gray-900 p-1"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 max-h-[85vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
          ) : (
            <>
              {/* Live Status */}
              <div className="bg-gradient-to-r from-emerald-500/10 to-blue-500/10 border border-emerald-500/20 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span className="text-sm font-medium">Active Sessions</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <div>Portal: <span className="font-mono font-bold text-blue-400">{activeSessions?.portalSessions || 0}</span></div>
                    <div>Embed: <span className="font-mono font-bold text-purple-400">{activeSessions?.embedSessions || 0}</span></div>
                    <div>Chat: <span className="font-mono font-bold text-orange-400">{activeSessions?.chatSessions || 0}</span></div>
                    <div className="pl-2 border-l border-slate-200 dark:border-slate-700">Total: <span className="font-mono font-bold">{activeSessions?.total || 0}</span></div>
                  </div>
                </div>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-5 gap-3">
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-2xl font-bold">{summary?.totalMessages || 0}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Messages</div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-2xl font-bold">{summary?.totalSessions || 0}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Sessions</div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-2xl font-bold">{summary?.avgLatencyMs || 0}ms</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Avg Latency</div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-2xl font-bold text-green-400">{(summary?.successRate || 0).toFixed(1)}%</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Success Rate</div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-2xl font-bold">{conversationDepth?.avgMessagesPerSession.toFixed(1) || 0}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Avg Msgs/Session</div>
                </div>
              </div>

              {/* Usage Chart + Peak Hours */}
              <div className="grid grid-cols-2 gap-3">
                {/* Usage Chart */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                  <div className="text-sm font-semibold mb-3">Usage Over Time</div>
                  {chartData.length > 0 ? (
                    <div className="h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="name" stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: 10 }} />
                          <YAxis stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: 10 }} />
                          <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#1e293b' }} />
                          <Bar dataKey="messages" name="Messages" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                          <Bar dataKey="responses" name="Responses" fill="#22c55e" radius={[2, 2, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-40 flex items-center justify-center text-slate-500 dark:text-slate-400 text-xs">No data</div>
                  )}
                </div>

                {/* Peak Hours */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-sm font-semibold mb-2">Peak Hours</div>
                  {peakHours.length > 0 ? (
                    <PeakHoursHeatmap data={peakHours} compact />
                  ) : (
                    <div className="h-32 flex items-center justify-center text-slate-500 dark:text-slate-400 text-xs">No data</div>
                  )}
                </div>
              </div>

              {/* Conversation Depth */}
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                <div className="text-sm font-semibold mb-2">Conversation Depth</div>
                <div className="grid grid-cols-4 gap-3 text-xs">
                  <div className="bg-slate-100 dark:bg-slate-700 rounded p-2 text-center">
                    <div className="font-bold text-lg">{conversationDepth?.totalConversations || 0}</div>
                    <div className="text-slate-500 dark:text-slate-400">Total Conversations</div>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-700 rounded p-2 text-center">
                    <div className="font-bold text-lg text-blue-400">{conversationDepth?.shortConversations || 0}</div>
                    <div className="text-slate-500 dark:text-slate-400">Short (1-2 msgs)</div>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-700 rounded p-2 text-center">
                    <div className="font-bold text-lg text-green-400">{conversationDepth?.mediumConversations || 0}</div>
                    <div className="text-slate-500 dark:text-slate-400">Medium (3-10 msgs)</div>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-700 rounded p-2 text-center">
                    <div className="font-bold text-lg text-purple-400">{conversationDepth?.longConversations || 0}</div>
                    <div className="text-slate-500 dark:text-slate-400">Long (10+ msgs)</div>
                  </div>
                </div>
              </div>

              {/* API Stats */}
              {(apiStats && apiStats.totalRequests > 0) ? (
                <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-lg p-4">
                  <div className="text-sm font-semibold mb-3">🔌 API Usage</div>
                  <div className="grid grid-cols-2 gap-4">
                    {/* API Stats */}
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="bg-slate-100 dark:bg-slate-700 rounded p-2 text-center">
                          <div className="font-bold text-lg">{apiStats.totalRequests}</div>
                          <div className="text-slate-500 dark:text-slate-400">Requests</div>
                        </div>
                        <div className="bg-slate-100 dark:bg-slate-700 rounded p-2 text-center">
                          <div className="font-bold text-lg text-green-400">{apiStats.totalResponses}</div>
                          <div className="text-slate-500 dark:text-slate-400">Responses</div>
                        </div>
                        <div className="bg-slate-100 dark:bg-slate-700 rounded p-2 text-center">
                          <div className="font-bold text-lg text-red-400">{apiStats.totalErrors}</div>
                          <div className="text-slate-500 dark:text-slate-400">Errors</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Avg Response Time</span><span className="font-mono">{apiStats.avgResponseTimeMs}ms</span></div>
                        <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Success Rate</span><span className="font-mono text-green-400">{apiStats.successRate.toFixed(1)}%</span></div>
                        <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Tokens In</span><span className="font-mono">{formatNumber(apiStats.tokensIn)}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Tokens Out</span><span className="font-mono">{formatNumber(apiStats.tokensOut)}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Unique API Keys</span><span className="font-mono">{apiStats.uniqueApiKeys}</span></div>
                      </div>
                    </div>
                    {/* API Chart */}
                    <div>
                      {apiChartData.length > 0 && (
                        <div className="h-32">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={apiChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis dataKey="name" stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: 9 }} />
                              <YAxis stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: 9 }} />
                              <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#1e293b' }} />
                              <Area type="monotone" dataKey="requests" name="Requests" fill="#22c55e" stroke="#22c55e" fillOpacity={0.3} />
                              <Area type="monotone" dataKey="errors" name="Errors" fill="#ef4444" stroke="#ef4444" fillOpacity={0.3} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 border-dashed rounded-lg p-4 opacity-60">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">🔌</span>
                    <div>
                      <div className="text-sm font-medium text-slate-500 dark:text-slate-400">API Usage</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400/70">No API calls yet. Enable API access in the Configure tab to track requests, latency, and errors.</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Stats Row */}
              <div className="grid grid-cols-4 gap-3">
                {/* Token Usage */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-sm font-semibold mb-2">Tokens</div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Input</span><span className="font-mono">{formatNumber(summary?.totalTokensInput || 0)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Output</span><span className="font-mono">{formatNumber(summary?.totalTokensOutput || 0)}</span></div>
                  </div>
                </div>

                {/* Latency */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-sm font-semibold mb-2">Latency</div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">p50</span><span className="font-mono">{latency?.p50 || 0}ms</span></div>
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">p99</span><span className="font-mono text-yellow-400">{latency?.p99 || 0}ms</span></div>
                  </div>
                </div>

                {/* Response Length */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-sm font-semibold mb-2">Response Length</div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Avg</span><span className="font-mono">{responseLength?.avgTokensPerResponse || 0} tokens</span></div>
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Median</span><span className="font-mono">{responseLength?.medianTokens || 0} tokens</span></div>
                  </div>
                </div>

                {/* Session Duration */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-sm font-semibold mb-2">Session Duration</div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Avg</span><span className="font-mono">{formatDuration(sessionDurations?.avgDurationMs || 0)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Sessions</span><span className="font-mono">{sessionDurations?.totalSessions || 0}</span></div>
                  </div>
                </div>
              </div>

              {/* Sandbox, Source, Storage, Tools */}
              <div className="grid grid-cols-4 gap-3">
                {/* Sandbox Stats */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-sm font-semibold mb-2">🖥️ Sandbox</div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Starts</span><span className="font-mono text-green-400">{sandboxStats?.totalStarts || 0}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Avg Life</span><span className="font-mono">{formatDuration(sandboxStats?.avgLifetimeMs || 0)}</span></div>
                  </div>
                </div>

                {/* Usage by Source */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-sm font-semibold mb-2">📊 Sources</div>
                  <div className="space-y-1 text-xs max-h-16 overflow-y-auto">
                    {usageBySource.slice(0, 4).map((source) => (
                      <div key={source.source} className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SOURCE_COLORS[source.source] || '#666' }}></span>
                          <span className="capitalize">{source.source}</span>
                        </div>
                        <span className="font-mono">{source.count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Storage */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-sm font-semibold mb-2">💾 Storage</div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Files</span><span className="font-mono">{storageUsage?.fileCount || 0}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">KB Chunks</span><span className="font-mono">{storageUsage?.kbChunks || 0}</span></div>
                  </div>
                </div>

                {/* Tool Usage Summary */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <div className="text-sm font-semibold mb-2">🛠️ Top Tools</div>
                  <div className="space-y-1 text-xs max-h-16 overflow-y-auto">
                    {toolUsage.slice(0, 3).map((tool) => (
                      <div key={tool.toolName} className="flex justify-between">
                        <span className="truncate max-w-[100px]" title={tool.toolName}>{tool.toolName}</span>
                        <span className="font-mono">{tool.callCount}</span>
                      </div>
                    ))}
                    {toolUsage.length === 0 && <div className="text-slate-500 dark:text-slate-400">No tools</div>}
                  </div>
                </div>
              </div>

              {/* Detailed Tool Usage Section */}
              {toolUsage.length > 0 ? (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                  <div className="text-sm font-semibold mb-3">🛠️ Tool Usage Breakdown</div>
                  <div className="space-y-2">
                    {toolUsage.slice(0, 8).map((tool, i) => {
                      const total = toolUsage.reduce((sum, t) => sum + t.callCount, 0);
                      const percent = total > 0 ? (tool.callCount / total) * 100 : 0;
                      const successRate = tool.callCount > 0 
                        ? Math.round((tool.successCount / tool.callCount) * 100) 
                        : 100;
                      return (
                        <div key={tool.toolName} className="flex items-center gap-3">
                          <span className="text-xs text-slate-500 dark:text-slate-400 w-4">{i + 1}.</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-mono truncate" title={tool.toolName}>{tool.toolName}</span>
                              <div className="flex items-center gap-2 text-xs">
                                <span className={`${successRate >= 90 ? 'text-green-400' : successRate >= 70 ? 'text-yellow-400' : 'text-red-400'}`}>
                                  {successRate}%
                                </span>
                                <span className="font-medium">{tool.callCount} calls</span>
                              </div>
                            </div>
                            <div className="h-1.5 bg-white dark:bg-slate-800 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {toolUsage.length > 8 && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">
                      +{toolUsage.length - 8} more tools
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 border-dashed rounded-lg p-3 opacity-60">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">🛠️</span>
                    <div>
                      <div className="text-sm font-medium text-slate-500 dark:text-slate-400">No Tool Usage</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400/70">This agent hasn't used any MCP tools/skills in the selected time period.</div>
                    </div>
                  </div>
                </div>
              )}

              {/* KB Analytics */}
              {hasKBs && kbAnalytics ? (
                <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 rounded-lg p-3">
                  <div className="text-sm font-semibold mb-2">📚 Knowledge Base</div>
                  <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                    <div className="bg-slate-100 dark:bg-slate-700 rounded p-2 text-center">
                      <div className="font-bold">{kbAnalytics.totalSearches}</div>
                      <div className="text-slate-500 dark:text-slate-400">Searches</div>
                    </div>
                    <div className="bg-slate-100 dark:bg-slate-700 rounded p-2 text-center">
                      <div className="font-bold text-blue-400">{kbAnalytics.hitRate.toFixed(1)}%</div>
                      <div className="text-slate-500 dark:text-slate-400">Hit Rate</div>
                    </div>
                    <div className="bg-slate-100 dark:bg-slate-700 rounded p-2 text-center">
                      <div className="font-bold">{kbAnalytics.topDocuments.length}</div>
                      <div className="text-slate-500 dark:text-slate-400">Docs Used</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 border-dashed rounded-lg p-3 opacity-60">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">📚</span>
                    <div>
                      <div className="text-sm font-medium text-slate-500 dark:text-slate-400">Knowledge Base Analytics</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400/70">Attach a knowledge base to track searches, hit rates, and most accessed documents.</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Recent Errors */}
              {recentErrors.length > 0 ? (
                <div className="bg-white dark:bg-slate-800 border border-red-500/20 rounded-lg p-3">
                  <div className="text-sm font-semibold mb-2 text-red-400">Recent Errors</div>
                  <div className="space-y-1 text-xs">
                    {recentErrors.slice(0, 3).map((error) => (
                      <div key={error.id} className="bg-slate-100 dark:bg-slate-700 rounded p-2">
                        <div className="flex justify-between text-slate-500 dark:text-slate-400 mb-1">
                          <span>{error.source}</span>
                          <span>{new Date(error.createdAt).toLocaleDateString()}</span>
                        </div>
                        <div className="text-red-400 truncate">{error.errorMessage}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 border-dashed rounded-lg p-3 opacity-60">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">✅</span>
                    <div>
                      <div className="text-sm font-medium text-slate-500 dark:text-slate-400">No Recent Errors</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400/70">Great! No errors have been logged for this agent in the selected time period.</div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function Observability() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [topAgents, setTopAgents] = useState<TopAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<TopAgent | null>(null);
  // New states
  const [wow, setWow] = useState<WoWComparison | null>(null);
  const [sourceDistribution, setSourceDistribution] = useState<SourceDistribution[]>([]);
  const [peakHours, setPeakHours] = useState<PeakHourData[]>([]);
  const [sandboxUsage, setSandboxUsage] = useState<SandboxUsageToday | null>(null);
  const [topTools, setTopTools] = useState<SystemToolUsage[]>([]);

  const handleViewSessions = (agentId: string) => {
    navigate(`/agents/${agentId}?tab=portal&subtab=users`);
  };

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [statsRes, agentsRes, wowRes, sourceRes, peakRes, sandboxRes, toolsRes] = await Promise.all([
        analytics.getSystemOverview(),
        analytics.getTopAgents(10),
        analytics.getWoWComparison(),
        analytics.getSourceDistribution(),
        analytics.getSystemPeakHours(30),
        analytics.getSandboxUsageToday(),
        analytics.getSystemTopTools(8),
      ]);
      setStats(statsRes.data);
      setTopAgents(agentsRes.data);
      setWow(wowRes.data);
      setSourceDistribution(sourceRes.data);
      setPeakHours(peakRes.data);
      setSandboxUsage(sandboxRes.data);
      setTopTools(toolsRes.data);
    } catch (err) {
      console.error('Failed to load system stats:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Prepare data for charts
  const sourceChartData = sourceDistribution.map(s => ({
    ...s,
    color: SOURCE_COLORS[s.source] || '#666',
  }));

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Agent Detail Modal */}
      {selectedAgent && (
        <AgentObservabilityPanel 
          agent={selectedAgent} 
          onClose={() => setSelectedAgent(null)}
          onViewSessions={() => handleViewSessions(selectedAgent.agentId)}
        />
      )}

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">System Observability</h1>
        <p className="text-slate-500 dark:text-slate-400">Overview of all your agents, usage, and resources</p>
      </div>

      {/* Live Status */}
      <div className="bg-gradient-to-r from-emerald-500/10 to-blue-500/10 border border-emerald-500/20 rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 bg-emerald-500 rounded-full animate-pulse"></div>
            <span className="text-lg font-semibold">System Status</span>
          </div>
          <div className="flex items-center gap-8">
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-400">{stats?.activeSandboxes || 0}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Active Sandboxes</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold">{stats?.totalAgents || 0}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Total Agents</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Stats Grid with WoW indicators */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
          <div className="flex items-baseline justify-between">
            <div className="text-3xl font-bold text-slate-900 dark:text-white">{formatNumber(stats?.totalMessages || 0)}</div>
            {wow && <ChangeIndicator value={wow.messagesChange} />}
          </div>
          <div className="text-sm text-slate-500 dark:text-slate-400">Total Messages</div>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
          <div className="flex items-baseline justify-between">
            <div className="text-3xl font-bold text-slate-900 dark:text-white">{formatNumber(stats?.totalSessions || 0)}</div>
            {wow && <ChangeIndicator value={wow.sessionsChange} />}
          </div>
          <div className="text-sm text-slate-500 dark:text-slate-400">Total Sessions</div>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
          <div className="flex items-baseline justify-between">
            <div className="text-3xl font-bold text-green-600 dark:text-green-400">
              {stats ? (100 - stats.errorRate).toFixed(1) : 0}%
            </div>
            {wow && <ChangeIndicator value={-wow.errorsChange} />}
          </div>
          <div className="text-sm text-slate-500 dark:text-slate-400">Success Rate</div>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
          <div className="flex items-baseline justify-between">
            <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">
              {formatNumber((stats?.totalTokensInput || 0) + (stats?.totalTokensOutput || 0))}
            </div>
            {wow && <ChangeIndicator value={wow.tokensChange} />}
          </div>
          <div className="text-sm text-slate-500 dark:text-slate-400">Total Tokens</div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        {/* Sandbox Usage Today */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
          <div className="text-lg font-semibold mb-4">Sandbox Usage Today</div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400 text-sm">Started</span>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold text-green-400">{sandboxUsage?.startsToday || 0}</span>
                {sandboxUsage && sandboxUsage.startsYesterday > 0 && (
                  <span className={`text-xs ${sandboxUsage.startsToday >= sandboxUsage.startsYesterday ? 'text-green-400' : 'text-red-400'}`}>
                    {sandboxUsage.startsToday >= sandboxUsage.startsYesterday ? '↑' : '↓'}
                    {Math.abs(Math.round(((sandboxUsage.startsToday - sandboxUsage.startsYesterday) / sandboxUsage.startsYesterday) * 100))}%
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400 text-sm">Stopped</span>
              <span className="text-xl font-bold text-orange-400">{sandboxUsage?.stopsToday || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400 text-sm">Running Now</span>
              <span className="text-xl font-bold text-blue-400">{sandboxUsage?.currentlyRunning || 0}</span>
            </div>
            <div className="border-t border-slate-200 dark:border-slate-700 pt-2 mt-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">Avg Lifetime</span>
                <span className="font-medium">{sandboxUsage?.avgLifetimeMinutes || 0} min</span>
              </div>
            </div>
          </div>
        </div>

        {/* Source Distribution Pie */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
          <div className="text-lg font-semibold mb-4">Traffic Sources</div>
          {sourceChartData.length > 0 ? (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sourceChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={30}
                    outerRadius={55}
                    paddingAngle={2}
                    dataKey="count"
                  >
                    {sourceChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#1e293b' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap justify-center gap-2 text-xs">
                {sourceChartData.map((entry, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                    <span className="capitalize">{entry.source}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-40 flex items-center justify-center text-slate-500 dark:text-slate-400 text-sm">No data</div>
          )}
        </div>

        {/* Top Tools */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
          <div className="text-lg font-semibold mb-4">Top Tools (30d)</div>
          {topTools.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {topTools.slice(0, 6).map((tool, i) => {
                const successRate = tool.callCount > 0 
                  ? Math.round((tool.successCount / tool.callCount) * 100) 
                  : 100;
                return (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-slate-500 dark:text-slate-400 w-4">{i + 1}.</span>
                      <span className="truncate font-mono text-xs">{tool.toolName}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs text-slate-500 dark:text-slate-400">{tool.agentCount} agents</span>
                      <span className={`text-xs ${successRate >= 90 ? 'text-green-400' : successRate >= 70 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {successRate}%
                      </span>
                      <span className="font-medium w-12 text-right">{tool.callCount}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-40 flex items-center justify-center text-slate-500 dark:text-slate-400 text-sm">No tool usage data</div>
          )}
        </div>

        {/* Peak Hours Heatmap */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
          <div className="text-lg font-semibold mb-4">Peak Hours (30d)</div>
          {peakHours.length > 0 ? (
            <PeakHoursHeatmap data={peakHours} />
          ) : (
            <div className="h-40 flex items-center justify-center text-slate-500 dark:text-slate-400 text-sm">No activity data</div>
          )}
        </div>
      </div>

      {/* Token & Storage Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Token Usage */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
          <div className="text-lg font-semibold mb-4">Token Usage</div>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-500 dark:text-slate-400">Input Tokens</span>
                <span className="font-mono">{formatNumber(stats?.totalTokensInput || 0)}</span>
              </div>
              <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 rounded-full"
                  style={{ 
                    width: `${stats && (stats.totalTokensInput + stats.totalTokensOutput) > 0 
                      ? (stats.totalTokensInput / (stats.totalTokensInput + stats.totalTokensOutput)) * 100 
                      : 50}%` 
                  }}
                ></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-500 dark:text-slate-400">Output Tokens</span>
                <span className="font-mono">{formatNumber(stats?.totalTokensOutput || 0)}</span>
              </div>
              <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-green-500 rounded-full"
                  style={{ 
                    width: `${stats && (stats.totalTokensInput + stats.totalTokensOutput) > 0 
                      ? (stats.totalTokensOutput / (stats.totalTokensInput + stats.totalTokensOutput)) * 100 
                      : 50}%` 
                  }}
                ></div>
              </div>
            </div>
          </div>
        </div>

        {/* Storage */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
          <div className="text-lg font-semibold mb-4">Storage Overview</div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 dark:text-slate-400">Buckets</span>
                <span className="font-mono">{stats?.totalBuckets || 0}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 dark:text-slate-400">Files</span>
                <span className="font-mono">{stats?.totalFiles || 0}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 dark:text-slate-400">File Storage</span>
                <span className="font-mono">{formatBytes(stats?.totalFileStorage || 0)}</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 dark:text-slate-400">Knowledge Bases</span>
                <span className="font-mono">{stats?.totalKnowledgeBases || 0}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 dark:text-slate-400">KB Chunks</span>
                <span className="font-mono">{formatNumber(stats?.totalKBChunks || 0)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top Agents */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
        <div className="text-lg font-semibold mb-4">Top Agents by Usage</div>
        {topAgents.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left py-2 px-3 text-slate-500 dark:text-slate-400 font-medium">Agent</th>
                  <th className="text-right py-2 px-3 text-slate-500 dark:text-slate-400 font-medium">Messages</th>
                  <th className="text-right py-2 px-3 text-slate-500 dark:text-slate-400 font-medium">Sessions</th>
                  <th className="text-right py-2 px-3 text-slate-500 dark:text-slate-400 font-medium">Last Active</th>
                  <th className="text-right py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {topAgents.map((agent, i) => (
                  <tr key={agent.agentId} className="border-b border-slate-200 dark:border-slate-700/50 hover:bg-slate-100 dark:bg-slate-700">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 dark:text-slate-400 w-4">{i + 1}</span>
                        <span className="font-medium">{agent.agentName}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono">{agent.messageCount}</td>
                    <td className="py-3 px-3 text-right font-mono">{agent.sessionCount}</td>
                    <td className="py-3 px-3 text-right text-slate-500 dark:text-slate-400 text-xs">
                      {agent.lastActive 
                        ? new Date(agent.lastActive).toLocaleDateString()
                        : 'Never'}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button 
                        onClick={() => setSelectedAgent(agent)}
                        className="text-blue-400 hover:text-blue-300 text-xs"
                      >
                        View →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-slate-500 dark:text-slate-400 text-sm py-8 text-center">
            No agent activity yet. Create an agent and start chatting!
          </div>
        )}
      </div>
    </div>
  );
}
