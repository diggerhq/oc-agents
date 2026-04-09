import { queryOne } from '../db/index.js';
import { getOrgMembership, canAccessResource as checkResourceAccess } from '../middleware/orgAuth.js';
import type { Session, OrgRole } from '../types/index.js';

/**
 * Check if user can read a resource (view access)
 * - Owner can always read
 * - Org members can read if visibility allows
 */
export async function canRead(
  userId: string,
  resourceType: string,
  resourceId: string,
  resourceUserId?: string,
  resourceOrgId?: string
): Promise<boolean> {
  // Owner can always read
  if (resourceUserId && resourceUserId === userId) {
    return true;
  }
  
  // Check org access
  if (resourceOrgId) {
    return checkResourceAccess(userId, resourceType, resourceId);
  }
  
  return false;
}

/**
 * Check if user can write to a resource (edit access)
 * - Owner can always write
 * - Org admins/owners can write
 * - Members can write if visibility is 'org'
 */
export async function canWrite(
  userId: string,
  resourceType: string,
  resourceId: string,
  resourceUserId?: string,
  resourceOrgId?: string
): Promise<boolean> {
  // Owner can always write
  if (resourceUserId && resourceUserId === userId) {
    return true;
  }
  
  // Check org access - need at least member role
  if (resourceOrgId) {
    const membership = await getOrgMembership(userId, resourceOrgId);
    if (!membership) return false;
    
    // Admins and owners can always write
    if (membership.role === 'owner' || membership.role === 'admin') {
      return true;
    }
    
    // Members can write if visibility is 'org'
    return checkResourceAccess(userId, resourceType, resourceId);
  }
  
  return false;
}

/**
 * Check if user can delete a resource (admin access)
 * - Owner can always delete
 * - Org admins/owners can delete
 */
export async function canDelete(
  userId: string,
  resourceType: string,
  resourceId: string,
  resourceUserId?: string,
  resourceOrgId?: string
): Promise<boolean> {
  // Owner can always delete
  if (resourceUserId && resourceUserId === userId) {
    return true;
  }
  
  // Only org admins and owners can delete
  if (resourceOrgId) {
    const membership = await getOrgMembership(userId, resourceOrgId);
    return membership?.role === 'owner' || membership?.role === 'admin';
  }
  
  return false;
}

/**
 * Get session with access check
 * Returns null if session not found or user doesn't have access
 */
export async function getSessionWithAccess(
  sessionId: string,
  userId: string,
  requireWrite: boolean = false
): Promise<Session | null> {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1',
    [sessionId]
  );
  
  if (!session) return null;
  
  const hasAccess = requireWrite
    ? await canWrite(userId, 'session', sessionId, session.user_id, session.organization_id)
    : await canRead(userId, 'session', sessionId, session.user_id, session.organization_id);
  
  return hasAccess ? session : null;
}

/**
 * Generic resource access check for any table
 */
export async function getResourceWithAccess<T extends { user_id: string; organization_id?: string }>(
  tableName: string,
  resourceId: string,
  userId: string,
  resourceType: string,
  requireWrite: boolean = false
): Promise<T | null> {
  const resource = await queryOne<T>(
    `SELECT * FROM ${tableName} WHERE id = $1`,
    [resourceId]
  );
  
  if (!resource) return null;
  
  const hasAccess = requireWrite
    ? await canWrite(userId, resourceType, resourceId, resource.user_id, resource.organization_id)
    : await canRead(userId, resourceType, resourceId, resource.user_id, resource.organization_id);
  
  return hasAccess ? resource : null;
}
