import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';
import { queryOne, execute } from '../db/index.js';
import type { User } from '../types/index.js';

const router = Router();

const GITLAB_CLIENT_ID = process.env.GITLAB_CLIENT_ID;
const GITLAB_CLIENT_SECRET = process.env.GITLAB_CLIENT_SECRET;

// Allowed domains for authentication (supports multiple domains pointing to same app)
const ALLOWED_DOMAINS = ['oshu.dev', 'primeintuition.ai', 'localhost'];

// Get the appropriate callback URL based on the request origin
function getGitlabCallbackUrl(req: import('express').Request): string {
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
  
  const domain = host.split(':')[0];
  if (ALLOWED_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) {
    return `${protocol}://${host}/api/auth/gitlab/callback`;
  }
  
  return process.env.GITLAB_CALLBACK_URL || 'http://localhost:3000/api/auth/gitlab/callback';
}

// Get the frontend URL based on the request origin
function getFrontendUrl(req: import('express').Request): string {
  const host = req.get('host') || 'localhost:5173';
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
  
  const domain = host.split(':')[0];
  if (ALLOWED_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) {
    return `${protocol}://${host}`;
  }
  
  return process.env.FRONTEND_URL || 'http://localhost:5173';
}

// Check if GitLab OAuth is configured
router.get('/status', requireAuth, (req, res) => {
  res.json({
    configured: !!(GITLAB_CLIENT_ID && GITLAB_CLIENT_SECRET),
  });
});

// Initiate GitLab OAuth
router.get('/connect', requireAuth, (req, res) => {
  if (!GITLAB_CLIENT_ID || !GITLAB_CLIENT_SECRET) {
    return res.status(400).json({ error: 'GitLab OAuth not configured' });
  }

  const state = uuidv4();
  req.session.gitlabState = state;

  const callbackUrl = getGitlabCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: GITLAB_CLIENT_ID,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: 'api read_user',
    state,
  });

  res.redirect(`https://gitlab.com/oauth/authorize?${params}`);
});

// GitLab OAuth callback
router.get('/callback', async (req, res) => {
  const frontendUrl = getFrontendUrl(req);
  
  try {
    const { code, state } = req.query;

    if (!code || !state || state !== req.session.gitlabState) {
      return res.redirect(`${frontendUrl}/settings?error=invalid_state`);
    }

    if (!req.session.userId) {
      return res.redirect(`${frontendUrl}/login?error=not_authenticated`);
    }

    if (!GITLAB_CLIENT_ID || !GITLAB_CLIENT_SECRET) {
      return res.redirect(`${frontendUrl}/settings?error=gitlab_not_configured`);
    }

    const callbackUrl = getGitlabCallbackUrl(req);

    // Exchange code for access token
    const tokenResponse = await fetch('https://gitlab.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: GITLAB_CLIENT_ID,
        client_secret: GITLAB_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl,
      }),
    });

    const tokenData = await tokenResponse.json() as { 
      access_token?: string; 
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };

    if (tokenData.error || !tokenData.access_token) {
      console.error('GitLab token error:', tokenData);
      return res.redirect(`${frontendUrl}/settings?error=token_error`);
    }

    // Get GitLab user info
    const userResponse = await fetch('https://gitlab.com/api/v4/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    const gitlabUser = await userResponse.json() as {
      id: number;
      username: string;
      email: string;
    };

    if (!gitlabUser.id) {
      console.error('GitLab user error:', gitlabUser);
      return res.redirect(`${frontendUrl}/settings?error=user_error`);
    }

    // Check if this GitLab account is already linked to another user
    const existingUser = await queryOne<User>(
      'SELECT id, email FROM users WHERE gitlab_id = $1',
      [gitlabUser.id.toString()]
    );
    
    if (existingUser && existingUser.id !== req.session.userId) {
      // GitLab account is already linked to a different user
      console.warn(`GitLab account ${gitlabUser.username} (${gitlabUser.id}) is already linked to user ${existingUser.email}`);
      return res.redirect(`${frontendUrl}/settings?error=gitlab_already_linked`);
    }

    // Update user with GitLab info
    await execute(
      `UPDATE users
       SET gitlab_id = $1, gitlab_access_token = $2, gitlab_refresh_token = $3, gitlab_username = $4, updated_at = NOW()
       WHERE id = $5`,
      [gitlabUser.id.toString(), tokenData.access_token, tokenData.refresh_token || null, gitlabUser.username, req.session.userId]
    );

    delete req.session.gitlabState;
    res.redirect(`${frontendUrl}/settings?gitlab=connected`);
  } catch (error) {
    console.error('GitLab callback error:', error);
    res.redirect(`${frontendUrl}/settings?error=callback_error`);
  }
});

// Disconnect GitLab
router.post('/disconnect', requireAuth, async (req, res) => {
  await execute(
    `UPDATE users
     SET gitlab_id = NULL, gitlab_access_token = NULL, gitlab_refresh_token = NULL, gitlab_username = NULL, updated_at = NOW()
     WHERE id = $1`,
    [req.session.userId]
  );

  res.json({ success: true });
});

// Helper to refresh GitLab token if needed
async function refreshGitlabToken(userId: string, refreshToken: string): Promise<string | null> {
  if (!GITLAB_CLIENT_ID || !GITLAB_CLIENT_SECRET) {
    return null;
  }

  try {
    const response = await fetch('https://gitlab.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITLAB_CLIENT_ID,
        client_secret: GITLAB_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const data = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
    };

    if (data.access_token) {
      // Update stored tokens
      await execute(
        `UPDATE users SET gitlab_access_token = $1, gitlab_refresh_token = $2, updated_at = NOW() WHERE id = $3`,
        [data.access_token, data.refresh_token || refreshToken, userId]
      );
      return data.access_token;
    }
  } catch (error) {
    console.error('GitLab token refresh error:', error);
  }

  return null;
}

// List user's GitLab projects (repositories)
router.get('/repos', requireAuth, async (req, res) => {
  try {
    const user = await queryOne<User & { gitlab_access_token?: string; gitlab_refresh_token?: string }>(
      'SELECT * FROM users WHERE id = $1',
      [req.session.userId]
    );

    if (!user?.gitlab_access_token) {
      return res.status(400).json({ error: 'GitLab not connected' });
    }

    let accessToken = user.gitlab_access_token;

    // Fetch projects with membership (repos user has access to)
    let response = await fetch('https://gitlab.com/api/v4/projects?membership=true&order_by=updated_at&per_page=100', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    // If token expired, try to refresh
    if (response.status === 401 && user.gitlab_refresh_token) {
      const newToken = await refreshGitlabToken(req.session.userId!, user.gitlab_refresh_token);
      if (newToken) {
        accessToken = newToken;
        response = await fetch('https://gitlab.com/api/v4/projects?membership=true&order_by=updated_at&per_page=100', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
      }
    }

    if (!response.ok) {
      console.error('GitLab projects error:', response.status, await response.text());
      return res.status(500).json({ error: 'Failed to fetch GitLab projects' });
    }

    const projects = await response.json() as Array<{
      id: number;
      name: string;
      path_with_namespace: string;
      description: string | null;
      web_url: string;
      http_url_to_repo: string;
      default_branch: string;
      visibility: string;
    }>;

    res.json({
      repos: projects.map((project) => ({
        id: project.id,
        name: project.name,
        full_name: project.path_with_namespace,
        description: project.description,
        url: project.web_url,
        clone_url: project.http_url_to_repo,
        default_branch: project.default_branch || 'main',
        private: project.visibility !== 'public',
      })),
    });
  } catch (error) {
    console.error('GitLab repos error:', error);
    res.status(500).json({ error: 'Failed to fetch repositories' });
  }
});

// Get repository branches
router.get('/repos/:projectId/branches', requireAuth, async (req, res) => {
  try {
    const user = await queryOne<User & { gitlab_access_token?: string; gitlab_refresh_token?: string }>(
      'SELECT * FROM users WHERE id = $1',
      [req.session.userId]
    );

    if (!user?.gitlab_access_token) {
      return res.status(400).json({ error: 'GitLab not connected' });
    }

    let accessToken = user.gitlab_access_token;
    const projectId = encodeURIComponent(req.params.projectId);

    let response = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/repository/branches?per_page=100`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    // If token expired, try to refresh
    if (response.status === 401 && user.gitlab_refresh_token) {
      const newToken = await refreshGitlabToken(req.session.userId!, user.gitlab_refresh_token);
      if (newToken) {
        accessToken = newToken;
        response = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/repository/branches?per_page=100`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
      }
    }

    if (!response.ok) {
      console.error('GitLab branches error:', response.status, await response.text());
      return res.status(500).json({ error: 'Failed to fetch branches' });
    }

    const branches = await response.json() as Array<{
      name: string;
      protected: boolean;
    }>;

    res.json({
      branches: branches.map((branch) => ({
        name: branch.name,
        protected: branch.protected,
      })),
    });
  } catch (error) {
    console.error('GitLab branches error:', error);
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
});

// Create a new branch from an existing branch
router.post('/repos/:projectId/branches', requireAuth, async (req, res) => {
  try {
    const user = await queryOne<User & { gitlab_access_token?: string; gitlab_refresh_token?: string }>(
      'SELECT * FROM users WHERE id = $1',
      [req.session.userId]
    );

    if (!user?.gitlab_access_token) {
      return res.status(400).json({ error: 'GitLab not connected' });
    }

    const projectId = encodeURIComponent(req.params.projectId);
    const { branch_name, base_branch } = req.body;

    if (!branch_name || !base_branch) {
      return res.status(400).json({ error: 'branch_name and base_branch are required' });
    }

    let accessToken = user.gitlab_access_token;

    const params = new URLSearchParams({
      branch: branch_name,
      ref: base_branch,
    });

    let response = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/repository/branches?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    // If token expired, try to refresh
    if (response.status === 401 && user.gitlab_refresh_token) {
      const newToken = await refreshGitlabToken(req.session.userId!, user.gitlab_refresh_token);
      if (newToken) {
        accessToken = newToken;
        response = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/repository/branches?${params}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('GitLab create branch error:', response.status, errorText);
      if (response.status === 400 && errorText.includes('already exists')) {
        return res.status(422).json({ error: 'Branch already exists' });
      }
      return res.status(500).json({ error: 'Failed to create branch' });
    }

    res.json({ 
      success: true, 
      branch: {
        name: branch_name,
        base: base_branch,
      }
    });
  } catch (error: any) {
    console.error('GitLab create branch error:', error);
    res.status(500).json({ error: error.message || 'Failed to create branch' });
  }
});

export default router;
