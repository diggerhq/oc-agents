/**
 * Analytics Routes
 * 
 * Provides observability data for agents.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { queryOne, query } from '../db/index.js';
import {
  getUsageSummary,
  getUsageOverTime,
  getUsageBySource,
  getLatencyPercentiles,
  getToolUsage,
  getRecentErrors,
  getKBAnalytics,
  getSandboxStats,
  getActiveSessions,
  getSessionDurations,
  getStorageUsage,
  getSystemStats,
  getTopAgents,
  getWoWComparison,
  getSystemSourceDistribution,
  getConversationDepth,
  getPeakHours,
  getApiStats,
  getResponseLengthStats,
  getSandboxUsageToday,
  getSystemTopTools,
} from '../services/analytics.js';

const router = Router();

interface AuthenticatedRequest extends Request {
  session: Request['session'] & { userId?: string };
}

// Verify agent belongs to user
async function verifyAgentOwnership(agentId: string, userId: string): Promise<boolean> {
  const session = await queryOne<{ id: string }>(
    'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
    [agentId, userId]
  );
  return !!session;
}

/**
 * Get analytics summary for an agent
 * GET /api/analytics/:agentId/summary?startDate=...&endDate=...
 */
router.get('/:agentId/summary', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.session.userId!;

    // Verify ownership
    if (!await verifyAgentOwnership(agentId, userId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Parse date range (default: last 7 days)
    const endDate = req.query.endDate 
      ? new Date(req.query.endDate as string)
      : new Date();
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    const summary = await getUsageSummary(agentId, startDate, endDate);

    res.json({ success: true, summary });
  } catch (error) {
    console.error('[Analytics] Error getting summary:', error);
    res.status(500).json({ error: 'Failed to get analytics summary' });
  }
});

/**
 * Get usage over time for charts
 * GET /api/analytics/:agentId/usage-over-time?startDate=...&endDate=...&granularity=day|hour
 */
router.get('/:agentId/usage-over-time', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.session.userId!;

    if (!await verifyAgentOwnership(agentId, userId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const endDate = req.query.endDate 
      ? new Date(req.query.endDate as string)
      : new Date();
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    const granularity = (req.query.granularity as 'hour' | 'day') || 'day';

    const data = await getUsageOverTime(agentId, startDate, endDate, granularity);

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting usage over time:', error);
    res.status(500).json({ error: 'Failed to get usage data' });
  }
});

/**
 * Get usage breakdown by source
 * GET /api/analytics/:agentId/by-source?startDate=...&endDate=...
 */
router.get('/:agentId/by-source', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.session.userId!;

    if (!await verifyAgentOwnership(agentId, userId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const endDate = req.query.endDate 
      ? new Date(req.query.endDate as string)
      : new Date();
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    const data = await getUsageBySource(agentId, startDate, endDate);

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting usage by source:', error);
    res.status(500).json({ error: 'Failed to get source breakdown' });
  }
});

/**
 * Get latency percentiles
 * GET /api/analytics/:agentId/latency?startDate=...&endDate=...
 */
router.get('/:agentId/latency', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.session.userId!;

    if (!await verifyAgentOwnership(agentId, userId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const endDate = req.query.endDate 
      ? new Date(req.query.endDate as string)
      : new Date();
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    const percentiles = await getLatencyPercentiles(agentId, startDate, endDate);

    res.json({ success: true, percentiles });
  } catch (error) {
    console.error('[Analytics] Error getting latency:', error);
    res.status(500).json({ error: 'Failed to get latency data' });
  }
});

/**
 * Get tool/skill usage
 * GET /api/analytics/:agentId/tools?startDate=...&endDate=...
 */
router.get('/:agentId/tools', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.session.userId!;

    if (!await verifyAgentOwnership(agentId, userId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const endDate = req.query.endDate 
      ? new Date(req.query.endDate as string)
      : new Date();
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    const data = await getToolUsage(agentId, startDate, endDate);

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting tool usage:', error);
    res.status(500).json({ error: 'Failed to get tool usage' });
  }
});

/**
 * Get recent errors
 * GET /api/analytics/:agentId/errors?limit=10
 */
router.get('/:agentId/errors', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.session.userId!;

    if (!await verifyAgentOwnership(agentId, userId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const limit = parseInt(req.query.limit as string) || 10;
    const errors = await getRecentErrors(agentId, limit);

    res.json({ success: true, errors });
  } catch (error) {
    console.error('[Analytics] Error getting errors:', error);
    res.status(500).json({ error: 'Failed to get error data' });
  }
});

/**
 * Get Knowledge Base analytics
 * GET /api/analytics/:agentId/kb?startDate=...&endDate=...
 */
router.get('/:agentId/kb', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.session.userId!;

    if (!await verifyAgentOwnership(agentId, userId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const endDate = req.query.endDate 
      ? new Date(req.query.endDate as string)
      : new Date();
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    const data = await getKBAnalytics(agentId, startDate, endDate);

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting KB analytics:', error);
    res.status(500).json({ error: 'Failed to get KB analytics' });
  }
});

/**
 * Get sandbox stats
 * GET /api/analytics/:agentId/sandbox?startDate=...&endDate=...
 */
router.get('/:agentId/sandbox', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.session.userId!;

    if (!await verifyAgentOwnership(agentId, userId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const endDate = req.query.endDate 
      ? new Date(req.query.endDate as string)
      : new Date();
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    const data = await getSandboxStats(agentId, startDate, endDate);

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting sandbox stats:', error);
    res.status(500).json({ error: 'Failed to get sandbox stats' });
  }
});

/**
 * Get active sessions (real-time)
 * GET /api/analytics/:agentId/active-sessions
 */
router.get('/:agentId/active-sessions', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.session.userId!;

    if (!await verifyAgentOwnership(agentId, userId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const data = await getActiveSessions(agentId);

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting active sessions:', error);
    res.status(500).json({ error: 'Failed to get active sessions' });
  }
});

/**
 * Get session durations
 * GET /api/analytics/:agentId/session-durations?startDate=...&endDate=...
 */
router.get('/:agentId/session-durations', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.session.userId!;

    if (!await verifyAgentOwnership(agentId, userId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const endDate = req.query.endDate 
      ? new Date(req.query.endDate as string)
      : new Date();
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    const data = await getSessionDurations(agentId, startDate, endDate);

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting session durations:', error);
    res.status(500).json({ error: 'Failed to get session durations' });
  }
});

/**
 * Get storage usage
 * GET /api/analytics/:agentId/storage
 */
router.get('/:agentId/storage', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.session.userId!;

    if (!await verifyAgentOwnership(agentId, userId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const data = await getStorageUsage(agentId, userId);

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting storage usage:', error);
    res.status(500).json({ error: 'Failed to get storage usage' });
  }
});

/**
 * Check if agent has knowledge bases attached
 * GET /api/analytics/:agentId/has-kb
 */
router.get('/:agentId/has-kb', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.session.userId!;

    if (!await verifyAgentOwnership(agentId, userId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const kbs = await query<{ id: string }>(
      `SELECT kb.id FROM knowledge_bases kb
       INNER JOIN agent_knowledge_bases akb ON kb.id = akb.knowledge_base_id
       WHERE akb.session_id = $1`,
      [agentId]
    );

    res.json({ success: true, hasKnowledgeBases: kbs.length > 0, count: kbs.length });
  } catch (error) {
    console.error('[Analytics] Error checking KB:', error);
    res.status(500).json({ error: 'Failed to check KB' });
  }
});

// ============================================
// SYSTEM-LEVEL ANALYTICS
// ============================================

/**
 * Get system-wide stats for the current user
 * GET /api/analytics/system/overview
 */
router.get('/system/overview', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.session.userId!;
    const data = await getSystemStats(userId);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting system stats:', error);
    res.status(500).json({ error: 'Failed to get system stats' });
  }
});

/**
 * Get top agents by usage
 * GET /api/analytics/system/top-agents?limit=10
 */
router.get('/system/top-agents', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.session.userId!;
    const limit = parseInt(req.query.limit as string) || 10;
    const data = await getTopAgents(userId, limit);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting top agents:', error);
    res.status(500).json({ error: 'Failed to get top agents' });
  }
});

/**
 * Get week-over-week comparison
 * GET /api/analytics/system/wow
 */
router.get('/system/wow', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.session.userId!;
    const data = await getWoWComparison(userId);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting WoW:', error);
    res.status(500).json({ error: 'Failed to get WoW comparison' });
  }
});

/**
 * Get system-wide source distribution
 * GET /api/analytics/system/source-distribution
 */
router.get('/system/source-distribution', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.session.userId!;
    const data = await getSystemSourceDistribution(userId);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting source distribution:', error);
    res.status(500).json({ error: 'Failed to get source distribution' });
  }
});

/**
 * Get system-wide peak hours heatmap
 * GET /api/analytics/system/peak-hours?days=30
 */
router.get('/system/peak-hours', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.session.userId!;
    const days = parseInt(req.query.days as string) || 30;
    const data = await getPeakHours(null, userId, days);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting peak hours:', error);
    res.status(500).json({ error: 'Failed to get peak hours' });
  }
});

/**
 * Get sandbox usage for today
 * GET /api/analytics/system/sandbox-usage-today
 */
router.get('/system/sandbox-usage-today', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.session.userId!;
    const data = await getSandboxUsageToday(userId);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting sandbox usage:', error);
    res.status(500).json({ error: 'Failed to get sandbox usage' });
  }
});

/**
 * Get system-wide top tools usage
 * GET /api/analytics/system/top-tools?limit=10
 */
router.get('/system/top-tools', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.session.userId!;
    const limit = parseInt(req.query.limit as string) || 10;
    const data = await getSystemTopTools(userId, limit);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting top tools:', error);
    res.status(500).json({ error: 'Failed to get top tools' });
  }
});

// ============================================
// AGENT-LEVEL NEW ENDPOINTS
// ============================================

/**
 * Get conversation depth for an agent
 * GET /api/analytics/:agentId/conversation-depth?startDate=...&endDate=...
 */
router.get('/:agentId/conversation-depth', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.session.userId!;

    if (!await verifyAgentOwnership(agentId, userId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const endDate = req.query.endDate 
      ? new Date(req.query.endDate as string)
      : new Date();
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    const data = await getConversationDepth(agentId, startDate, endDate);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting conversation depth:', error);
    res.status(500).json({ error: 'Failed to get conversation depth' });
  }
});

/**
 * Get peak hours for an agent
 * GET /api/analytics/:agentId/peak-hours?days=30
 */
router.get('/:agentId/peak-hours', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.session.userId!;

    if (!await verifyAgentOwnership(agentId, userId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const days = parseInt(req.query.days as string) || 30;
    const data = await getPeakHours(agentId, userId, days);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting peak hours:', error);
    res.status(500).json({ error: 'Failed to get peak hours' });
  }
});

/**
 * Get API stats for an agent
 * GET /api/analytics/:agentId/api-stats?startDate=...&endDate=...
 */
router.get('/:agentId/api-stats', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.session.userId!;

    if (!await verifyAgentOwnership(agentId, userId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const endDate = req.query.endDate 
      ? new Date(req.query.endDate as string)
      : new Date();
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    const data = await getApiStats(agentId, startDate, endDate);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting API stats:', error);
    res.status(500).json({ error: 'Failed to get API stats' });
  }
});

/**
 * Get response length stats for an agent
 * GET /api/analytics/:agentId/response-length?startDate=...&endDate=...
 */
router.get('/:agentId/response-length', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const userId = req.session.userId!;

    if (!await verifyAgentOwnership(agentId, userId)) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const endDate = req.query.endDate 
      ? new Date(req.query.endDate as string)
      : new Date();
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    const data = await getResponseLengthStats(agentId, startDate, endDate);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Error getting response length:', error);
    res.status(500).json({ error: 'Failed to get response length stats' });
  }
});

export default router;
