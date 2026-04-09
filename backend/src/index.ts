import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { createServer } from 'http';
import path from 'path';
import { initializeDatabase, execute, queryOne } from './db/index.js';
import { initWebSocket } from './services/websocket.js';
import { startQueueWorker } from './workers/taskQueue.js';
import { startScheduleWorker } from './workers/scheduleWorker.js';
import authRoutes from './routes/auth.js';
import workosRoutes from './routes/workos.js';
import githubRoutes from './routes/github.js';
import githubAppRoutes from './routes/githubApp.js';
import gitlabRoutes from './routes/gitlab.js';
import sessionRoutes from './routes/sessions.js';
import agentRoutes from './routes/agent.js';
import apiKeysRoutes from './routes/apiKeys.js';
import agentConfigRoutes from './routes/agentConfig.js';
import workflowsRoutes from './routes/workflows.js';
import reposRoutes from './routes/repos.js';
import v1AgentsRoutes from './routes/v1/agents.js';
import v1WorkflowsRoutes from './routes/v1/workflows.js';
import builderRoutes from './routes/builder.js';
import workflowOrchestrationRoutes from './routes/workflowOrchestration.js';
import eventsRoutes from './routes/events.js';
import schedulesRoutes from './routes/schedules.js';
import integrationsRoutes from './routes/integrations.js';
import filesRoutes from './routes/files.js';
import portalRoutes from './routes/portal.js';
import embedRoutes from './routes/embed.js';
import knowledgeRoutes from './routes/knowledge.js';
import agentUsersRoutes from './routes/agentUsers.js';
import skillsRoutes from './routes/skills.js';
import mcpGatewayRoutes from './routes/mcpGateway.js';
import knowledgeGatewayRoutes from './routes/knowledgeGateway.js';
import analyticsRoutes from './routes/analytics.js';
import organizationsRoutes from './routes/organizations.js';
import portalCustomizerRoutes from './routes/portalCustomizer.js';
import { recoverStuckWorkflows } from './routes/workflowOrchestration.js';
import { setOrgContext } from './middleware/orgAuth.js';

const app = express();
const server = createServer(app);
// Note: env vars are strings; Node treats `server.listen("3000")` as a unix socket path.
// Coerce to number so we actually bind TCP :3000 on Fly/Docker.
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000;
const HOST = process.env.HOST ?? '0.0.0.0';

// Trust proxy for secure cookies behind Fly.io/load balancers
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Postgres-backed session store
class DatabaseSessionStore extends session.Store {
  async get(sid: string, cb: (err: any, session?: session.SessionData | null) => void) {
    try {
      const row = await queryOne<{ sess: string }>(
        'SELECT sess FROM http_sessions WHERE sid = $1 AND expire > $2',
        [sid, new Date().toISOString()]
      );
      if (row) {
        cb(null, JSON.parse(row.sess));
      } else {
        cb(null, null);
      }
    } catch (err) {
      cb(err);
    }
  }

  async set(sid: string, sess: session.SessionData, cb?: (err?: any) => void) {
    try {
      const maxAge = sess.cookie?.maxAge || 86400000; // 1 day default
      const expire = new Date(Date.now() + maxAge).toISOString();
      
      // Upsert
      await execute(
        `INSERT INTO http_sessions (sid, sess, expire) VALUES ($1, $2, $3)
         ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
        [sid, JSON.stringify(sess), expire]
      );
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }

  async destroy(sid: string, cb?: (err?: any) => void) {
    try {
      await execute('DELETE FROM http_sessions WHERE sid = $1', [sid]);
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }

  async touch(sid: string, sess: session.SessionData, cb?: (err?: any) => void) {
    try {
      const maxAge = sess.cookie?.maxAge || 86400000;
      const expire = new Date(Date.now() + maxAge).toISOString();
      await execute('UPDATE http_sessions SET expire = $1 WHERE sid = $2', [expire, sid]);
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }
}

async function startServer() {
  // Initialize database (Postgres-only)
  await initializeDatabase();

  // Create http_sessions table
  await execute(`
    CREATE TABLE IF NOT EXISTS http_sessions (
      sid TEXT PRIMARY KEY NOT NULL,
      sess TEXT NOT NULL,
      expire TIMESTAMP NOT NULL
    )
  `);

  // Reset any 'active' agent sessions on startup - sandboxes don't persist across restarts
  try {
    const result = await execute(
      "UPDATE sessions SET status = 'completed', sandbox_id = NULL WHERE status = 'active'"
    );
    if (result.rowCount > 0) {
      console.log(`[Startup] Marked ${result.rowCount} stale active session(s) as completed`);
    }
  } catch (err) {
    console.error('[Startup] Failed to reset stale sessions:', err);
  }

  // Mark expired sandboxes as terminated (E2B doesn't notify us when they expire)
  try {
    const expiredResult = await execute(
      `UPDATE sandboxes SET status = 'terminated' 
       WHERE status = 'running' 
       AND expires_at IS NOT NULL 
       AND expires_at < NOW()`
    );
    if (expiredResult.rowCount > 0) {
      console.log(`[Startup] Marked ${expiredResult.rowCount} expired sandbox(es) as terminated`);
    }
  } catch (err) {
    console.error('[Startup] Failed to clean up expired sandboxes:', err);
  }

  const sessionStore = new DatabaseSessionStore();

  // Middleware
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc)
      if (!origin) return callback(null, true);
      // Allow localhost on any port for development
      if (origin.startsWith('http://localhost:')) return callback(null, true);
      // Allow Fly.io domains
      if (origin.endsWith('.fly.dev')) return callback(null, true);
      // Allow both oshu.dev and primeintuition.ai (same app, multiple domains)
      if (origin === 'https://oshu.dev' || origin === 'https://primeintuition.ai') return callback(null, true);
      // Allow configured frontend URL as fallback
      const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';
      if (origin === allowedOrigin) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }));

  app.use(express.json({ limit: '5mb' })); // Increased for portal customizer with base64 images
  app.use(express.urlencoded({ extended: true, limit: '5mb' })); // For Slack slash commands

  app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  }));

  // Organization context middleware - sets req.organizationId for authenticated requests
  app.use(setOrgContext());

  // Routes
  app.use('/api/organizations', organizationsRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/auth/workos', workosRoutes);
  app.use('/api/auth/github', githubRoutes);
  app.use('/api/github-app', githubAppRoutes);
  app.use('/api/auth/gitlab', gitlabRoutes);
  app.use('/api/sessions', sessionRoutes);
  app.use('/api/agent', agentRoutes);
  app.use('/api/keys', apiKeysRoutes);
  app.use('/api/agents', agentConfigRoutes);
  app.use('/api/agents', workflowsRoutes);
  app.use('/api/repos', reposRoutes);
  app.use('/api/builder', builderRoutes);
  app.use('/api/workflows', workflowOrchestrationRoutes);
  app.use('/api/events', eventsRoutes);
  app.use('/api/schedules', schedulesRoutes);
  app.use('/api/integrations', integrationsRoutes);
  app.use('/api/files', filesRoutes);
  app.use('/api/knowledge', knowledgeRoutes);
  app.use('/api/agents', agentUsersRoutes);
  app.use('/api/skills', skillsRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/portal-customizer', portalCustomizerRoutes);
  
  // MCP Gateway - allows Claude in sandboxes to call MCP servers via REST
  // No auth required as it's called from sandboxes
  app.use('/api/mcp-gateway', mcpGatewayRoutes);
  
  // Knowledge Base Gateway - allows Claude in sandboxes to query knowledge bases
  // No auth required as it's called from sandboxes
  app.use('/api/kb-gateway', knowledgeGatewayRoutes);

  // Public portal API (for agent portal/embed - allows any origin)
  app.use('/api/portal', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  }, portalRoutes);

  app.use('/api/embed', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  }, embedRoutes);

  // Public API v1 (uses API key auth)
  app.use('/api/v1/agents', v1AgentsRoutes);
  app.use('/api/v1/workflows', v1WorkflowsRoutes);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      database: 'postgresql'
    });
  });

  // Serve frontend static files in production
  if (process.env.NODE_ENV === 'production') {
    // In Docker, frontend is at /app/frontend/dist, backend runs from /app/backend
    const frontendPath = path.join(process.cwd(), '../frontend/dist');
    app.use(express.static(frontendPath));
    
    // Handle client-side routing - serve index.html for non-API routes
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) {
        return next();
      }
      res.sendFile(path.join(frontendPath, 'index.html'));
    });
  }

  // Error handler
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  // Initialize WebSocket
  initWebSocket(server);

  // Start task queue worker
  startQueueWorker(5000); // Poll every 5 seconds
  
  // Start schedule worker
  startScheduleWorker(60000); // Check schedules every 60 seconds
  
  // Recover any stuck workflow runs after a short delay (let other services initialize first)
  setTimeout(() => {
    recoverStuckWorkflows().catch(err => {
      console.error('[Startup] Failed to recover stuck workflows:', err);
    });
  }, 5000);

  server.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
    console.log(`WebSocket available at ws://${HOST}:${PORT}/ws`);
    console.log(`SDK WebSocket available at ws://${HOST}:${PORT}/ws/v1/tasks`);
    console.log(`API v1 available at http://${HOST}:${PORT}/api/v1`);
  });
}

// Start the server
startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
