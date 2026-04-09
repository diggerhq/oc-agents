import { Router } from 'express';
import { Octokit } from '@octokit/rest';
import { requireAuth } from '../middleware/auth.js';
import { queryOne } from '../db/index.js';
import { getGitHubTokenForUser } from './githubApp.js';
import type { User } from '../types/index.js';

const router = Router();

// Create a new GitHub repository
router.post('/create', requireAuth, async (req, res) => {
  const { name, description, isPrivate } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Repository name is required' });
  }

  // Validate repo name (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({
      error: 'Repository name can only contain letters, numbers, hyphens, and underscores'
    });
  }

  // Try GitHub App token first, fall back to legacy OAuth token
  const appToken = await getGitHubTokenForUser(req.session.userId!);
  const user = await queryOne<User>(
    'SELECT * FROM users WHERE id = $1',
    [req.session.userId]
  );

  const githubToken = appToken?.token || user?.github_access_token;

  if (!githubToken) {
    return res.status(400).json({ error: 'GitHub not connected. Install the GitHub App in Settings.' });
  }

  try {
    const octokit = new Octokit({ auth: githubToken });
    
    // Create the repository
    const response = await octokit.repos.createForAuthenticatedUser({
      name,
      description: description || '',
      private: isPrivate ?? false,
      auto_init: true, // Initialize with README
    });
    
    res.json({
      success: true,
      repo: {
        id: response.data.id,
        name: response.data.name,
        full_name: response.data.full_name,
        url: response.data.html_url,
        clone_url: response.data.clone_url,
        default_branch: response.data.default_branch,
        private: response.data.private,
      },
    });
  } catch (error) {
    console.error('Failed to create GitHub repo:', error);
    
    if (error instanceof Error && 'status' in error) {
      const status = (error as { status: number }).status;
      if (status === 422) {
        return res.status(400).json({ error: 'Repository name already exists' });
      }
    }
    
    res.status(500).json({ error: 'Failed to create repository' });
  }
});

// Initialize a local repository in the sandbox (placeholder for sandbox operation)
router.post('/init-local', requireAuth, async (req, res) => {
  const { sessionId, name } = req.body;
  
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }
  
  // This will be handled by the E2B service when starting the sandbox
  // The sandbox will run: git init, create initial files, etc.
  res.json({
    success: true,
    message: 'Local repository will be initialized when the sandbox starts',
    repoName: name || 'workspace',
  });
});

// List user's GitHub repositories
router.get('/list', requireAuth, async (req, res) => {
  // Try GitHub App token first, fall back to legacy OAuth token
  const appToken = await getGitHubTokenForUser(req.session.userId!);
  const user = await queryOne<User>(
    'SELECT * FROM users WHERE id = $1',
    [req.session.userId]
  );

  const githubToken = appToken?.token || user?.github_access_token;

  if (!githubToken) {
    return res.status(400).json({ error: 'GitHub not connected. Install the GitHub App in Settings.' });
  }

  try {
    const octokit = new Octokit({ auth: githubToken });
    
    const { data: repos } = await octokit.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 100,
    });
    
    res.json({
      repos: repos.map(repo => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        url: repo.html_url,
        clone_url: repo.clone_url,
        default_branch: repo.default_branch,
        private: repo.private,
        description: repo.description,
        updated_at: repo.updated_at,
      })),
    });
  } catch (error) {
    console.error('Failed to list GitHub repos:', error);
    res.status(500).json({ error: 'Failed to list repositories' });
  }
});

export default router;
