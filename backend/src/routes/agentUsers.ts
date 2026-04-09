import { Router } from 'express';
import { query, queryOne } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Types
interface PortalSession {
  id: string;
  agent_id: string;
  visitor_id: string;
  user_context: string | null;
  created_at: string;
  updated_at: string;
}

interface PortalThread {
  id: string;
  session_id: string;
  title: string | null;
  active_skills: string | null;
  created_at: string;
  updated_at: string;
}

interface PortalMessage {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  created_at: string;
}

interface EmbedUser {
  id: string;
  agent_id: string;
  user_identifier: string;
  user_context: string | null;
  created_at: string;
}

interface EmbedThread {
  id: string;
  user_id: string;
  title: string | null;
  active_skills: string | null;
  created_at: string;
  updated_at: string;
}

interface EmbedMessage {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  created_at: string;
}

// All routes require auth
router.use(requireAuth);

// GET /api/agents/:agentId/users - Get all users (portal + embed) for an agent
router.get('/:agentId/users', async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.session.userId;
    
    // SECURITY: Verify agent ownership
    const agent = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE id = $1',
      [agentId]
    );
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    if (agent.user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get unique portal visitors (group by visitor_id, get most recent session)
    // Using subquery approach that works with both PostgreSQL and SQLite
    const portalSessions = await query<PortalSession>(
      `SELECT ps.* FROM portal_sessions ps
       INNER JOIN (
         SELECT visitor_id, MAX(updated_at) as max_updated
         FROM portal_sessions
         WHERE agent_id = $1
         GROUP BY visitor_id
       ) latest ON ps.visitor_id = latest.visitor_id AND ps.updated_at = latest.max_updated
       WHERE ps.agent_id = $1
       ORDER BY ps.updated_at DESC`,
      [agentId]
    );
    
    // Get embed users (already unique by identifier)
    const embedUsers = await query<EmbedUser>(
      'SELECT * FROM embed_users WHERE agent_id = $1 ORDER BY created_at DESC',
      [agentId]
    );
    
    // Format portal sessions as users
    const portalUsers = portalSessions.map(session => {
      let context: Record<string, unknown> = {};
      try {
        context = session.user_context ? JSON.parse(session.user_context) : {};
      } catch { /* ignore */ }
      
      // Support both 'name' and 'user_name' fields
      const displayName = context.name || context.user_name || context.user_email || context.user_id || `Visitor ${session.visitor_id.slice(0, 8)}`;
      
      return {
        id: session.id,
        type: 'portal' as const,
        identifier: context.user_email || context.user_id || session.visitor_id,
        displayName,
        userContext: context,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      };
    });
    
    // Format embed users
    const embedUsersList = embedUsers.map(user => {
      let context: Record<string, unknown> = {};
      try {
        context = user.user_context ? JSON.parse(user.user_context) : {};
      } catch { /* ignore */ }
      
      return {
        id: user.id,
        type: 'embed' as const,
        identifier: user.user_identifier,
        displayName: (context.name as string) || user.user_identifier || `User ${user.id.slice(0, 8)}`,
        userContext: context,
        createdAt: user.created_at,
        updatedAt: user.created_at, // embed_users doesn't have updated_at
      };
    });
    
    // Combine and sort by updated_at
    const allUsers = [...portalUsers, ...embedUsersList].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    
    res.json({
      users: allUsers,
      total: allUsers.length,
      portalCount: portalUsers.length,
      embedCount: embedUsersList.length,
    });
  } catch (error) {
    console.error('Error fetching agent users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/agents/:agentId/users/:userId/threads - Get threads for a user
router.get('/:agentId/users/:userId/threads', async (req, res) => {
  try {
    const { agentId, userId: targetUserId } = req.params;
    const userType = req.query.type as string;
    const currentUserId = req.session.userId;
    
    // SECURITY: Verify agent ownership
    const agent = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE id = $1',
      [agentId]
    );
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    if (agent.user_id !== currentUserId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    let threads: Array<{
      id: string;
      title: string | null;
      messageCount: number;
      lastMessage: string | null;
      createdAt: string;
      updatedAt: string;
    }> = [];
    
    if (userType === 'portal') {
      // First get the visitor_id from the session
      const session = await queryOne<PortalSession>(
        'SELECT visitor_id FROM portal_sessions WHERE id = $1',
        [targetUserId]
      );
      
      if (!session) {
        return res.json({ threads: [] });
      }
      
      // Get portal threads for this visitor, scoped to this specific agent
      const portalThreads = await query<PortalThread & { message_count: number; last_message: string | null }>(
        `SELECT pt.*, 
                COUNT(pm.id) as message_count,
                (SELECT pm2.content FROM portal_messages pm2 WHERE pm2.thread_id = pt.id ORDER BY pm2.created_at DESC LIMIT 1) as last_message
         FROM portal_threads pt
         LEFT JOIN portal_messages pm ON pm.thread_id = pt.id
         JOIN portal_sessions ps ON ps.id = pt.portal_session_id
         WHERE ps.visitor_id = $1 AND ps.agent_id = $2
         GROUP BY pt.id
         ORDER BY pt.updated_at DESC`,
        [session.visitor_id, agentId]
      );
      
      threads = portalThreads.map(t => ({
        id: t.id,
        title: t.title,
        messageCount: parseInt(String(t.message_count || 0), 10),
        lastMessage: t.last_message,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      }));
    } else if (userType === 'embed') {
      // Get embed threads
      const embedThreads = await query<EmbedThread & { message_count: number; last_message: string | null }>(
        `SELECT et.*, 
                COUNT(etm.id) as message_count,
                (SELECT etm2.content FROM embed_thread_messages etm2 WHERE etm2.thread_id = et.id ORDER BY etm2.created_at DESC LIMIT 1) as last_message
         FROM embed_threads et
         LEFT JOIN embed_thread_messages etm ON etm.thread_id = et.id
         WHERE et.embed_user_id = $1
         GROUP BY et.id
         ORDER BY et.updated_at DESC`,
        [targetUserId]
      );
      
      threads = embedThreads.map(t => ({
        id: t.id,
        title: t.title,
        messageCount: t.message_count,
        lastMessage: t.last_message,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      }));
    }
    
    res.json({ threads });
  } catch (error) {
    console.error('Error fetching user threads:', error);
    res.status(500).json({ error: 'Failed to fetch threads' });
  }
});

// GET /api/agents/:agentId/users/:userId/threads/:threadId/messages - Get messages for a thread
router.get('/:agentId/users/:userId/threads/:threadId/messages', async (req, res) => {
  try {
    const { agentId, threadId } = req.params;
    const userType = req.query.type as string;
    const currentUserId = req.session.userId;
    
    // SECURITY: Verify agent ownership
    const agent = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE id = $1',
      [agentId]
    );
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    if (agent.user_id !== currentUserId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    let messages: Array<{
      id: string;
      role: string;
      content: string;
      createdAt: string;
    }> = [];
    
    if (userType === 'portal') {
      const portalMessages = await query<PortalMessage>(
        'SELECT * FROM portal_messages WHERE thread_id = $1 ORDER BY created_at ASC',
        [threadId]
      );
      
      messages = portalMessages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at,
      }));
    } else if (userType === 'embed') {
      const embedMessages = await query<EmbedMessage>(
        'SELECT * FROM embed_thread_messages WHERE thread_id = $1 ORDER BY created_at ASC',
        [threadId]
      );
      
      messages = embedMessages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at,
      }));
    }
    
    res.json({ messages });
  } catch (error) {
    console.error('Error fetching thread messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// GET /api/agents/:agentId/stats - Get usage stats for an agent
router.get('/:agentId/stats', async (req, res) => {
  try {
    const { agentId } = req.params;
    const currentUserId = req.session.userId;
    
    // SECURITY: Verify agent ownership
    const agent = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE id = $1',
      [agentId]
    );
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    if (agent.user_id !== currentUserId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get counts - count unique visitors, not sessions
    const portalCount = await queryOne<{ count: number }>(
      'SELECT COUNT(DISTINCT visitor_id) as count FROM portal_sessions WHERE agent_id = $1',
      [agentId]
    );
    
    const embedCount = await queryOne<{ count: number }>(
      'SELECT COUNT(DISTINCT user_identifier) as count FROM embed_users WHERE agent_id = $1',
      [agentId]
    );
    
    const portalThreadCount = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM portal_threads pt 
       JOIN portal_sessions ps ON ps.id = pt.portal_session_id 
       WHERE ps.agent_id = $1`,
      [agentId]
    );
    
    const embedThreadCount = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM embed_threads et 
       JOIN embed_users eu ON eu.id = et.embed_user_id 
       WHERE eu.agent_id = $1`,
      [agentId]
    );
    
    const portalMessageCount = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM portal_messages pm
       JOIN portal_threads pt ON pt.id = pm.thread_id
       JOIN portal_sessions ps ON ps.id = pt.portal_session_id
       WHERE ps.agent_id = $1`,
      [agentId]
    );
    
    const embedMessageCount = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM embed_thread_messages etm
       JOIN embed_threads et ON et.id = etm.thread_id
       JOIN embed_users eu ON eu.id = et.embed_user_id
       WHERE eu.agent_id = $1`,
      [agentId]
    );
    
    // Parse counts as integers to avoid string concatenation issues
    const portalUserCount = parseInt(String(portalCount?.count || 0), 10);
    const embedUserCount = parseInt(String(embedCount?.count || 0), 10);
    const portalThreads = parseInt(String(portalThreadCount?.count || 0), 10);
    const embedThreads = parseInt(String(embedThreadCount?.count || 0), 10);
    const portalMessages = parseInt(String(portalMessageCount?.count || 0), 10);
    const embedMessages = parseInt(String(embedMessageCount?.count || 0), 10);
    
    res.json({
      totalUsers: portalUserCount + embedUserCount,
      portalUsers: portalUserCount,
      embedUsers: embedUserCount,
      totalThreads: portalThreads + embedThreads,
      totalMessages: portalMessages + embedMessages,
    });
  } catch (error) {
    console.error('Error fetching agent stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
