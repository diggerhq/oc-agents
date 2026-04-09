import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { query, queryOne, execute } from '../db/index.js';
import { getOrgMembership } from '../middleware/orgAuth.js';
import type { ApiKey } from '../types/index.js';

const router = Router();

// Generate a secure API key
function generateApiKey(): { key: string; prefix: string; hash: string } {
  const randomBytes = crypto.randomBytes(24);
  const key = `flt_${randomBytes.toString('base64url')}`;
  const prefix = key.slice(0, 12) + '...';
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return { key, prefix, hash };
}

// List all API keys for the user's current organization
router.get('/', requireAuth, async (req, res) => {
  const orgId = (req as any).organizationId;
  
  // Get keys for org if available, otherwise user's keys
  const keys = orgId
    ? await query<ApiKey>(
        'SELECT id, name, key_prefix, permissions, last_used_at, created_at, organization_id FROM api_keys WHERE organization_id = $1 ORDER BY created_at DESC',
        [orgId]
      )
    : await query<ApiKey>(
        'SELECT id, name, key_prefix, permissions, last_used_at, created_at, organization_id FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC',
        [req.session.userId]
      );
  
  res.json({ keys });
});

// Create a new API key
router.post('/', requireAuth, async (req, res) => {
  const { name } = req.body;
  const orgId = (req as any).organizationId;
  
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  // Check if user has admin+ access to create org API keys
  if (orgId) {
    const membership = await getOrgMembership(req.session.userId!, orgId);
    if (!membership || membership.role === 'member') {
      return res.status(403).json({ error: 'Only admins and owners can create organization API keys' });
    }
  }
  
  const id = uuidv4();
  const { key, prefix, hash } = generateApiKey();
  
  await execute(
    'INSERT INTO api_keys (id, user_id, organization_id, name, key_hash, key_prefix) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, req.session.userId, orgId || null, name, hash, prefix]
  );
  
  // Return the full key ONLY on creation - it can never be retrieved again
  res.json({
    id,
    name,
    key, // Full key - show once
    key_prefix: prefix,
    organization_id: orgId,
    created_at: new Date().toISOString(),
  });
});

// Delete an API key
router.delete('/:id', requireAuth, async (req, res) => {
  const apiKey = await queryOne<ApiKey>(
    'SELECT * FROM api_keys WHERE id = $1',
    [req.params.id]
  );
  
  if (!apiKey) {
    return res.status(404).json({ error: 'API key not found' });
  }
  
  // Check access: owner can delete their own keys, org admins can delete org keys
  let hasAccess = apiKey.user_id === req.session.userId;
  if (!hasAccess && apiKey.organization_id) {
    const membership = await getOrgMembership(req.session.userId!, apiKey.organization_id);
    hasAccess = membership?.role === 'owner' || membership?.role === 'admin';
  }
  
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  await execute('DELETE FROM api_keys WHERE id = $1', [req.params.id]);
  
  res.json({ success: true });
});

export default router;
