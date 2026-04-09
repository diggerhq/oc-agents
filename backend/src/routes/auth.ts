import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { queryOne, query, execute } from '../db/index.js';
import type { User, Organization } from '../types/index.js';
import { generateUniqueSlug } from '../middleware/orgAuth.js';
import { createDefaultBucket } from '../utils/defaultBucket.js';

/**
 * Create a personal organization for a user
 */
async function createPersonalOrg(userId: string, email: string): Promise<Organization> {
  const orgId = uuidv4();
  const memberId = uuidv4();
  const now = new Date().toISOString();
  const name = 'Personal Workspace';
  const slug = await generateUniqueSlug(email.split('@')[0]);
  
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

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password } = registerSchema.parse(req.body);

    // Check if user exists
    const existing = await queryOne<User>('SELECT * FROM users WHERE email = $1', [email]);
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, 12);
    const id = uuidv4();

    await execute(
      'INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)',
      [id, email, passwordHash]
    );

    // Create personal organization for the user
    const personalOrg = await createPersonalOrg(id, email);

    req.session.userId = id;
    req.session.currentOrgId = personalOrg.id;
    res.json({ success: true, user: { id, email }, organization: personalOrg });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await queryOne<User>('SELECT * FROM users WHERE email = $1', [email]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.userId = user.id;
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        github_username: user.github_username,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ success: true });
  });
});

// Admin: Impersonate user (for support/debugging)
// Only accessible by admin users (brian@digger.dev)
router.post('/admin/impersonate', async (req, res) => {
  try {
    // Check if current user is an admin
    const currentUserId = req.session.userId;
    if (!currentUserId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const currentUser = await queryOne<User>('SELECT * FROM users WHERE id = $1', [currentUserId]);
    if (!currentUser || currentUser.email !== 'brian@digger.dev') {
      return res.status(403).json({ error: 'Unauthorized - admin access required' });
    }
    
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }
    
    // Find user by email
    const user = await queryOne<User>('SELECT * FROM users WHERE email = $1', [email]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Set session to this user
    req.session.userId = user.id;
    
    // Get their personal org
    const { getUserOrganizations } = await import('../middleware/orgAuth.js');
    const organizations = await getUserOrganizations(user.id);
    const personalOrg = organizations.find(o => o.is_personal);
    
    if (personalOrg) {
      req.session.currentOrgId = personalOrg.id;
    }
    
    res.json({
      success: true,
      message: `Now logged in as ${user.email}`,
      user: {
        id: user.id,
        email: user.email,
        github_username: user.github_username,
      },
    });
  } catch (error) {
    console.error('Impersonation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const user = await queryOne<User>('SELECT * FROM users WHERE id = $1', [req.session.userId]);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  // Check if user has GitHub App installations
  const githubAppInstallations = await query<{ installation_id: number }>(
    'SELECT installation_id FROM github_app_installations WHERE user_id = $1 LIMIT 1',
    [req.session.userId]
  );
  const hasGitHubAppInstalled = githubAppInstallations.length > 0;

  // Get user's organizations
  const { getUserOrganizations } = await import('../middleware/orgAuth.js');
  const organizations = await getUserOrganizations(req.session.userId);
  
  // Get current org (from session or default to personal)
  let currentOrgId = req.session.currentOrgId;
  if (!currentOrgId && organizations.length > 0) {
    // Default to personal org
    const personalOrg = organizations.find(o => o.is_personal);
    currentOrgId = personalOrg?.id || organizations[0].id;
  }

  res.json({
    user: {
      id: user.id,
      email: user.email,
      github_username: user.github_username,
      github_connected: hasGitHubAppInstalled,  // Now based on GitHub App, not OAuth
      gitlab_username: user.gitlab_username,
      gitlab_connected: !!user.gitlab_access_token,
    },
    organizations,
    current_organization_id: currentOrgId,
  });
});

export default router;
