/**
 * GitHub App Routes
 * 
 * Handles GitHub App installation management for granular repository access.
 * Unlike OAuth, GitHub Apps allow users to explicitly select which repos
 * the app can access via GitHub's UI.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Octokit } from '@octokit/rest';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { query, queryOne, execute } from '../db/index.js';
import type { GitHubAppInstallation, User } from '../types/index.js';

const router = Router();

// GitHub App configuration from environment
const GITHUB_APP_ID = process.env.GITHUB_APP_ID;
const GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY 
  ? Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY, 'base64').toString('utf-8')
  : undefined;
const GITHUB_APP_WEBHOOK_SECRET = process.env.GITHUB_APP_WEBHOOK_SECRET;
const GITHUB_APP_CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID;
const GITHUB_APP_NAME = process.env.GITHUB_APP_NAME || 'oshu-dev';

// Allowed domains for callbacks
const ALLOWED_DOMAINS = ['oshu.dev', 'primeintuition.ai', 'localhost'];

/**
 * Check if GitHub App is configured
 * Exported so other parts of the app can check
 */
export function isGitHubAppConfigured(): boolean {
  return !!(GITHUB_APP_ID && GITHUB_APP_PRIVATE_KEY && GITHUB_APP_CLIENT_ID);
}

/**
 * Get a GitHub token for a user based on their GitHub App installations
 * Used by code agents and other parts of the app that need GitHub access
 * 
 * @param userId - The user ID to get a token for
 * @param repoUrl - Optional repo URL to find the right installation for
 * @returns The installation token, or null if no installation found
 */
export async function getGitHubTokenForUser(
  userId: string,
  repoUrl?: string
): Promise<{ token: string; installationId: number } | null> {
  if (!isGitHubAppConfigured()) {
    console.log('[GitHubApp] GitHub App not configured');
    return null;
  }

  // Find user's installations
  const installations = await query<GitHubAppInstallation>(
    'SELECT * FROM github_app_installations WHERE user_id = $1',
    [userId]
  );

  if (installations.length === 0) {
    console.log(`[GitHubApp] No installations found for user ${userId}`);
    return null;
  }

  // If repoUrl is provided, try to find the right installation
  let installation = installations[0];
  
  if (repoUrl) {
    // Extract owner from repo URL
    const match = repoUrl.match(/github\.com[\/:]([^\/]+)/);
    if (match) {
      const owner = match[1].toLowerCase();
      // Try to find an installation for this owner
      const ownerInstallation = installations.find(
        i => i.account_login.toLowerCase() === owner
      );
      if (ownerInstallation) {
        installation = ownerInstallation;
      }
    }
  }

  try {
    const token = await getInstallationToken(installation.installation_id);
    return { token, installationId: installation.installation_id };
  } catch (err) {
    console.error(`[GitHubApp] Failed to get token for installation ${installation.installation_id}:`, err);
    return null;
  }
}

/**
 * Generate a JWT for GitHub App authentication
 */
function generateAppJWT(): string {
  if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY) {
    throw new Error('GitHub App not configured');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // issued 60 seconds ago to account for clock drift
    exp: now + 600, // expires in 10 minutes
    iss: GITHUB_APP_ID,
  };

  // Create JWT manually (avoiding additional dependency)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${body}`)
    .sign(GITHUB_APP_PRIVATE_KEY, 'base64url');

  return `${header}.${body}.${signature}`;
}

/**
 * Get an installation access token for a specific installation
 * Exported so other parts of the app can use it (e.g., code agents)
 */
export async function getInstallationToken(installationId: number): Promise<string> {
  const jwt = generateAppJWT();
  
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Oshu-Agent-Platform',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('[GitHubApp] Failed to get installation token:', response.status, error);
    throw new Error(`Failed to get installation token: ${response.status}`);
  }

  const data = await response.json() as { token: string };
  return data.token;
}

/**
 * Verify GitHub webhook signature
 */
function verifyWebhookSignature(payload: string, signature: string | undefined): boolean {
  if (!GITHUB_APP_WEBHOOK_SECRET || !signature) {
    return false;
  }

  const expected = 'sha256=' + crypto
    .createHmac('sha256', GITHUB_APP_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ============================================
// PUBLIC ENDPOINTS
// ============================================

/**
 * Check if GitHub App is configured
 */
router.get('/status', (req, res) => {
  res.json({
    configured: isGitHubAppConfigured(),
    appName: GITHUB_APP_NAME,
  });
});

/**
 * Get URL to install/configure the GitHub App
 */
router.get('/install-url', requireAuth, (req, res) => {
  if (!isGitHubAppConfigured()) {
    return res.status(400).json({ error: 'GitHub App not configured' });
  }

  const state = uuidv4();
  req.session.githubAppState = state;

  // URL to install the GitHub App
  // After installation, GitHub redirects to the callback URL we set up
  const installUrl = `https://github.com/apps/${GITHUB_APP_NAME}/installations/new?state=${state}`;
  
  res.json({ url: installUrl, state });
});

/**
 * Get URL to configure an existing installation (add/remove repos)
 */
router.get('/configure-url/:installationId', requireAuth, async (req, res) => {
  const { installationId } = req.params;
  
  // Verify user owns this installation
  const installation = await queryOne<GitHubAppInstallation>(
    'SELECT * FROM github_app_installations WHERE installation_id = $1 AND user_id = $2',
    [installationId, req.session.userId]
  );

  if (!installation) {
    return res.status(404).json({ error: 'Installation not found' });
  }

  const configureUrl = `https://github.com/settings/installations/${installationId}`;
  res.json({ url: configureUrl });
});

// ============================================
// WEBHOOK HANDLER (called by GitHub)
// ============================================

/**
 * Handle GitHub App webhooks
 * This is called by GitHub when:
 * - App is installed on a user/org
 * - App is uninstalled
 * - Repos are added/removed from installation
 */
router.post('/webhook', async (req: Request, res: Response) => {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const event = req.headers['x-github-event'] as string;
  const payload = JSON.stringify(req.body);

  // Verify webhook signature
  if (GITHUB_APP_WEBHOOK_SECRET && !verifyWebhookSignature(payload, signature)) {
    console.warn('[GitHubApp] Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  console.log(`[GitHubApp] Received webhook: ${event}`);

  try {
    if (event === 'installation') {
      await handleInstallationEvent(req.body);
    } else if (event === 'installation_repositories') {
      await handleInstallationRepositoriesEvent(req.body);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('[GitHubApp] Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Handle installation created/deleted events
 */
async function handleInstallationEvent(payload: any) {
  const { action, installation, sender } = payload;
  
  console.log(`[GitHubApp] Installation ${action}: ${installation.id} by ${sender.login}`);

  if (action === 'created') {
    // Try to find user by GitHub ID (if they've connected GitHub OAuth)
    const user = await queryOne<User>(
      'SELECT id FROM users WHERE github_id = $1',
      [sender.id.toString()]
    );

    if (user) {
      // Store the installation
      const id = uuidv4();
      await execute(
        `INSERT INTO github_app_installations 
         (id, user_id, installation_id, account_login, account_type, account_id, permissions, repository_selection, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (installation_id) DO UPDATE SET
           account_login = $4,
           permissions = $7,
           repository_selection = $8,
           suspended_at = NULL,
           updated_at = NOW()`,
        [
          id,
          user.id,
          installation.id,
          installation.account.login,
          installation.account.type,
          installation.account.id,
          JSON.stringify(installation.permissions),
          installation.repository_selection,
        ]
      );
      console.log(`[GitHubApp] Stored installation ${installation.id} for user ${user.id}`);
    } else {
      console.log(`[GitHubApp] No user found with GitHub ID ${sender.id}, installation will be linked on first login`);
    }
  } else if (action === 'deleted') {
    // Remove the installation
    await execute(
      'DELETE FROM github_app_installations WHERE installation_id = $1',
      [installation.id]
    );
    console.log(`[GitHubApp] Deleted installation ${installation.id}`);
  } else if (action === 'suspend') {
    await execute(
      'UPDATE github_app_installations SET suspended_at = NOW(), updated_at = NOW() WHERE installation_id = $1',
      [installation.id]
    );
  } else if (action === 'unsuspend') {
    await execute(
      'UPDATE github_app_installations SET suspended_at = NULL, updated_at = NOW() WHERE installation_id = $1',
      [installation.id]
    );
  }
}

/**
 * Handle repos added/removed from installation
 */
async function handleInstallationRepositoriesEvent(payload: any) {
  const { action, installation, repositories_added, repositories_removed } = payload;
  
  console.log(`[GitHubApp] Installation ${installation.id} repos ${action}:`, 
    action === 'added' ? repositories_added?.map((r: any) => r.full_name) : repositories_removed?.map((r: any) => r.full_name)
  );

  // Update the installation's updated_at timestamp
  await execute(
    'UPDATE github_app_installations SET updated_at = NOW() WHERE installation_id = $1',
    [installation.id]
  );
}

// ============================================
// INSTALLATION CALLBACK (after user installs app)
// ============================================

/**
 * Callback after user installs/configures the GitHub App
 * GitHub redirects here with installation_id
 */
router.get('/callback', requireAuth, async (req: Request, res: Response) => {
  const { installation_id, setup_action, state } = req.query;
  const userId = req.session.userId!;

  // Get frontend URL for redirect
  const host = req.get('host') || 'localhost:5173';
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
  const domain = host.split(':')[0];

  // For localhost, always use the frontend port from env or default
  let frontendUrl: string;
  if (domain === 'localhost') {
    frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  } else if (ALLOWED_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) {
    frontendUrl = `${protocol}://${host}`;
  } else {
    frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  }

  // Verify state if provided (optional but recommended)
  if (state && state !== req.session.githubAppState) {
    console.warn('[GitHubApp] State mismatch in callback');
  }
  delete req.session.githubAppState;

  if (!installation_id) {
    return res.redirect(`${frontendUrl}/settings?tab=git&error=no_installation`);
  }

  try {
    // Fetch installation details from GitHub
    const jwt = generateAppJWT();
    const response = await fetch(
      `https://api.github.com/app/installations/${installation_id}`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Oshu-Agent-Platform',
        },
      }
    );

    if (!response.ok) {
      console.error('[GitHubApp] Failed to fetch installation:', response.status);
      return res.redirect(`${frontendUrl}/settings?tab=git&error=installation_fetch_failed`);
    }

    const installation = await response.json() as {
      id: number;
      account: { login: string; type: string; id: number };
      permissions: Record<string, string>;
      repository_selection: string;
    };

    // Store or update the installation for this user
    const id = uuidv4();
    await execute(
      `INSERT INTO github_app_installations 
       (id, user_id, installation_id, account_login, account_type, account_id, permissions, repository_selection, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       ON CONFLICT (installation_id) DO UPDATE SET
         user_id = $2,
         account_login = $4,
         permissions = $7,
         repository_selection = $8,
         suspended_at = NULL,
         updated_at = NOW()`,
      [
        id,
        userId,
        installation.id,
        installation.account.login,
        installation.account.type,
        installation.account.id,
        JSON.stringify(installation.permissions),
        installation.repository_selection,
      ]
    );

    console.log(`[GitHubApp] Linked installation ${installation.id} (${installation.account.login}) to user ${userId}`);

    res.redirect(`${frontendUrl}/settings?tab=git&github_app=installed&account=${installation.account.login}`);
  } catch (error) {
    console.error('[GitHubApp] Callback error:', error);
    res.redirect(`${frontendUrl}/settings?tab=git&error=callback_failed`);
  }
});

// ============================================
// AUTHENTICATED ENDPOINTS
// ============================================

/**
 * List user's GitHub App installations
 */
router.get('/installations', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;

  const installations = await query<GitHubAppInstallation>(
    `SELECT * FROM github_app_installations 
     WHERE user_id = $1 AND suspended_at IS NULL 
     ORDER BY account_login ASC`,
    [userId]
  );

  res.json({ installations });
});

/**
 * List repositories for a specific installation
 */
router.get('/installations/:installationId/repos', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { installationId } = req.params;

  // Verify user owns this installation
  const installation = await queryOne<GitHubAppInstallation>(
    'SELECT * FROM github_app_installations WHERE installation_id = $1 AND user_id = $2',
    [installationId, userId]
  );

  if (!installation) {
    return res.status(404).json({ error: 'Installation not found' });
  }

  if (installation.suspended_at) {
    return res.status(400).json({ error: 'Installation is suspended' });
  }

  try {
    // Get installation token
    const token = await getInstallationToken(parseInt(installationId));
    
    // Fetch repos accessible to this installation
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
      per_page: 100,
    });

    res.json({
      repos: data.repositories.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        url: repo.html_url,
        clone_url: repo.clone_url,
        default_branch: repo.default_branch,
        private: repo.private,
        installation_id: parseInt(installationId),
      })),
      total_count: data.total_count,
    });
  } catch (error: any) {
    console.error('[GitHubApp] Failed to fetch repos:', error);
    res.status(500).json({ error: 'Failed to fetch repositories' });
  }
});

/**
 * Get branches for a repository (using installation token)
 */
router.get('/installations/:installationId/repos/:owner/:repo/branches', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { installationId, owner, repo } = req.params;

  // Verify user owns this installation
  const installation = await queryOne<GitHubAppInstallation>(
    'SELECT * FROM github_app_installations WHERE installation_id = $1 AND user_id = $2',
    [installationId, userId]
  );

  if (!installation) {
    return res.status(404).json({ error: 'Installation not found' });
  }

  try {
    const token = await getInstallationToken(parseInt(installationId));
    const octokit = new Octokit({ auth: token });
    
    const { data: branches } = await octokit.rest.repos.listBranches({
      owner,
      repo,
      per_page: 100,
    });

    res.json({
      branches: branches.map((branch) => ({
        name: branch.name,
        protected: branch.protected,
      })),
    });
  } catch (error: any) {
    console.error('[GitHubApp] Failed to fetch branches:', error);
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
});

/**
 * Create a new branch in a repository (using installation token)
 */
router.post('/installations/:installationId/repos/:owner/:repo/branches', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { installationId, owner, repo } = req.params;
  const { branch_name, base_branch } = req.body;

  if (!branch_name || !base_branch) {
    return res.status(400).json({ error: 'branch_name and base_branch are required' });
  }

  // Verify user owns this installation
  const installation = await queryOne<GitHubAppInstallation>(
    'SELECT * FROM github_app_installations WHERE installation_id = $1 AND user_id = $2',
    [installationId, userId]
  );

  if (!installation) {
    return res.status(403).json({ error: 'Installation not found or not authorized' });
  }

  try {
    const token = await getInstallationToken(parseInt(installationId));
    const octokit = new Octokit({ auth: token });

    // Get the SHA of the base branch
    const { data: refData } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${base_branch}`,
    });

    // Create the new branch
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch_name}`,
      sha: refData.object.sha,
    });

    res.json({
      success: true,
      branch: {
        name: branch_name,
        base: base_branch,
      },
    });
  } catch (error: any) {
    console.error('[GitHubApp] Failed to create branch:', error);
    if (error.status === 422 && error.message?.includes('Reference already exists')) {
      res.status(409).json({ error: 'Branch already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create branch' });
    }
  }
});

/**
 * Sync user's installations from GitHub
 * Works by fetching all app installations and matching by:
 * 1. GitHub ID (from OAuth, if available)
 * 2. GitHub username (from OAuth, if available)
 * 3. Any installations not yet linked to another user (for new users)
 */
router.post('/sync-installations', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;

  const user = await queryOne<User>(
    'SELECT github_id, github_username FROM users WHERE id = $1',
    [userId]
  );

  if (!isGitHubAppConfigured()) {
    return res.status(400).json({ error: 'GitHub App not configured' });
  }

  try {
    const jwt = generateAppJWT();

    // Fetch all installations for the app
    const response = await fetch('https://api.github.com/app/installations', {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Oshu-Agent-Platform',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch installations: ${response.status}`);
    }

    const installations = await response.json() as Array<{
      id: number;
      account: { login: string; type: string; id: number };
      permissions: Record<string, string>;
      repository_selection: string;
      suspended_at?: string;
    }>;

    // Get installations already linked to this user (for re-sync)
    const existingUserInstallations = await query<GitHubAppInstallation>(
      'SELECT installation_id FROM github_app_installations WHERE user_id = $1',
      [userId]
    );
    const existingIds = new Set(existingUserInstallations.map(e => e.installation_id));

    // Match installations to this user by identity only (safe, no race conditions):
    // 1. By GitHub ID (most reliable, from OAuth)
    // 2. By GitHub username (from OAuth)
    // 3. Already linked to this user (re-sync/refresh)
    const userInstallations = installations.filter(inst => {
      // Already linked to this user — include for re-sync
      if (existingIds.has(inst.id)) return true;

      // Match by GitHub ID
      if (user?.github_id && inst.account.id.toString() === user.github_id) return true;

      // Match by GitHub username
      if (user?.github_username && inst.account.login.toLowerCase() === user.github_username.toLowerCase()) return true;

      return false;
    });

    // Upsert each installation
    for (const installation of userInstallations) {
      const id = uuidv4();
      await execute(
        `INSERT INTO github_app_installations
         (id, user_id, installation_id, account_login, account_type, account_id, permissions, repository_selection, suspended_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (installation_id) DO UPDATE SET
           user_id = $2,
           account_login = $4,
           permissions = $7,
           repository_selection = $8,
           suspended_at = $9,
           updated_at = NOW()`,
        [
          id,
          userId,
          installation.id,
          installation.account.login,
          installation.account.type,
          installation.account.id,
          JSON.stringify(installation.permissions),
          installation.repository_selection,
          installation.suspended_at || null,
        ]
      );
    }

    console.log(`[GitHubApp] Synced ${userInstallations.length} installations for user ${userId}`);

    res.json({
      synced: userInstallations.length,
      installations: userInstallations.map(i => ({
        id: i.id,
        account: i.account.login,
      })),
    });
  } catch (error: any) {
    console.error('[GitHubApp] Sync error:', error);
    res.status(500).json({ error: 'Failed to sync installations' });
  }
});

/**
 * Remove a GitHub App installation from the database
 * Note: This only removes it from our database. To fully uninstall the app,
 * the user should visit GitHub settings.
 */
router.delete('/installations/:installationId', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { installationId } = req.params;

  try {
    // Verify user owns this installation
    const installation = await queryOne<GitHubAppInstallation>(
      'SELECT * FROM github_app_installations WHERE installation_id = $1 AND user_id = $2',
      [installationId, userId]
    );

    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    // Delete the installation
    await execute(
      'DELETE FROM github_app_installations WHERE installation_id = $1 AND user_id = $2',
      [installationId, userId]
    );

    console.log(`[GitHubApp] User ${userId} removed installation ${installationId} (${installation.account_login})`);

    res.json({ success: true });
  } catch (error: any) {
    console.error('[GitHubApp] Delete installation error:', error);
    res.status(500).json({ error: 'Failed to remove installation' });
  }
});

export default router;
