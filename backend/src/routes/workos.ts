import { Router } from 'express';
import { WorkOS } from '@workos-inc/node';
import { v4 as uuidv4 } from 'uuid';
import * as jose from 'jose';
import { queryOne, execute } from '../db/index.js';
import type { User, Organization } from '../types/index.js';
import { generateUniqueSlug } from '../middleware/orgAuth.js';
import { withConstraintHandling } from '../utils/dbErrors.js';
import { createDefaultBucket } from '../utils/defaultBucket.js';
import { parseBoolEnv } from '../utils/env.js';

/**
 * Create a personal organization for a user
 */
async function createPersonalOrg(userId: string, email: string): Promise<Organization> {
  const orgId = uuidv4();
  const memberId = uuidv4();
  const now = new Date().toISOString();
  const name = 'Personal Workspace';
  const slug = await generateUniqueSlug(email.split('@')[0]);
  
  // Wrap in constraint handling to catch race conditions
  await withConstraintHandling(async () => {
    await execute(
      `INSERT INTO organizations (id, name, slug, is_personal, owner_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [orgId, name, slug, true, userId, now, now]
    );
    
    await execute(
      `INSERT INTO organization_members (id, organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [memberId, orgId, userId, 'owner', now]
    );
  }, 'organization');
  
  // Create the default "Files" bucket for this organization
  await createDefaultBucket(userId, orgId);
  
  return {
    id: orgId,
    name,
    slug,
    is_personal: true,
    owner_id: userId,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Get or create personal organization for a user
 */
async function getOrCreatePersonalOrg(userId: string, email: string): Promise<Organization> {
  // Check if personal org exists
  const existingOrg = await queryOne<Organization>(
    'SELECT * FROM organizations WHERE owner_id = $1 AND is_personal = $2',
    [userId, true]
  );
  
  if (existingOrg) {
    return existingOrg;
  }
  
  return createPersonalOrg(userId, email);
}

const router = Router();

// Lazy-initialize WorkOS client.
// Importing this module previously crashed when WORKOS_API_KEY was unset because
// the WorkOS SDK throws inside its constructor. We now defer construction until
// a WorkOS-backed route is actually hit, and treat missing creds as "WorkOS disabled".
//
// Resolution rules:
//   WORKOS_ENABLED=false              → disabled
//   WORKOS_ENABLED=true + key present → enabled
//   WORKOS_ENABLED=true + key missing → disabled, with a warning log
//   WORKOS_ENABLED unset              → enabled iff WORKOS_API_KEY present
const WORKOS_API_KEY_PRESENT = !!process.env.WORKOS_API_KEY;
const WORKOS_ENABLED = parseBoolEnv('WORKOS_ENABLED', WORKOS_API_KEY_PRESENT) && WORKOS_API_KEY_PRESENT;
if (parseBoolEnv('WORKOS_ENABLED', false) && !WORKOS_API_KEY_PRESENT) {
  console.warn('[workos] WORKOS_ENABLED=true but WORKOS_API_KEY is unset — WorkOS routes will return 503.');
}

let _workos: WorkOS | null = null;
function getWorkOS(): WorkOS {
  if (!WORKOS_ENABLED) {
    throw new Error(
      'WorkOS is disabled (WORKOS_ENABLED=false or WORKOS_API_KEY unset). ' +
      'Set WORKOS_ENABLED=true and provide WORKOS_API_KEY + WORKOS_CLIENT_ID to enable.'
    );
  }
  if (!_workos) {
    _workos = new WorkOS(process.env.WORKOS_API_KEY);
  }
  return _workos;
}
// Backwards-compat handle so any in-file references (`workos.xyz(...)`) still work
// without rewriting every call site. They lazily resolve via the Proxy.
const workos = new Proxy({} as WorkOS, {
  get(_target, prop) {
    const inst = getWorkOS();
    // @ts-expect-error — dynamic forwarding
    const value = inst[prop];
    return typeof value === 'function' ? value.bind(inst) : value;
  },
});
const clientId = process.env.WORKOS_CLIENT_ID || '';

// Short-circuit all WorkOS routes with a clear error when disabled
router.use((_req, res, next) => {
  if (!WORKOS_ENABLED) {
    return res.status(503).json({
      error: 'workos_disabled',
      message:
        'WorkOS SSO is not configured on this server. Set WORKOS_API_KEY and WORKOS_CLIENT_ID to enable.',
    });
  }
  next();
});

// Allowed domains for authentication (supports multiple domains pointing to same app)
const ALLOWED_DOMAINS = ['oshu.dev', 'primeintuition.ai', 'localhost'];

// Get the appropriate redirect URI based on the request origin
function getRedirectUri(req: import('express').Request): string {
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
  
  // Check if this is an allowed domain
  const domain = host.split(':')[0];
  if (ALLOWED_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) {
    return `${protocol}://${host}/api/auth/workos/callback`;
  }
  
  // Fallback to env var or localhost
  return process.env.WORKOS_REDIRECT_URI || 'http://localhost:3000/api/auth/workos/callback';
}

// Get the frontend URL based on the request origin
function getFrontendUrl(req: import('express').Request): string {
  const host = req.get('host') || 'localhost:5173';
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';

  const domain = host.split(':')[0];

  // For localhost, always use the frontend port from env or default
  if (domain === 'localhost') {
    return process.env.FRONTEND_URL || 'http://localhost:5173';
  }

  if (ALLOWED_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) {
    return `${protocol}://${host}`;
  }

  return process.env.FRONTEND_URL || 'http://localhost:5173';
}

// Initiate login - redirect to WorkOS
router.get('/login', (req, res) => {
  // Check if user is coming from logout (force fresh login)
  const forceLogin = req.query.prompt === 'login';
  
  // Get dynamic redirect URI based on request origin
  const redirectUri = getRedirectUri(req);
  console.log(`[WorkOS] Login initiated from ${req.get('host')}, redirectUri: ${redirectUri}`);

  const authOptions: Parameters<typeof workos.userManagement.getAuthorizationUrl>[0] = {
    provider: 'authkit',
    clientId,
    redirectUri,
    state: req.session.id || uuidv4(), // CSRF protection
  };

  let authorizationUrl = workos.userManagement.getAuthorizationUrl(authOptions);

  // Force re-authentication by adding prompt=login (OIDC standard)
  if (forceLogin) {
    const url = new URL(authorizationUrl);
    url.searchParams.set('prompt', 'login');
    authorizationUrl = url.toString();
    console.log('Forcing fresh login with prompt=login');
  }

  res.redirect(authorizationUrl);
});

// Handle callback from WorkOS
router.get('/callback', async (req, res) => {
  const frontendUrl = getFrontendUrl(req);
  
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== 'string') {
      return res.redirect(`${frontendUrl}/login?error=no_code`);
    }

    // Exchange code for user info
    const { user: workosUser, accessToken, refreshToken } = await workos.userManagement.authenticateWithCode({
      clientId,
      code,
      session: {
        sealSession: false,
      },
    });

    // Find or create user in our database
    let user = await queryOne<User>('SELECT * FROM users WHERE email = $1', [workosUser.email]);

    let isNewUser = false;
    if (!user) {
      // Create new user
      const id = uuidv4();
      await execute(
        'INSERT INTO users (id, email, password_hash, workos_user_id) VALUES ($1, $2, $3, $4)',
        [id, workosUser.email, '', workosUser.id]
      );
      user = await queryOne<User>('SELECT * FROM users WHERE id = $1', [id]);
      isNewUser = true;
    } else if (!user.workos_user_id) {
      // Link existing user to WorkOS
      await execute('UPDATE users SET workos_user_id = $1 WHERE id = $2', [workosUser.id, user.id]);
    }

    if (!user) {
      throw new Error('Failed to create or find user');
    }

    // Get or create personal organization
    const personalOrg = await getOrCreatePersonalOrg(user.id, user.email);

    // Set session
    req.session.userId = user.id;
    req.session.currentOrgId = personalOrg.id;

    // Store WorkOS session ID for logout
    const decoded = jose.decodeJwt(accessToken);
    console.log('WorkOS access token claims:', Object.keys(decoded));
    console.log('WorkOS session ID (sid):', decoded.sid);
    if (decoded.sid) {
      req.session.workosSessionId = decoded.sid as string;
    } else {
      console.warn('No sid claim found in WorkOS access token');
    }

    // Redirect to app (same domain as request)
    console.log(`[WorkOS] Callback successful, redirecting to ${frontendUrl}`);
    res.redirect(frontendUrl);
  } catch (error) {
    console.error('WorkOS callback error:', error);
    res.redirect(`${frontendUrl}/login?error=auth_failed`);
  }
});

// Logout
router.get('/logout', async (req, res) => {
  const workosSessionId = req.session.workosSessionId;
  const frontendUrl = getFrontendUrl(req);

  console.log('Logout requested, workosSessionId:', workosSessionId);

  // Clear the session cookie
  res.clearCookie('connect.sid');

  // Revoke WorkOS session via API (actually invalidates it)
  if (workosSessionId) {
    try {
      await workos.userManagement.revokeSession({ sessionId: workosSessionId });
      console.log('WorkOS session revoked successfully');
    } catch (e) {
      console.error('Failed to revoke WorkOS session:', e);
    }
  } else {
    console.log('No workosSessionId found - user may need to re-login first');
  }

  // Destroy local session and redirect to homepage
  req.session.destroy((err) => {
    if (err) {
      console.error('Failed to destroy session:', err);
    }
    res.redirect(frontendUrl);
  });
});

export default router;
