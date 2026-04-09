/**
 * Analytics Service
 * 
 * Tracks agent usage events for observability dashboards.
 */

import { v4 as uuidv4 } from 'uuid';
import { execute, query } from '../db/index.js';

export type EventType = 
  | 'message'           // User sent a message
  | 'response'          // Agent responded
  | 'session_start'     // Portal/embed session started
  | 'session_end'       // Session ended
  | 'sandbox_start'     // Sandbox started
  | 'sandbox_stop'      // Sandbox stopped
  | 'sandbox_reset'     // Sandbox was reset (destroyed and recreated)
  | 'tool_call'         // MCP tool was called
  | 'kb_search'         // Knowledge base was searched
  | 'error';            // Error occurred

export type EventSource = 'portal' | 'embed' | 'api' | 'chat' | 'schedule';

export interface AnalyticsEvent {
  agentId: string;
  eventType: EventType;
  source: EventSource;
  userId?: string;
  sessionId?: string;
  threadId?: string;
  tokensInput?: number;
  tokensOutput?: number;
  latencyMs?: number;
  success?: boolean;
  metadata?: Record<string, any>;
  errorMessage?: string;
}

/**
 * Log an analytics event
 */
export async function logEvent(event: AnalyticsEvent): Promise<void> {
  try {
    const id = uuidv4();
    await execute(
      `INSERT INTO agent_analytics (
        id, agent_id, event_type, source, user_id, session_id, thread_id,
        tokens_input, tokens_output, latency_ms, success, metadata, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        event.agentId,
        event.eventType,
        event.source,
        event.userId || null,
        event.sessionId || null,
        event.threadId || null,
        event.tokensInput || 0,
        event.tokensOutput || 0,
        event.latencyMs || 0,
        event.success !== false,
        event.metadata ? JSON.stringify(event.metadata) : null,
        event.errorMessage || null,
      ]
    );
  } catch (error) {
    // Don't let analytics failures break the main flow
    console.error('[Analytics] Failed to log event:', error);
  }
}

/**
 * Get usage summary for an agent over a time period
 */
export async function getUsageSummary(
  agentId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  totalMessages: number;
  totalResponses: number;
  totalSessions: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  avgLatencyMs: number;
  successRate: number;
  errorCount: number;
}> {
  const result = await query<{
    total_messages: number;
    total_responses: number;
    total_sessions: number;
    total_tokens_input: number;
    total_tokens_output: number;
    avg_latency: number;
    success_count: number;
    error_count: number;
  }>(
    `SELECT 
      COUNT(CASE WHEN event_type = 'message' THEN 1 END) as total_messages,
      COUNT(CASE WHEN event_type = 'response' THEN 1 END) as total_responses,
      COUNT(CASE WHEN event_type = 'session_start' THEN 1 END) as total_sessions,
      COALESCE(SUM(tokens_input), 0) as total_tokens_input,
      COALESCE(SUM(tokens_output), 0) as total_tokens_output,
      COALESCE(AVG(CASE WHEN latency_ms > 0 THEN latency_ms END), 0) as avg_latency,
      COUNT(CASE WHEN success = true THEN 1 END) as success_count,
      COUNT(CASE WHEN success = false THEN 1 END) as error_count
    FROM agent_analytics
    WHERE agent_id = $1
      AND created_at >= $2
      AND created_at <= $3`,
    [agentId, startDate.toISOString(), endDate.toISOString()]
  );

  const row = result[0] || {
    total_messages: 0,
    total_responses: 0,
    total_sessions: 0,
    total_tokens_input: 0,
    total_tokens_output: 0,
    avg_latency: 0,
    success_count: 0,
    error_count: 0,
  };

  const totalEvents = row.success_count + row.error_count;
  
  return {
    totalMessages: row.total_messages,
    totalResponses: row.total_responses,
    totalSessions: row.total_sessions,
    totalTokensInput: row.total_tokens_input,
    totalTokensOutput: row.total_tokens_output,
    avgLatencyMs: Math.round(row.avg_latency),
    successRate: totalEvents > 0 ? (row.success_count / totalEvents) * 100 : 100,
    errorCount: row.error_count,
  };
}

/**
 * Get hourly/daily usage over time
 */
export async function getUsageOverTime(
  agentId: string,
  startDate: Date,
  endDate: Date,
  granularity: 'hour' | 'day' = 'day'
): Promise<Array<{
  timestamp: string;
  messages: number;
  responses: number;
  sessions: number;
  tokensInput: number;
  tokensOutput: number;
}>> {
  const dateFormat = granularity === 'hour' 
    ? "TO_CHAR(created_at, 'YYYY-MM-DD HH24:00')"
    : "TO_CHAR(created_at, 'YYYY-MM-DD')";

  const rows = await query<{
    time_bucket: string;
    messages: number;
    responses: number;
    sessions: number;
    tokens_input: number;
    tokens_output: number;
  }>(
    `SELECT 
      ${dateFormat} as time_bucket,
      COUNT(CASE WHEN event_type = 'message' THEN 1 END) as messages,
      COUNT(CASE WHEN event_type = 'response' THEN 1 END) as responses,
      COUNT(CASE WHEN event_type = 'session_start' THEN 1 END) as sessions,
      COALESCE(SUM(tokens_input), 0) as tokens_input,
      COALESCE(SUM(tokens_output), 0) as tokens_output
    FROM agent_analytics
    WHERE agent_id = $1
      AND created_at >= $2
      AND created_at <= $3
    GROUP BY ${dateFormat}
    ORDER BY time_bucket ASC`,
    [agentId, startDate.toISOString(), endDate.toISOString()]
  );

  return rows.map(row => ({
    timestamp: row.time_bucket,
    messages: row.messages,
    responses: row.responses,
    sessions: row.sessions,
    tokensInput: row.tokens_input,
    tokensOutput: row.tokens_output,
  }));
}

/**
 * Get usage breakdown by source (portal, embed, api, etc.)
 */
export async function getUsageBySource(
  agentId: string,
  startDate: Date,
  endDate: Date
): Promise<Array<{
  source: string;
  count: number;
  tokensInput: number;
  tokensOutput: number;
}>> {
  const rows = await query<{
    source: string;
    event_count: number;
    tokens_input: number;
    tokens_output: number;
  }>(
    `SELECT 
      source,
      COUNT(*) as event_count,
      COALESCE(SUM(tokens_input), 0) as tokens_input,
      COALESCE(SUM(tokens_output), 0) as tokens_output
    FROM agent_analytics
    WHERE agent_id = $1
      AND created_at >= $2
      AND created_at <= $3
    GROUP BY source
    ORDER BY event_count DESC`,
    [agentId, startDate.toISOString(), endDate.toISOString()]
  );

  return rows.map(row => ({
    source: row.source,
    count: row.event_count,
    tokensInput: row.tokens_input,
    tokensOutput: row.tokens_output,
  }));
}

/**
 * Get latency percentiles
 */
export async function getLatencyPercentiles(
  agentId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}> {
  const rows = await query<{ latency_ms: number }>(
    `SELECT latency_ms
    FROM agent_analytics
    WHERE agent_id = $1
      AND created_at >= $2
      AND created_at <= $3
      AND latency_ms > 0
      AND event_type = 'response'
    ORDER BY latency_ms ASC`,
    [agentId, startDate.toISOString(), endDate.toISOString()]
  );

  if (rows.length === 0) {
    return { p50: 0, p90: 0, p95: 0, p99: 0 };
  }

  const values = rows.map(r => r.latency_ms);
  const percentile = (p: number) => {
    const idx = Math.ceil((p / 100) * values.length) - 1;
    return values[Math.max(0, idx)];
  };

  return {
    p50: percentile(50),
    p90: percentile(90),
    p95: percentile(95),
    p99: percentile(99),
  };
}

/**
 * Get tool/skill usage breakdown
 */
export async function getToolUsage(
  agentId: string,
  startDate: Date,
  endDate: Date
): Promise<Array<{
  toolName: string;
  callCount: number;
  successCount: number;
  errorCount: number;
}>> {
  const rows = await query<{
    tool_name: string;
    call_count: number;
    success_count: number;
    error_count: number;
  }>(
    `SELECT 
      metadata->>'toolName' as tool_name,
      COUNT(*) as call_count,
      COUNT(CASE WHEN success = true THEN 1 END) as success_count,
      COUNT(CASE WHEN success = false THEN 1 END) as error_count
    FROM agent_analytics
    WHERE agent_id = $1
      AND event_type = 'tool_call'
      AND created_at >= $2
      AND created_at <= $3
    GROUP BY tool_name
    ORDER BY call_count DESC`,
    [agentId, startDate.toISOString(), endDate.toISOString()]
  );

  return rows.map(row => ({
    toolName: row.tool_name || 'unknown',
    callCount: row.call_count,
    successCount: row.success_count,
    errorCount: row.error_count,
  }));
}

/**
 * Get recent errors
 */
export async function getRecentErrors(
  agentId: string,
  limit: number = 10
): Promise<Array<{
  id: string;
  eventType: string;
  source: string;
  errorMessage: string;
  createdAt: string;
}>> {
  const rows = await query<{
    id: string;
    event_type: string;
    source: string;
    error_message: string;
    created_at: string;
  }>(
    `SELECT id, event_type, source, error_message, created_at
    FROM agent_analytics
    WHERE agent_id = $1
      AND success = false
    ORDER BY created_at DESC
    LIMIT $2`,
    [agentId, limit]
  );

  return rows.map(row => ({
    id: row.id,
    eventType: row.event_type,
    source: row.source,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  }));
}

/**
 * Get Knowledge Base analytics
 */
export async function getKBAnalytics(
  agentId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  totalSearches: number;
  successfulSearches: number;
  hitRate: number;
  topQueries: Array<{ query: string; count: number }>;
  topDocuments: Array<{ document: string; accessCount: number; avgScore: number }>;
}> {
  // Get search stats
  const statsResult = await query<{
    total_searches: number;
    successful_searches: number;
  }>(
    `SELECT 
      COUNT(*) as total_searches,
      COUNT(CASE WHEN success = true THEN 1 END) as successful_searches
    FROM agent_analytics
    WHERE agent_id = $1
      AND event_type = 'kb_search'
      AND created_at >= $2
      AND created_at <= $3`,
    [agentId, startDate.toISOString(), endDate.toISOString()]
  );
  
  const stats = statsResult[0] || { total_searches: 0, successful_searches: 0 };
  
  // Get top queries
  const topQueriesResult = await query<{ search_query: string; query_count: number }>(
    `SELECT 
      metadata->>'query' as search_query,
      COUNT(*) as query_count
    FROM agent_analytics
    WHERE agent_id = $1
      AND event_type = 'kb_search'
      AND created_at >= $2
      AND created_at <= $3
    GROUP BY search_query
    ORDER BY query_count DESC
    LIMIT 10`,
    [agentId, startDate.toISOString(), endDate.toISOString()]
  );
  
  // Get top documents
  const topDocsResult = await query<{ document: string; access_count: number; avg_score: number }>(
    `SELECT 
      metadata->>'topDocument' as document,
      COUNT(*) as access_count,
      AVG((metadata->>'topScore')::float) as avg_score
    FROM agent_analytics
    WHERE agent_id = $1
      AND event_type = 'kb_search'
      AND success = true
      AND created_at >= $2
      AND created_at <= $3
      AND metadata->>'topDocument' IS NOT NULL
    GROUP BY document
    ORDER BY access_count DESC
    LIMIT 10`,
    [agentId, startDate.toISOString(), endDate.toISOString()]
  );
  
  return {
    totalSearches: stats.total_searches,
    successfulSearches: stats.successful_searches,
    hitRate: stats.total_searches > 0 
      ? (stats.successful_searches / stats.total_searches) * 100 
      : 0,
    topQueries: topQueriesResult.map(r => ({
      query: r.search_query || 'unknown',
      count: r.query_count,
    })),
    topDocuments: topDocsResult.map(r => ({
      document: r.document || 'unknown',
      accessCount: r.access_count,
      avgScore: Math.round((r.avg_score || 0) * 100) / 100,
    })),
  };
}

/**
 * Get sandbox statistics
 */
export async function getSandboxStats(
  agentId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  totalStarts: number;
  totalStops: number;
  avgLifetimeMs: number;
  totalRuntimeMs: number;
}> {
  // Get sandbox start/stop counts
  const counts = await query<{
    event_type: string;
    event_count: number;
  }>(
    `SELECT event_type, COUNT(*) as event_count
    FROM agent_analytics
    WHERE agent_id = $1
      AND event_type IN ('sandbox_start', 'sandbox_stop')
      AND created_at >= $2
      AND created_at <= $3
    GROUP BY event_type`,
    [agentId, startDate.toISOString(), endDate.toISOString()]
  );
  
  const starts = counts.find(c => c.event_type === 'sandbox_start')?.event_count || 0;
  const stops = counts.find(c => c.event_type === 'sandbox_stop')?.event_count || 0;
  
  // Calculate sandbox lifetimes from the sandboxes table if available
  const lifetimeResult = await query<{ avg_lifetime: number; total_runtime: number }>(
    `SELECT 
      AVG(EXTRACT(EPOCH FROM (COALESCE(expires_at, CURRENT_TIMESTAMP) - created_at)) * 1000) as avg_lifetime,
      SUM(EXTRACT(EPOCH FROM (COALESCE(expires_at, CURRENT_TIMESTAMP) - created_at)) * 1000) as total_runtime
    FROM sandboxes
    WHERE session_key LIKE $1
      AND created_at >= $2
      AND created_at <= $3`,
    [`%${agentId}%`, startDate.toISOString(), endDate.toISOString()]
  );
  
  const lifetime = lifetimeResult[0] || { avg_lifetime: 0, total_runtime: 0 };
  
  return {
    totalStarts: starts,
    totalStops: stops,
    avgLifetimeMs: Math.round(lifetime.avg_lifetime || 0),
    totalRuntimeMs: Math.round(lifetime.total_runtime || 0),
  };
}

/**
 * Get active sessions count (real-time)
 */
export async function getActiveSessions(agentId: string): Promise<{
  portalSessions: number;
  embedSessions: number;
  chatSessions: number;
  total: number;
}> {
  // Count active sandboxes (only count non-expired)
  const sandboxResult = await query<{ session_type: string; count: number }>(
    `SELECT 
      CASE 
        WHEN session_key LIKE 'portal-%' THEN 'portal'
        WHEN session_key LIKE 'embed-%' THEN 'embed'
        ELSE 'chat'
      END as session_type,
      COUNT(*) as count
    FROM sandboxes
    WHERE session_key LIKE $1
      AND status = 'running'
      AND (expires_at IS NULL OR expires_at > NOW())
    GROUP BY session_type`,
    [`%${agentId}%`]
  );
  
  const portal = sandboxResult.find(r => r.session_type === 'portal')?.count || 0;
  const embed = sandboxResult.find(r => r.session_type === 'embed')?.count || 0;
  const chat = sandboxResult.find(r => r.session_type === 'chat')?.count || 0;
  
  return {
    portalSessions: portal,
    embedSessions: embed,
    chatSessions: chat,
    total: portal + embed + chat,
  };
}

/**
 * Get session duration stats
 */
export async function getSessionDurations(
  agentId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  totalSessions: number;
}> {
  // Calculate duration between session_start and session_end events
  // This is approximate - using sandbox lifetime as proxy
  const result = await query<{
    avg_duration: number;
    min_duration: number;
    max_duration: number;
    total_sessions: number;
  }>(
    `SELECT 
      AVG(EXTRACT(EPOCH FROM (COALESCE(expires_at, CURRENT_TIMESTAMP) - created_at)) * 1000) as avg_duration,
      MIN(EXTRACT(EPOCH FROM (COALESCE(expires_at, CURRENT_TIMESTAMP) - created_at)) * 1000) as min_duration,
      MAX(EXTRACT(EPOCH FROM (COALESCE(expires_at, CURRENT_TIMESTAMP) - created_at)) * 1000) as max_duration,
      COUNT(*) as total_sessions
    FROM sandboxes
    WHERE session_key LIKE $1
      AND created_at >= $2
      AND created_at <= $3`,
    [`%${agentId}%`, startDate.toISOString(), endDate.toISOString()]
  );
  
  const stats = result[0] || { avg_duration: 0, min_duration: 0, max_duration: 0, total_sessions: 0 };
  
  return {
    avgDurationMs: Math.round(stats.avg_duration || 0),
    minDurationMs: Math.round(stats.min_duration || 0),
    maxDurationMs: Math.round(stats.max_duration || 0),
    totalSessions: stats.total_sessions,
  };
}

/**
 * Get storage usage for a specific agent (only attached buckets/KBs)
 */
export async function getStorageUsage(
  agentId: string,
  _userId: string
): Promise<{
  kbStorageBytes: number;
  kbChunks: number;
  fileStorageBytes: number;
  fileCount: number;
  bucketCount: number;
}> {
  // Get KB stats for THIS agent only
  const kbResult = await query<{ total_chunks: number }>(
    `SELECT COALESCE(SUM(indexed_chunks), 0) as total_chunks
    FROM knowledge_bases kb
    INNER JOIN agent_knowledge_bases akb ON kb.id = akb.knowledge_base_id
    WHERE akb.session_id = $1`,
    [agentId]
  );
  
  // Get buckets attached to THIS agent only
  const bucketResult = await query<{ bucket_count: number }>(
    `SELECT COUNT(DISTINCT bucket_id) as bucket_count
    FROM agent_buckets
    WHERE session_id = $1`,
    [agentId]
  );
  
  // Get files from buckets attached to THIS agent only
  const fileResult = await query<{ file_count: number; total_size: number }>(
    `SELECT COUNT(*) as file_count, COALESCE(SUM(f.size), 0) as total_size
    FROM files f
    INNER JOIN agent_buckets ab ON f.bucket_id = ab.bucket_id
    WHERE ab.session_id = $1`,
    [agentId]
  );
  
  const kbStats = kbResult[0] || { total_chunks: 0 };
  const bucketStats = bucketResult[0] || { bucket_count: 0 };
  const fileStats = fileResult[0] || { file_count: 0, total_size: 0 };
  
  // Estimate KB storage (rough estimate: ~500 bytes per chunk avg)
  const kbStorageEstimate = kbStats.total_chunks * 500;
  
  return {
    kbStorageBytes: kbStorageEstimate,
    kbChunks: kbStats.total_chunks,
    fileStorageBytes: fileStats.total_size,
    fileCount: fileStats.file_count,
    bucketCount: bucketStats.bucket_count,
  };
}

/**
 * Get system-wide storage and usage stats (for system observability page)
 */
export async function getSystemStats(userId: string): Promise<{
  totalAgents: number;
  activeAgents: number;
  activeSandboxes: number;
  totalMessages: number;
  totalSessions: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalFiles: number;
  totalFileStorage: number;
  totalKBChunks: number;
  totalBuckets: number;
  totalKnowledgeBases: number;
  errorRate: number;
}> {
  // Get agent counts
  const agentCounts = await query<{ total: number; active: number }>(
    `SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'active' THEN 1 END) as active
    FROM sessions
    WHERE user_id = $1`,
    [userId]
  );
  
  // Get active sandbox count (only count non-expired sandboxes)
  const sandboxCount = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM sandboxes 
     WHERE status = 'running' 
     AND (expires_at IS NULL OR expires_at > NOW())`,
    []
  );
  
  // Get analytics totals for this user's agents
  const analyticsTotals = await query<{
    total_messages: number;
    total_sessions: number;
    total_tokens_input: number;
    total_tokens_output: number;
    success_count: number;
    total_count: number;
  }>(
    `SELECT 
      COUNT(CASE WHEN event_type = 'message' THEN 1 END) as total_messages,
      COUNT(CASE WHEN event_type = 'session_start' THEN 1 END) as total_sessions,
      COALESCE(SUM(tokens_input), 0) as total_tokens_input,
      COALESCE(SUM(tokens_output), 0) as total_tokens_output,
      COUNT(CASE WHEN success = true THEN 1 END) as success_count,
      COUNT(*) as total_count
    FROM agent_analytics aa
    INNER JOIN sessions s ON aa.agent_id = s.id
    WHERE s.user_id = $1`,
    [userId]
  );
  
  // Get storage totals
  const storageTotals = await query<{ file_count: number; total_size: number; bucket_count: number }>(
    `SELECT 
      COUNT(f.id) as file_count,
      COALESCE(SUM(f.size), 0) as total_size,
      COUNT(DISTINCT b.id) as bucket_count
    FROM buckets b
    LEFT JOIN files f ON f.bucket_id = b.id
    WHERE b.user_id = $1`,
    [userId]
  );
  
  // Get KB totals
  const kbTotals = await query<{ kb_count: number; total_chunks: number }>(
    `SELECT 
      COUNT(*) as kb_count,
      COALESCE(SUM(indexed_chunks), 0) as total_chunks
    FROM knowledge_bases
    WHERE user_id = $1`,
    [userId]
  );
  
  const agents = agentCounts[0] || { total: 0, active: 0 };
  const sandboxes = sandboxCount[0] || { count: 0 };
  const analytics = analyticsTotals[0] || { 
    total_messages: 0, total_sessions: 0, total_tokens_input: 0, 
    total_tokens_output: 0, success_count: 0, total_count: 0 
  };
  const storage = storageTotals[0] || { file_count: 0, total_size: 0, bucket_count: 0 };
  const kbs = kbTotals[0] || { kb_count: 0, total_chunks: 0 };
  
  const errorRate = analytics.total_count > 0 
    ? ((analytics.total_count - analytics.success_count) / analytics.total_count) * 100 
    : 0;
  
  return {
    totalAgents: agents.total,
    activeAgents: agents.active,
    activeSandboxes: sandboxes.count,
    totalMessages: analytics.total_messages,
    totalSessions: analytics.total_sessions,
    totalTokensInput: analytics.total_tokens_input,
    totalTokensOutput: analytics.total_tokens_output,
    totalFiles: storage.file_count,
    totalFileStorage: storage.total_size,
    totalKBChunks: kbs.total_chunks,
    totalBuckets: storage.bucket_count,
    totalKnowledgeBases: kbs.kb_count,
    errorRate,
  };
}

/**
 * Get top agents by usage
 */
export async function getTopAgents(
  userId: string,
  limit: number = 10
): Promise<Array<{
  agentId: string;
  agentName: string;
  messageCount: number;
  sessionCount: number;
  lastActive: string;
}>> {
  const rows = await query<{
    agent_id: string;
    agent_name: string;
    message_count: number;
    session_count: number;
    last_active: string;
  }>(
    `SELECT 
      s.id as agent_id,
      COALESCE(ac.name, s.repo_name, 'Unnamed Agent') as agent_name,
      COUNT(CASE WHEN aa.event_type = 'message' THEN 1 END) as message_count,
      COUNT(CASE WHEN aa.event_type = 'session_start' THEN 1 END) as session_count,
      MAX(aa.created_at) as last_active
    FROM sessions s
    LEFT JOIN agent_configs ac ON s.id = ac.session_id
    LEFT JOIN agent_analytics aa ON s.id = aa.agent_id
    WHERE s.user_id = $1
    GROUP BY s.id, ac.name, s.repo_name
    ORDER BY message_count DESC
    LIMIT $2`,
    [userId, limit]
  );
  
  return rows.map(r => ({
    agentId: r.agent_id,
    agentName: r.agent_name,
    messageCount: r.message_count || 0,
    sessionCount: r.session_count || 0,
    lastActive: r.last_active || '',
  }));
}

// ============================================
// NEW ANALYTICS FUNCTIONS
// ============================================

/**
 * Get week-over-week comparison for system stats
 */
export async function getWoWComparison(userId: string): Promise<{
  messagesChange: number;
  sessionsChange: number;
  tokensChange: number;
  errorsChange: number;
}> {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // This week
  const thisWeek = await query<{
    messages: number;
    sessions: number;
    tokens: number;
    errors: number;
  }>(
    `SELECT 
      COUNT(CASE WHEN event_type = 'message' THEN 1 END) as messages,
      COUNT(CASE WHEN event_type = 'session_start' THEN 1 END) as sessions,
      COALESCE(SUM(tokens_input + tokens_output), 0) as tokens,
      COUNT(CASE WHEN success = false THEN 1 END) as errors
    FROM agent_analytics aa
    INNER JOIN sessions s ON aa.agent_id = s.id
    WHERE s.user_id = $1 AND aa.created_at >= $2`,
    [userId, oneWeekAgo.toISOString()]
  );

  // Last week
  const lastWeek = await query<{
    messages: number;
    sessions: number;
    tokens: number;
    errors: number;
  }>(
    `SELECT 
      COUNT(CASE WHEN event_type = 'message' THEN 1 END) as messages,
      COUNT(CASE WHEN event_type = 'session_start' THEN 1 END) as sessions,
      COALESCE(SUM(tokens_input + tokens_output), 0) as tokens,
      COUNT(CASE WHEN success = false THEN 1 END) as errors
    FROM agent_analytics aa
    INNER JOIN sessions s ON aa.agent_id = s.id
    WHERE s.user_id = $1 AND aa.created_at >= $2 AND aa.created_at < $3`,
    [userId, twoWeeksAgo.toISOString(), oneWeekAgo.toISOString()]
  );

  const tw = thisWeek[0] || { messages: 0, sessions: 0, tokens: 0, errors: 0 };
  const lw = lastWeek[0] || { messages: 0, sessions: 0, tokens: 0, errors: 0 };

  const calcChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  return {
    messagesChange: calcChange(tw.messages, lw.messages),
    sessionsChange: calcChange(tw.sessions, lw.sessions),
    tokensChange: calcChange(tw.tokens, lw.tokens),
    errorsChange: calcChange(tw.errors, lw.errors),
  };
}

/**
 * Get system-wide source distribution
 */
export async function getSystemSourceDistribution(userId: string): Promise<Array<{
  source: string;
  count: number;
  percentage: number;
}>> {
  const rows = await query<{ source: string; count: number }>(
    `SELECT source, COUNT(*) as count
    FROM agent_analytics aa
    INNER JOIN sessions s ON aa.agent_id = s.id
    WHERE s.user_id = $1 AND event_type IN ('message', 'response')
    GROUP BY source
    ORDER BY count DESC`,
    [userId]
  );

  const total = rows.reduce((sum, r) => sum + r.count, 0);
  
  return rows.map(r => ({
    source: r.source,
    count: r.count,
    percentage: total > 0 ? (r.count / total) * 100 : 0,
  }));
}

/**
 * Get conversation depth (avg messages per session)
 */
export async function getConversationDepth(
  agentId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  avgMessagesPerSession: number;
  avgResponsesPerSession: number;
  totalConversations: number;
  shortConversations: number;  // 1-2 messages
  mediumConversations: number; // 3-10 messages
  longConversations: number;   // 10+ messages
}> {
  // Get message counts per thread
  const threads = await query<{ thread_id: string; message_count: number }>(
    `SELECT thread_id, COUNT(*) as message_count
    FROM agent_analytics
    WHERE agent_id = $1 AND created_at BETWEEN $2 AND $3
      AND event_type = 'message' AND thread_id IS NOT NULL
    GROUP BY thread_id`,
    [agentId, startDate.toISOString(), endDate.toISOString()]
  );

  const responseCounts = await query<{ thread_id: string; response_count: number }>(
    `SELECT thread_id, COUNT(*) as response_count
    FROM agent_analytics
    WHERE agent_id = $1 AND created_at BETWEEN $2 AND $3
      AND event_type = 'response' AND thread_id IS NOT NULL
    GROUP BY thread_id`,
    [agentId, startDate.toISOString(), endDate.toISOString()]
  );

  const totalConversations = threads.length;
  const totalMessages = threads.reduce((sum, t) => sum + t.message_count, 0);
  const totalResponses = responseCounts.reduce((sum, t) => sum + t.response_count, 0);
  
  let shortConversations = 0;
  let mediumConversations = 0;
  let longConversations = 0;

  threads.forEach(t => {
    if (t.message_count <= 2) shortConversations++;
    else if (t.message_count <= 10) mediumConversations++;
    else longConversations++;
  });

  return {
    avgMessagesPerSession: totalConversations > 0 ? totalMessages / totalConversations : 0,
    avgResponsesPerSession: totalConversations > 0 ? totalResponses / totalConversations : 0,
    totalConversations,
    shortConversations,
    mediumConversations,
    longConversations,
  };
}

/**
 * Get peak hours heatmap data (hour x day of week)
 */
export async function getPeakHours(
  agentId: string | null, // null for system-wide
  userId: string,
  days: number = 30
): Promise<Array<{
  dayOfWeek: number; // 0 = Sunday
  hour: number;      // 0-23
  count: number;
}>> {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let sql: string;
  let params: any[];

  if (agentId) {
    sql = `SELECT 
      EXTRACT(DOW FROM created_at) as day_of_week,
      EXTRACT(HOUR FROM created_at) as hour,
      COUNT(*) as count
    FROM agent_analytics
    WHERE agent_id = $1 AND created_at >= $2 AND event_type IN ('message', 'response')
    GROUP BY EXTRACT(DOW FROM created_at), EXTRACT(HOUR FROM created_at)
    ORDER BY day_of_week, hour`;
    params = [agentId, startDate.toISOString()];
  } else {
    sql = `SELECT 
      EXTRACT(DOW FROM aa.created_at) as day_of_week,
      EXTRACT(HOUR FROM aa.created_at) as hour,
      COUNT(*) as count
    FROM agent_analytics aa
    INNER JOIN sessions s ON aa.agent_id = s.id
    WHERE s.user_id = $1 AND aa.created_at >= $2 AND aa.event_type IN ('message', 'response')
    GROUP BY EXTRACT(DOW FROM aa.created_at), EXTRACT(HOUR FROM aa.created_at)
    ORDER BY day_of_week, hour`;
    params = [userId, startDate.toISOString()];
  }

  const rows = await query<{ day_of_week: number; hour: number; count: number }>(sql, params);
  
  return rows.map(r => ({
    dayOfWeek: r.day_of_week,
    hour: r.hour,
    count: r.count,
  }));
}

/**
 * Get API-specific stats for an agent
 */
export async function getApiStats(
  agentId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  totalRequests: number;
  totalResponses: number;
  totalErrors: number;
  avgResponseTimeMs: number;
  successRate: number;
  tokensIn: number;
  tokensOut: number;
  uniqueApiKeys: number;
  requestsOverTime: Array<{ date: string; requests: number; errors: number }>;
}> {
  // Get overall stats for API source
  const stats = await query<{
    total_requests: number;
    total_responses: number;
    total_errors: number;
    avg_latency: number;
    success_count: number;
    tokens_in: number;
    tokens_out: number;
  }>(
    `SELECT 
      COUNT(CASE WHEN event_type = 'message' THEN 1 END) as total_requests,
      COUNT(CASE WHEN event_type = 'response' THEN 1 END) as total_responses,
      COUNT(CASE WHEN event_type = 'error' THEN 1 END) as total_errors,
      AVG(latency_ms) as avg_latency,
      COUNT(CASE WHEN success = true THEN 1 END) as success_count,
      COALESCE(SUM(tokens_input), 0) as tokens_in,
      COALESCE(SUM(tokens_output), 0) as tokens_out
    FROM agent_analytics
    WHERE agent_id = $1 AND source = 'api' AND created_at BETWEEN $2 AND $3`,
    [agentId, startDate.toISOString(), endDate.toISOString()]
  );

  // Get unique API keys (from user_id which stores API key hash for API calls)
  const apiKeyCount = await query<{ count: number }>(
    `SELECT COUNT(DISTINCT user_id) as count
    FROM agent_analytics
    WHERE agent_id = $1 AND source = 'api' AND created_at BETWEEN $2 AND $3 AND user_id IS NOT NULL`,
    [agentId, startDate.toISOString(), endDate.toISOString()]
  );

  // Get requests over time
  const timeQuery = `SELECT 
    DATE(created_at) as date,
    COUNT(CASE WHEN event_type = 'message' THEN 1 END) as requests,
    COUNT(CASE WHEN event_type = 'error' THEN 1 END) as errors
  FROM agent_analytics
  WHERE agent_id = $1 AND source = 'api' AND created_at BETWEEN $2 AND $3
  GROUP BY DATE(created_at)
  ORDER BY date`;

  const timeline = await query<{ date: string; requests: number; errors: number }>(
    timeQuery,
    [agentId, startDate.toISOString(), endDate.toISOString()]
  );

  const s = stats[0] || { 
    total_requests: 0, total_responses: 0, total_errors: 0, 
    avg_latency: 0, success_count: 0, tokens_in: 0, tokens_out: 0 
  };

  const totalCalls = s.total_requests + s.total_responses + s.total_errors;

  return {
    totalRequests: s.total_requests,
    totalResponses: s.total_responses,
    totalErrors: s.total_errors,
    avgResponseTimeMs: Math.round(s.avg_latency || 0),
    successRate: totalCalls > 0 ? (s.success_count / totalCalls) * 100 : 100,
    tokensIn: s.tokens_in,
    tokensOut: s.tokens_out,
    uniqueApiKeys: apiKeyCount[0]?.count || 0,
    requestsOverTime: timeline.map(t => ({
      date: t.date,
      requests: t.requests,
      errors: t.errors,
    })),
  };
}

/**
 * Get response length stats
 */
export async function getResponseLengthStats(
  agentId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  avgTokensPerResponse: number;
  minTokens: number;
  maxTokens: number;
  medianTokens: number;
}> {
  const rows = await query<{ tokens_output: number }>(
    `SELECT tokens_output
    FROM agent_analytics
    WHERE agent_id = $1 AND event_type = 'response' AND created_at BETWEEN $2 AND $3
      AND tokens_output > 0
    ORDER BY tokens_output`,
    [agentId, startDate.toISOString(), endDate.toISOString()]
  );

  if (rows.length === 0) {
    return { avgTokensPerResponse: 0, minTokens: 0, maxTokens: 0, medianTokens: 0 };
  }

  const tokens = rows.map(r => r.tokens_output);
  const sum = tokens.reduce((a, b) => a + b, 0);
  const median = tokens[Math.floor(tokens.length / 2)];

  return {
    avgTokensPerResponse: Math.round(sum / tokens.length),
    minTokens: Math.min(...tokens),
    maxTokens: Math.max(...tokens),
    medianTokens: median,
  };
}

/**
 * Get system-wide sandbox usage for today
 */
export async function getSandboxUsageToday(userId: string): Promise<{
  startsToday: number;
  stopsToday: number;
  startsYesterday: number;
  currentlyRunning: number;
  avgLifetimeMinutes: number;
  peakConcurrent: number;
}> {
  // Get start of today and yesterday
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString();
  
  // Get sandbox starts/stops for today
  const todayCounts = await query<{ event_type: string; count: number }>(
    `SELECT aa.event_type, COUNT(*) as count
    FROM agent_analytics aa
    INNER JOIN sessions s ON aa.agent_id = s.id
    WHERE s.user_id = $1
      AND aa.event_type IN ('sandbox_start', 'sandbox_stop')
      AND aa.created_at >= $2
    GROUP BY aa.event_type`,
    [userId, todayStart]
  );
  
  // Get sandbox starts for yesterday (for comparison)
  const yesterdayCounts = await query<{ count: number }>(
    `SELECT COUNT(*) as count
    FROM agent_analytics aa
    INNER JOIN sessions s ON aa.agent_id = s.id
    WHERE s.user_id = $1
      AND aa.event_type = 'sandbox_start'
      AND aa.created_at >= $2
      AND aa.created_at < $3`,
    [userId, yesterdayStart, todayStart]
  );
  
  // Get currently running sandboxes (only count non-expired)
  const runningCount = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM sandboxes 
     WHERE status = 'running' 
     AND (expires_at IS NULL OR expires_at > NOW())`,
    []
  );
  
  // Get average lifetime from sandboxes table
  const lifetimeStats = await query<{ avg_lifetime: number }>(
    `SELECT AVG(EXTRACT(EPOCH FROM (COALESCE(expires_at, CURRENT_TIMESTAMP) - created_at)) / 60) as avg_lifetime
    FROM sandboxes
    WHERE created_at >= $1`,
    [yesterdayStart]
  );
  
  const startsToday = todayCounts.find(c => c.event_type === 'sandbox_start')?.count || 0;
  const stopsToday = todayCounts.find(c => c.event_type === 'sandbox_stop')?.count || 0;
  
  return {
    startsToday,
    stopsToday,
    startsYesterday: yesterdayCounts[0]?.count || 0,
    currentlyRunning: runningCount[0]?.count || 0,
    avgLifetimeMinutes: Math.round(lifetimeStats[0]?.avg_lifetime || 0),
    peakConcurrent: Math.max(startsToday - stopsToday, runningCount[0]?.count || 0),
  };
}

/**
 * Get system-wide top tools usage
 */
export async function getSystemTopTools(
  userId: string,
  limit: number = 10
): Promise<Array<{
  toolName: string;
  callCount: number;
  successCount: number;
  errorCount: number;
  agentCount: number;
}>> {
  const rows = await query<{
    tool_name: string;
    call_count: number;
    success_count: number;
    error_count: number;
    agent_count: number;
  }>(
    `SELECT 
      aa.metadata->>'toolName' as tool_name,
      COUNT(*) as call_count,
      COUNT(CASE WHEN aa.success = true THEN 1 END) as success_count,
      COUNT(CASE WHEN aa.success = false THEN 1 END) as error_count,
      COUNT(DISTINCT aa.agent_id) as agent_count
    FROM agent_analytics aa
    INNER JOIN sessions s ON aa.agent_id = s.id
    WHERE s.user_id = $1
      AND aa.event_type = 'tool_call'
      AND aa.created_at >= (CURRENT_TIMESTAMP - INTERVAL '30 days')
    GROUP BY tool_name
    ORDER BY call_count DESC
    LIMIT $2`,
    [userId, limit]
  );
  
  return rows
    .filter(r => r.tool_name) // Filter out nulls
    .map(r => ({
      toolName: r.tool_name || 'unknown',
      callCount: r.call_count || 0,
      successCount: r.success_count || 0,
      errorCount: r.error_count || 0,
      agentCount: r.agent_count || 0,
    }));
}
