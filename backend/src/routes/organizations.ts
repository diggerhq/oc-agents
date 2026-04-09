import { Router, Request, Response } from 'express';
import { randomUUID, randomBytes } from 'crypto';
import { execute, query, queryOne, withTransaction } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { 
  requireOrgMembership, 
  requireOrgRole, 
  getUserOrganizations,
  getOrgMembership,
  generateUniqueSlug,
  generateSlug,
} from '../middleware/orgAuth.js';
import { Organization, OrganizationMember, OrganizationInvitation, User } from '../types/index.js';
import { withConstraintHandling } from '../utils/dbErrors.js';
import { createDefaultBucket } from '../utils/defaultBucket.js';

const router = Router();

// Apply auth middleware to all routes
router.use(requireAuth);

/**
 * GET /api/organizations
 * List all organizations the user belongs to
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const orgs = await getUserOrganizations(userId);
    res.json(orgs);
  } catch (error) {
    console.error('Error fetching organizations:', error);
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

/**
 * POST /api/organizations
 * Create a new organization
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const { name } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Organization name is required' });
    }
    
    const trimmedName = name.trim();
    if (trimmedName.length > 100) {
      return res.status(400).json({ error: 'Organization name must be 100 characters or less' });
    }
    
    const slug = await generateUniqueSlug(trimmedName);
    const orgId = randomUUID();
    const memberId = randomUUID();
    const now = new Date().toISOString();
    
    // Create organization with constraint handling
    await withConstraintHandling(async () => {
      await execute(
        `INSERT INTO organizations (id, name, slug, is_personal, owner_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [orgId, trimmedName, slug, false, userId, now, now]
      );
      
      // Add creator as owner
      await execute(
        `INSERT INTO organization_members (id, organization_id, user_id, role, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [memberId, orgId, userId, 'owner', now]
      );
    }, 'organization');
    
    // Create the default "Files" bucket for this organization
    await createDefaultBucket(userId, orgId);
    
    const org: Organization = {
      id: orgId,
      name: trimmedName,
      slug,
      is_personal: false,
      owner_id: userId,
      created_at: now,
      updated_at: now,
    };
    
    res.status(201).json({ ...org, role: 'owner' });
  } catch (error: any) {
    if (error.code === 'DUPLICATE_RESOURCE') {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        field: error.field
      });
    }
    console.error('Error creating organization:', error);
    res.status(500).json({ error: 'Failed to create organization' });
  }
});

/**
 * GET /api/organizations/my-invitations
 * Get pending invitations for the current user
 */
router.get('/my-invitations', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    
    // Get user email
    const user = await queryOne<User>(
      'SELECT email FROM users WHERE id = $1',
      [userId]
    );
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get pending invitations for this email
    const invitations = await query<OrganizationInvitation & { organization_name: string; invited_by_email: string }>(
      `SELECT oi.*, o.name as organization_name, u.email as invited_by_email
       FROM organization_invitations oi
       JOIN organizations o ON oi.organization_id = o.id
       JOIN users u ON oi.invited_by = u.id
       WHERE LOWER(oi.email) = LOWER($1) 
         AND oi.accepted_at IS NULL 
         AND oi.expires_at > $2
       ORDER BY oi.created_at DESC`,
      [user.email, new Date().toISOString()]
    );
    
    res.json(invitations);
  } catch (error) {
    console.error('Error fetching user invitations:', error);
    res.status(500).json({ error: 'Failed to fetch invitations' });
  }
});

/**
 * POST /api/organizations/invitations/:inviteId/accept
 * Accept an invitation by ID (for internal UI flow)
 */
router.post('/invitations/:inviteId/accept', requireAuth, async (req: Request, res: Response) => {
  try {
    const { inviteId } = req.params;
    const userId = req.session.userId!;
    
    // Get user email
    const user = await queryOne<User>(
      'SELECT email FROM users WHERE id = $1',
      [userId]
    );
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const invitation = await queryOne<OrganizationInvitation>(
      'SELECT * FROM organization_invitations WHERE id = $1',
      [inviteId]
    );
    
    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    if (invitation.accepted_at) {
      return res.status(400).json({ error: 'Invitation has already been accepted' });
    }
    
    if (new Date(invitation.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invitation has expired' });
    }
    
    // Verify email matches (case insensitive)
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      return res.status(403).json({ error: 'This invitation was sent to a different email address' });
    }
    
    // Check if already a member
    const existingMember = await getOrgMembership(userId, invitation.organization_id);
    if (existingMember) {
      // Already a member, just mark invitation as accepted
      await execute(
        'UPDATE organization_invitations SET accepted_at = $1 WHERE id = $2',
        [new Date().toISOString(), invitation.id]
      );
      return res.status(400).json({ error: 'You are already a member of this organization' });
    }
    
    const now = new Date().toISOString();
    const memberId = randomUUID();
    
    // Add user as member with constraint handling
    await withConstraintHandling(async () => {
      await execute(
        `INSERT INTO organization_members (id, organization_id, user_id, role, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [memberId, invitation.organization_id, userId, invitation.role, now]
      );
    }, 'organization member');
    
    // Mark invitation as accepted
    await execute(
      'UPDATE organization_invitations SET accepted_at = $1 WHERE id = $2',
      [now, invitation.id]
    );
    
    // Get org for response
    const org = await queryOne<Organization>(
      'SELECT * FROM organizations WHERE id = $1',
      [invitation.organization_id]
    );
    
    res.json({
      message: 'Invitation accepted',
      organization: org,
      role: invitation.role,
    });
  } catch (error: any) {
    if (error.code === 'DUPLICATE_RESOURCE') {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        field: error.field
      });
    }
    console.error('Error accepting invitation:', error);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

/**
 * POST /api/organizations/invitations/:inviteId/decline
 * Decline an invitation
 */
router.post('/invitations/:inviteId/decline', requireAuth, async (req: Request, res: Response) => {
  try {
    const { inviteId } = req.params;
    const userId = req.session.userId!;
    
    // Get user email
    const user = await queryOne<User>(
      'SELECT email FROM users WHERE id = $1',
      [userId]
    );
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const invitation = await queryOne<OrganizationInvitation>(
      'SELECT * FROM organization_invitations WHERE id = $1',
      [inviteId]
    );
    
    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    // Verify email matches
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      return res.status(403).json({ error: 'This invitation was sent to a different email address' });
    }
    
    // Delete the invitation (decline = delete)
    await execute(
      'DELETE FROM organization_invitations WHERE id = $1',
      [inviteId]
    );
    
    res.json({ message: 'Invitation declined' });
  } catch (error) {
    console.error('Error declining invitation:', error);
    res.status(500).json({ error: 'Failed to decline invitation' });
  }
});

/**
 * GET /api/organizations/:orgId
 * Get organization details
 */
router.get('/:orgId', requireOrgMembership('orgId'), async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const membership = (req as any).orgMembership as OrganizationMember;
    
    const org = await queryOne<Organization>(
      'SELECT * FROM organizations WHERE id = $1',
      [orgId]
    );
    
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    // Get member count
    const memberCount = await queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM organization_members WHERE organization_id = $1',
      [orgId]
    );
    
    res.json({
      ...org,
      role: membership.role,
      member_count: memberCount?.count || 0,
    });
  } catch (error) {
    console.error('Error fetching organization:', error);
    res.status(500).json({ error: 'Failed to fetch organization' });
  }
});

/**
 * PATCH /api/organizations/:orgId
 * Update organization (admin or owner only)
 */
router.patch('/:orgId', requireOrgRole('admin', 'orgId'), async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const { name, slug: newSlug } = req.body;
    
    const org = await queryOne<Organization>(
      'SELECT * FROM organizations WHERE id = $1',
      [orgId]
    );
    
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    // Personal orgs cannot be renamed
    if (org.is_personal && name) {
      return res.status(400).json({ error: 'Personal organization cannot be renamed' });
    }
    
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    if (name && typeof name === 'string') {
      const trimmedName = name.trim();
      if (trimmedName.length > 100) {
        return res.status(400).json({ error: 'Organization name must be 100 characters or less' });
      }
      updates.push(`name = $${paramIndex++}`);
      values.push(trimmedName);
    }
    
    if (newSlug && typeof newSlug === 'string') {
      const sanitizedSlug = generateSlug(newSlug);
      // Check if slug is taken
      const existing = await queryOne<{ id: string }>(
        'SELECT id FROM organizations WHERE slug = $1 AND id != $2',
        [sanitizedSlug, orgId]
      );
      if (existing) {
        return res.status(400).json({ error: 'Slug is already taken' });
      }
      updates.push(`slug = $${paramIndex++}`);
      values.push(sanitizedSlug);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid updates provided' });
    }
    
    updates.push(`updated_at = $${paramIndex++}`);
    values.push(new Date().toISOString());
    values.push(orgId);
    
    await execute(
      `UPDATE organizations SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
    
    const updatedOrg = await queryOne<Organization>(
      'SELECT * FROM organizations WHERE id = $1',
      [orgId]
    );
    
    res.json(updatedOrg);
  } catch (error) {
    console.error('Error updating organization:', error);
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

/**
 * DELETE /api/organizations/:orgId
 * Delete organization (owner only)
 * Resources are reassigned to the owner's personal organization
 */
router.delete('/:orgId', requireOrgRole('owner', 'orgId'), async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    
    const org = await queryOne<Organization>(
      'SELECT * FROM organizations WHERE id = $1',
      [orgId]
    );
    
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    // Cannot delete personal org
    if (org.is_personal) {
      return res.status(400).json({ error: 'Personal organization cannot be deleted' });
    }
    
    // Get owner's personal org to reassign resources
    const personalOrg = await queryOne<Organization>(
      'SELECT * FROM organizations WHERE owner_id = $1 AND is_personal = true',
      [org.owner_id]
    );
    
    if (!personalOrg) {
      return res.status(500).json({ error: 'Owner personal organization not found' });
    }
    
    // Use transaction to reassign resources and delete org atomically
    await withTransaction(async (tx) => {
      // Reassign all resources to owner's personal org
      const resourceTables = [
        'sessions', 'workflows', 'buckets', 'knowledge_bases', 
        'integrations', 'schedules', 'skills', 'api_keys', 
        'webhooks', 'github_webhooks', 'scheduled_tasks'
      ];
      
      for (const table of resourceTables) {
        await tx.execute(
          `UPDATE ${table} SET organization_id = $1 WHERE organization_id = $2`,
          [personalOrg.id, orgId]
        );
      }
      
      // Delete organization (cascades to members, invitations, resource_permissions)
      await tx.execute('DELETE FROM organizations WHERE id = $1', [orgId]);
    });
    
    res.json({ message: 'Organization deleted successfully. Resources moved to your personal workspace.' });
  } catch (error) {
    console.error('Error deleting organization:', error);
    res.status(500).json({ error: 'Failed to delete organization' });
  }
});

/**
 * GET /api/organizations/:orgId/members
 * List organization members
 */
router.get('/:orgId/members', requireOrgMembership('orgId'), async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    
    const members = await query<OrganizationMember & { email: string }>(
      `SELECT om.*, u.email
       FROM organization_members om
       JOIN users u ON om.user_id = u.id
       WHERE om.organization_id = $1
       ORDER BY 
         CASE om.role 
           WHEN 'owner' THEN 1 
           WHEN 'admin' THEN 2 
           ELSE 3 
         END,
         om.created_at ASC`,
      [orgId]
    );
    
    res.json(members);
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

/**
 * PATCH /api/organizations/:orgId/members/:userId
 * Update member role (admin or owner only)
 */
router.patch('/:orgId/members/:userId', requireOrgRole('admin', 'orgId'), async (req: Request, res: Response) => {
  try {
    const { orgId, userId: targetUserId } = req.params;
    const { role } = req.body;
    const currentMembership = (req as any).orgMembership as OrganizationMember;
    const currentUserId = req.session.userId!;
    
    if (!role || !['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be "admin" or "member"' });
    }
    
    // Get target member
    const targetMember = await getOrgMembership(targetUserId, orgId);
    if (!targetMember) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    // Cannot change owner role (must transfer ownership instead)
    if (targetMember.role === 'owner') {
      return res.status(400).json({ error: 'Cannot change owner role. Transfer ownership instead.' });
    }
    
    // Admins cannot promote to owner or change other admins
    if (currentMembership.role === 'admin') {
      if (role === 'owner') {
        return res.status(403).json({ error: 'Only owners can transfer ownership' });
      }
      if (targetMember.role === 'admin' && targetUserId !== currentUserId) {
        return res.status(403).json({ error: 'Admins cannot change other admins' });
      }
    }
    
    await execute(
      'UPDATE organization_members SET role = $1 WHERE organization_id = $2 AND user_id = $3',
      [role, orgId, targetUserId]
    );
    
    res.json({ message: 'Member role updated', user_id: targetUserId, role });
  } catch (error) {
    console.error('Error updating member:', error);
    res.status(500).json({ error: 'Failed to update member' });
  }
});

/**
 * DELETE /api/organizations/:orgId/members/:userId
 * Remove member from organization (admin or owner only, or self)
 */
router.delete('/:orgId/members/:userId', requireOrgMembership('orgId'), async (req: Request, res: Response) => {
  try {
    const { orgId, userId: targetUserId } = req.params;
    const currentMembership = (req as any).orgMembership as OrganizationMember;
    const currentUserId = req.session.userId!;
    
    // Users can always remove themselves (leave org)
    const isSelfRemoval = targetUserId === currentUserId;
    
    // Non-admins can only remove themselves
    if (!isSelfRemoval && currentMembership.role === 'member') {
      return res.status(403).json({ error: 'Only admins and owners can remove members' });
    }
    
    // Get target member
    const targetMember = await getOrgMembership(targetUserId, orgId);
    if (!targetMember) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    // Cannot remove the owner
    if (targetMember.role === 'owner') {
      return res.status(400).json({ error: 'Cannot remove organization owner. Transfer ownership first.' });
    }
    
    // Admins cannot remove other admins (only owners can)
    if (!isSelfRemoval && currentMembership.role === 'admin' && targetMember.role === 'admin') {
      return res.status(403).json({ error: 'Admins cannot remove other admins' });
    }
    
    await execute(
      'DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2',
      [orgId, targetUserId]
    );
    
    res.json({ message: 'Member removed from organization' });
  } catch (error) {
    console.error('Error removing member:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

/**
 * POST /api/organizations/:orgId/transfer-ownership
 * Transfer ownership to another member (owner only)
 */
router.post('/:orgId/transfer-ownership', requireOrgRole('owner', 'orgId'), async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const { new_owner_id } = req.body;
    const currentUserId = req.session.userId!;
    
    if (!new_owner_id) {
      return res.status(400).json({ error: 'new_owner_id is required' });
    }
    
    // Verify new owner is a member
    const newOwnerMember = await getOrgMembership(new_owner_id, orgId);
    if (!newOwnerMember) {
      return res.status(404).json({ error: 'User is not a member of this organization' });
    }
    
    // Use transaction to ensure atomic ownership transfer
    await withTransaction(async (tx) => {
      // Update current owner to admin
      await tx.execute(
        'UPDATE organization_members SET role = $1 WHERE organization_id = $2 AND user_id = $3',
        ['admin', orgId, currentUserId]
      );
      
      // Update new owner
      await tx.execute(
        'UPDATE organization_members SET role = $1 WHERE organization_id = $2 AND user_id = $3',
        ['owner', orgId, new_owner_id]
      );
      
      // Update organization owner_id
      await tx.execute(
        'UPDATE organizations SET owner_id = $1, updated_at = $2 WHERE id = $3',
        [new_owner_id, new Date().toISOString(), orgId]
      );
    });
    
    res.json({ message: 'Ownership transferred successfully', new_owner_id });
  } catch (error) {
    console.error('Error transferring ownership:', error);
    res.status(500).json({ error: 'Failed to transfer ownership' });
  }
});

// ============================================
// INVITATIONS
// ============================================

/**
 * GET /api/organizations/:orgId/invitations
 * List pending invitations (admin or owner only)
 */
router.get('/:orgId/invitations', requireOrgRole('admin', 'orgId'), async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    
    const invitations = await query<OrganizationInvitation & { invited_by_email: string }>(
      `SELECT oi.*, u.email as invited_by_email
       FROM organization_invitations oi
       JOIN users u ON oi.invited_by = u.id
       WHERE oi.organization_id = $1 AND oi.accepted_at IS NULL AND oi.expires_at > $2
       ORDER BY oi.created_at DESC`,
      [orgId, new Date().toISOString()]
    );
    
    res.json(invitations);
  } catch (error) {
    console.error('Error fetching invitations:', error);
    res.status(500).json({ error: 'Failed to fetch invitations' });
  }
});

/**
 * POST /api/organizations/:orgId/invitations
 * Send an invitation (admin or owner only)
 */
router.post('/:orgId/invitations', requireOrgRole('admin', 'orgId'), async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const { email, role } = req.body;
    const inviterId = req.session.userId!;
    const currentMembership = (req as any).orgMembership as OrganizationMember;
    
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const normalizedEmail = email.toLowerCase().trim();
    
    // Validate role
    if (!role || !['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Role must be "admin" or "member"' });
    }
    
    // Admins cannot invite other admins
    if (currentMembership.role === 'admin' && role === 'admin') {
      return res.status(403).json({ error: 'Only owners can invite admins' });
    }
    
    // Check if user is already a member
    const existingUser = await queryOne<User>(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );
    
    if (existingUser) {
      const existingMember = await getOrgMembership(existingUser.id, orgId);
      if (existingMember) {
        return res.status(400).json({ error: 'User is already a member of this organization' });
      }
    }
    
    // Check for existing pending invitation
    const existingInvite = await queryOne<OrganizationInvitation>(
      `SELECT * FROM organization_invitations 
       WHERE organization_id = $1 AND email = $2 AND accepted_at IS NULL AND expires_at > $3`,
      [orgId, normalizedEmail, new Date().toISOString()]
    );
    
    if (existingInvite) {
      return res.status(400).json({ error: 'An invitation is already pending for this email' });
    }
    
    // Create invitation
    const inviteId = randomUUID();
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
    const now = new Date().toISOString();
    
    await execute(
      `INSERT INTO organization_invitations (id, organization_id, email, role, token, invited_by, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [inviteId, orgId, normalizedEmail, role, token, inviterId, expiresAt, now]
    );
    
    // Get org name for the response
    const org = await queryOne<Organization>(
      'SELECT name FROM organizations WHERE id = $1',
      [orgId]
    );
    
    const invitation: OrganizationInvitation = {
      id: inviteId,
      organization_id: orgId,
      email: normalizedEmail,
      role: role as 'admin' | 'member',
      token,
      invited_by: inviterId,
      expires_at: expiresAt,
      created_at: now,
    };
    
    // In a real app, you'd send an email here with the invitation link
    // For now, return the token in the response
    res.status(201).json({
      ...invitation,
      organization_name: org?.name,
      invite_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/invitations/${token}`,
    });
  } catch (error) {
    console.error('Error creating invitation:', error);
    res.status(500).json({ error: 'Failed to create invitation' });
  }
});

/**
 * DELETE /api/organizations/:orgId/invitations/:inviteId
 * Revoke an invitation (admin or owner only)
 */
router.delete('/:orgId/invitations/:inviteId', requireOrgRole('admin', 'orgId'), async (req: Request, res: Response) => {
  try {
    const { orgId, inviteId } = req.params;
    
    const invitation = await queryOne<OrganizationInvitation>(
      'SELECT * FROM organization_invitations WHERE id = $1 AND organization_id = $2',
      [inviteId, orgId]
    );
    
    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    await execute(
      'DELETE FROM organization_invitations WHERE id = $1',
      [inviteId]
    );
    
    res.json({ message: 'Invitation revoked' });
  } catch (error) {
    console.error('Error revoking invitation:', error);
    res.status(500).json({ error: 'Failed to revoke invitation' });
  }
});

/**
 * GET /api/invitations/:token
 * Get invitation details by token (public - no auth required for viewing)
 */
router.get('/invitations/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    
    const invitation = await queryOne<OrganizationInvitation & { organization_name: string }>(
      `SELECT oi.*, o.name as organization_name
       FROM organization_invitations oi
       JOIN organizations o ON oi.organization_id = o.id
       WHERE oi.token = $1`,
      [token]
    );
    
    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    if (invitation.accepted_at) {
      return res.status(400).json({ error: 'Invitation has already been accepted' });
    }
    
    if (new Date(invitation.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invitation has expired' });
    }
    
    // Return limited info for unauthenticated requests
    res.json({
      email: invitation.email,
      role: invitation.role,
      organization_name: invitation.organization_name,
      expires_at: invitation.expires_at,
    });
  } catch (error) {
    console.error('Error fetching invitation:', error);
    res.status(500).json({ error: 'Failed to fetch invitation' });
  }
});

/**
 * POST /api/invitations/:token/accept
 * Accept an invitation (requires auth)
 */
router.post('/invitations/:token/accept', requireAuth, async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const userId = req.session.userId!;
    
    // Get user email
    const user = await queryOne<User>(
      'SELECT email FROM users WHERE id = $1',
      [userId]
    );
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const invitation = await queryOne<OrganizationInvitation>(
      'SELECT * FROM organization_invitations WHERE token = $1',
      [token]
    );
    
    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    if (invitation.accepted_at) {
      return res.status(400).json({ error: 'Invitation has already been accepted' });
    }
    
    if (new Date(invitation.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invitation has expired' });
    }
    
    // Verify email matches (case insensitive)
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      return res.status(403).json({ 
        error: 'This invitation was sent to a different email address',
        expected_email: invitation.email,
      });
    }
    
    // Check if already a member
    const existingMember = await getOrgMembership(userId, invitation.organization_id);
    if (existingMember) {
      return res.status(400).json({ error: 'You are already a member of this organization' });
    }
    
    const now = new Date().toISOString();
    const memberId = randomUUID();
    
    // Add user as member
    await execute(
      `INSERT INTO organization_members (id, organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [memberId, invitation.organization_id, userId, invitation.role, now]
    );
    
    // Mark invitation as accepted
    await execute(
      'UPDATE organization_invitations SET accepted_at = $1 WHERE id = $2',
      [now, invitation.id]
    );
    
    // Get org for response
    const org = await queryOne<Organization>(
      'SELECT * FROM organizations WHERE id = $1',
      [invitation.organization_id]
    );
    
    res.json({
      message: 'Invitation accepted',
      organization: org,
      role: invitation.role,
    });
  } catch (error) {
    console.error('Error accepting invitation:', error);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

/**
 * POST /api/organizations/:orgId/switch
 * Switch to this organization as the current context
 */
router.post('/:orgId/switch', requireOrgMembership('orgId'), async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    
    // Store in session
    req.session.currentOrgId = orgId;
    
    res.json({ message: 'Switched to organization', organization_id: orgId });
  } catch (error) {
    console.error('Error switching organization:', error);
    res.status(500).json({ error: 'Failed to switch organization' });
  }
});

// ============================================
// RESOURCE PERMISSIONS
// ============================================

/**
 * GET /api/organizations/resources/:resourceType/:resourceId/permissions
 * Get permissions for a resource
 */
router.get('/resources/:resourceType/:resourceId/permissions', requireAuth, async (req: Request, res: Response) => {
  try {
    const { resourceType, resourceId } = req.params;
    const userId = req.session.userId!;
    
    // Get the resource's organization
    const tableMap: Record<string, string> = {
      'session': 'sessions',
      'workflow': 'workflows',
      'bucket': 'buckets',
      'knowledge_base': 'knowledge_bases',
      'integration': 'integrations',
    };
    
    const tableName = tableMap[resourceType];
    if (!tableName) {
      return res.status(400).json({ error: 'Invalid resource type' });
    }
    
    const resource = await queryOne<{ organization_id: string; user_id: string }>(
      `SELECT organization_id, user_id FROM ${tableName} WHERE id = $1`,
      [resourceId]
    );
    
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    
    // Check if user has access
    const isOwner = resource.user_id === userId;
    let hasAccess = isOwner;
    
    if (!hasAccess && resource.organization_id) {
      const membership = await getOrgMembership(userId, resource.organization_id);
      hasAccess = !!membership;
    }
    
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get permissions
    const permission = await queryOne<{ visibility: string; min_role: string }>(
      'SELECT visibility, min_role FROM resource_permissions WHERE resource_type = $1 AND resource_id = $2',
      [resourceType, resourceId]
    );
    
    res.json({
      visibility: permission?.visibility || 'org',
      min_role: permission?.min_role || 'member',
    });
  } catch (error) {
    console.error('Error fetching resource permissions:', error);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

/**
 * PATCH /api/organizations/resources/:resourceType/:resourceId/permissions
 * Update permissions for a resource (admin+ or owner only)
 */
router.patch('/resources/:resourceType/:resourceId/permissions', requireAuth, async (req: Request, res: Response) => {
  try {
    const { resourceType, resourceId } = req.params;
    const { visibility, min_role } = req.body;
    const userId = req.session.userId!;
    
    // Validate inputs
    if (visibility && !['org', 'private', 'role'].includes(visibility)) {
      return res.status(400).json({ error: 'Invalid visibility. Must be org, private, or role' });
    }
    
    if (min_role && !['owner', 'admin', 'member'].includes(min_role)) {
      return res.status(400).json({ error: 'Invalid min_role. Must be owner, admin, or member' });
    }
    
    // Get the resource's organization
    const tableMap: Record<string, string> = {
      'session': 'sessions',
      'workflow': 'workflows',
      'bucket': 'buckets',
      'knowledge_base': 'knowledge_bases',
      'integration': 'integrations',
    };
    
    const tableName = tableMap[resourceType];
    if (!tableName) {
      return res.status(400).json({ error: 'Invalid resource type' });
    }
    
    const resource = await queryOne<{ organization_id: string; user_id: string }>(
      `SELECT organization_id, user_id FROM ${tableName} WHERE id = $1`,
      [resourceId]
    );
    
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    
    // Check if user can modify permissions (owner of resource OR admin+ in org)
    const isResourceOwner = resource.user_id === userId;
    let canModify = isResourceOwner;
    
    if (!canModify && resource.organization_id) {
      const membership = await getOrgMembership(userId, resource.organization_id);
      canModify = membership?.role === 'owner' || membership?.role === 'admin';
    }
    
    if (!canModify) {
      return res.status(403).json({ error: 'Access denied. Only resource owner or org admins can modify permissions.' });
    }
    
    // Upsert permission
    const existingPerm = await queryOne<{ id: string }>(
      'SELECT id FROM resource_permissions WHERE resource_type = $1 AND resource_id = $2',
      [resourceType, resourceId]
    );
    
    if (existingPerm) {
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;
      
      if (visibility) {
        updates.push(`visibility = $${paramIndex++}`);
        values.push(visibility);
      }
      if (min_role) {
        updates.push(`min_role = $${paramIndex++}`);
        values.push(min_role);
      }
      
      if (updates.length > 0) {
        values.push(existingPerm.id);
        await execute(
          `UPDATE resource_permissions SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
          values
        );
      }
    } else {
      // Create new permission record
      const permId = randomUUID();
      await execute(
        `INSERT INTO resource_permissions (id, resource_type, resource_id, organization_id, visibility, min_role)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [permId, resourceType, resourceId, resource.organization_id, visibility || 'org', min_role || 'member']
      );
    }
    
    res.json({
      visibility: visibility || 'org',
      min_role: min_role || 'member',
      message: 'Permissions updated',
    });
  } catch (error) {
    console.error('Error updating resource permissions:', error);
    res.status(500).json({ error: 'Failed to update permissions' });
  }
});

export default router;
