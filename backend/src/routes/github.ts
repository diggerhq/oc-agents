import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Octokit } from '@octokit/rest';
import { requireAuth } from '../middleware/auth.js';
import { queryOne, execute } from '../db/index.js';
import type { User } from '../types/index.js';

const router = Router();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET!;

// Allowed domains for authentication (supports multiple domains pointing to same app)
const ALLOWED_DOMAINS = ['oshu.dev', 'primeintuition.ai', 'localhost'];

// Get the appropriate callback URL based on the request origin
function getGithubCallbackUrl(req: import('express').Request): string {
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
  
  const domain = host.split(':')[0];
  if (ALLOWED_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) {
    return `${protocol}://${host}/api/auth/github/callback`;
  }
  
  return process.env.GITHUB_CALLBACK_URL || 'http://localhost:3000/api/auth/github/callback';
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

// Initiate GitHub OAuth
router.get('/connect', requireAuth, (req, res) => {
  const state = uuidv4();
  req.session.githubState = state;

  const callbackUrl = getGithubCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: callbackUrl,
    scope: 'repo user:email',
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// GitHub OAuth callback
router.get('/callback', async (req, res) => {
  const frontendUrl = getFrontendUrl(req);
  
  try {
    const { code, state } = req.query;

    if (!code || !state || state !== req.session.githubState) {
      return res.redirect(`${frontendUrl}/settings?error=invalid_state`);
    }

    if (!req.session.userId) {
      return res.redirect(`${frontendUrl}/login?error=not_authenticated`);
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };

    if (tokenData.error || !tokenData.access_token) {
      console.error('GitHub token error:', tokenData);
      return res.redirect(`${frontendUrl}/settings?error=token_error`);
    }

    // Get GitHub user info
    const octokit = new Octokit({ auth: tokenData.access_token });
    const { data: githubUser } = await octokit.rest.users.getAuthenticated();

    // Check if this GitHub account is already linked to another user
    const existingUser = await queryOne<User>(
      'SELECT id, email FROM users WHERE github_id = $1',
      [githubUser.id.toString()]
    );
    
    if (existingUser && existingUser.id !== req.session.userId) {
      // GitHub account is already linked to a different user
      console.warn(`GitHub account ${githubUser.login} (${githubUser.id}) is already linked to user ${existingUser.email}`);
      return res.redirect(`${frontendUrl}/settings?error=github_already_linked`);
    }

    // Update user with GitHub info
    await execute(
      `UPDATE users
       SET github_id = $1, github_access_token = $2, github_username = $3, updated_at = NOW()
       WHERE id = $4`,
      [githubUser.id.toString(), tokenData.access_token, githubUser.login, req.session.userId]
    );

    delete req.session.githubState;
    res.redirect(`${frontendUrl}/settings?github=connected`);
  } catch (error) {
    console.error('GitHub callback error:', error);
    res.redirect(`${frontendUrl}/settings?error=callback_error`);
  }
});

// Disconnect GitHub
router.post('/disconnect', requireAuth, async (req, res) => {
  await execute(
    `UPDATE users
     SET github_id = NULL, github_access_token = NULL, github_username = NULL, updated_at = NOW()
     WHERE id = $1`,
    [req.session.userId]
  );

  res.json({ success: true });
});

// List user's repositories
router.get('/repos', requireAuth, async (req, res) => {
  try {
    const user = await queryOne<User>('SELECT * FROM users WHERE id = $1', [req.session.userId]);

    if (!user?.github_access_token) {
      return res.status(400).json({ error: 'GitHub not connected' });
    }

    const octokit = new Octokit({ auth: user.github_access_token });
    const { data: repos } = await octokit.rest.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 100,
    });

    res.json({
      repos: repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        url: repo.html_url,
        clone_url: repo.clone_url,
        default_branch: repo.default_branch,
        private: repo.private,
      })),
    });
  } catch (error) {
    console.error('GitHub repos error:', error);
    res.status(500).json({ error: 'Failed to fetch repositories' });
  }
});

// Get repository branches
router.get('/repos/:owner/:repo/branches', requireAuth, async (req, res) => {
  try {
    const user = await queryOne<User>('SELECT * FROM users WHERE id = $1', [req.session.userId]);

    if (!user?.github_access_token) {
      return res.status(400).json({ error: 'GitHub not connected' });
    }

    const octokit = new Octokit({ auth: user.github_access_token });
    const { data: branches } = await octokit.rest.repos.listBranches({
      owner: req.params.owner,
      repo: req.params.repo,
      per_page: 100,
    });

    res.json({
      branches: branches.map((branch) => ({
        name: branch.name,
        protected: branch.protected,
      })),
    });
  } catch (error) {
    console.error('GitHub branches error:', error);
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
});

// Create a new branch from an existing branch
router.post('/repos/:owner/:repo/branches', requireAuth, async (req, res) => {
  try {
    const user = await queryOne<User>('SELECT * FROM users WHERE id = $1', [req.session.userId]);

    if (!user?.github_access_token) {
      return res.status(400).json({ error: 'GitHub not connected' });
    }

    const { owner, repo } = req.params;
    const { branch_name, base_branch } = req.body;

    if (!branch_name || !base_branch) {
      return res.status(400).json({ error: 'branch_name and base_branch are required' });
    }

    const octokit = new Octokit({ auth: user.github_access_token });

    // Get the SHA of the base branch
    const { data: baseBranchData } = await octokit.rest.repos.getBranch({
      owner,
      repo,
      branch: base_branch,
    });

    // Create the new branch (as a git reference)
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch_name}`,
      sha: baseBranchData.commit.sha,
    });

    res.json({ 
      success: true, 
      branch: {
        name: branch_name,
        base: base_branch,
      }
    });
  } catch (error: any) {
    console.error('GitHub create branch error:', error);
    if (error.status === 422) {
      return res.status(422).json({ error: 'Branch already exists' });
    }
    res.status(500).json({ error: error.message || 'Failed to create branch' });
  }
});

export default router;
