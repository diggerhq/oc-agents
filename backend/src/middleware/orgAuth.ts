import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { queryOne, query, execute } from '../db/index.js';
import { Organization, OrganizationMember, OrgRole, ResourcePermission } from '../types/index.js';

// Role hierarchy: owner > admin > member
export const ROLE_HIERARCHY: Record<OrgRole, number> = {
  'owner': 3,
  'admin': 2,
  'member': 1,
};

/**
 * Build a SQL WHERE clause fragment for visibility-based filtering
 * Returns { clause: string, params: any[] } where clause uses numbered placeholders starting at startIndex
 * 
 * Usage example:
 *   const filter = buildVisibilityFilter('s', 'session', userId, userRoleLevel, 3);
 *   // filter.clause = "AND (rp.id IS NULL OR rp.visibility = 'org' OR ...)"
 *   // filter.params = [userId, userRoleLevel]
 *   
 *   SELECT s.* FROM sessions s 
 *   LEFT JOIN resource_permissions rp ON rp.resource_type = $1 AND rp.resource_id = s.id
 *   WHERE s.organization_id = $2 ${filter.clause}
 */
export function buildVisibilityFilter(
  tableAlias: string,
  resourceType: string,
  userId: string,
  userRoleLevel: number,
  startParamIndex: number
): { clause: string; params: unknown[] } {
  const userIdParam = `$${startParamIndex}`;
  const roleLevelParam = `$${startParamIndex + 1}`;
  
  const clause = `
    AND (
      -- No permission record = default 'org' visibility (all members see)
      rp.id IS NULL
      -- Explicitly 'org' visibility = all members see
      OR rp.visibility = 'org'
      -- 'private' visibility = only creator sees
      OR (rp.visibility = 'private' AND ${tableAlias}.user_id = ${userIdParam})
      -- 'role' visibility = check role hierarchy
      OR (rp.visibility = 'role' AND ${roleLevelParam} >= CASE rp.min_role 
        WHEN 'owner' THEN 3 
        WHEN 'admin' THEN 2 
        WHEN 'member' THEN 1 
        ELSE 1 
      END)
    )`;
    
  return { clause, params: [userId, userRoleLevel] };
}

// Valid table names for resource queries (prevents SQL injection)
const VALID_RESOURCE_TABLES: Record<string, string> = {
  'session': 'sessions',
  'agent': 'sessions',
  'workflow': 'workflows',
  'bucket': 'buckets',
  'knowledge_base': 'knowledge_bases',
  'integration': 'integrations',
  'schedule': 'schedules',
  'skill': 'skills',
  'api_key': 'api_keys',
} as const;

/**
 * Get user's membership in an organization
 */
export async function getOrgMembership(
  userId: string,
  organizationId: string
): Promise<OrganizationMember | null> {
  const result = await queryOne<OrganizationMember>(
    'SELECT * FROM organization_members WHERE user_id = $1 AND organization_id = $2',
    [userId, organizationId]
  );
  return result ?? null;
}

/**
 * Get user's role in an organization
 */
export async function getUserOrgRole(
  userId: string,
  organizationId: string
): Promise<OrgRole | null> {
  const membership = await getOrgMembership(userId, organizationId);
  return membership?.role || null;
}

/**
 * Check if user has at least the minimum role in an organization
 */
export async function hasMinimumRole(
  userId: string,
  organizationId: string,
  minRole: OrgRole
): Promise<boolean> {
  const userRole = await getUserOrgRole(userId, organizationId);
  if (!userRole) return false;
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minRole];
}

/**
 * Get all organizations a user belongs to
 */
export async function getUserOrganizations(userId: string): Promise<(Organization & { role: OrgRole })[]> {
  return query<Organization & { role: OrgRole }>(
    `SELECT o.*, om.role 
     FROM organizations o
     JOIN organization_members om ON o.id = om.organization_id
     WHERE om.user_id = $1
     ORDER BY o.is_personal DESC, o.name ASC`,
    [userId]
  );
}

/**
 * Get user's personal organization (creates one if it doesn't exist)
 */
export async function getOrCreatePersonalOrg(userId: string, email: string): Promise<Organization> {
  // Try to find existing personal org
  const existingOrg = await queryOne<Organization>(
    'SELECT * FROM organizations WHERE owner_id = $1 AND is_personal = $2',
    [userId, true]
  );
  
  if (existingOrg) {
    return existingOrg;
  }
  
  // Create personal org if it doesn't exist (safety net for existing users)
  const orgId = randomUUID();
  const memberId = randomUUID();
  const now = new Date().toISOString();
  const name = `${email.split('@')[0]}'s Workspace`;
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
 * Get the organization for a resource
 */
export async function getResourceOrganization(
  resourceType: string,
  resourceId: string
): Promise<string | null> {
  // Use validated table name to prevent SQL injection
  const tableName = VALID_RESOURCE_TABLES[resourceType];
  if (!tableName) return null;
  
  const row = await queryOne<{ organization_id: string }>(
    `SELECT organization_id FROM ${tableName} WHERE id = $1`,
    [resourceId]
  );
  
  return row?.organization_id || null;
}

/**
 * Check if a user can access a specific resource
 */
export async function canAccessResource(
  userId: string,
  resourceType: string,
  resourceId: string
): Promise<boolean> {
  const orgId = await getResourceOrganization(resourceType, resourceId);
  if (!orgId) return false;
  
  // Check if user is a member of the organization
  const membership = await getOrgMembership(userId, orgId);
  if (!membership) return false;
  
  // Check resource-specific permissions
  const permission = await queryOne<ResourcePermission>(
    'SELECT * FROM resource_permissions WHERE resource_type = $1 AND resource_id = $2',
    [resourceType, resourceId]
  );
  
  // If no specific permission set, default to org-visible (all members can access)
  if (!permission || permission.visibility === 'org') {
    return true;
  }
  
  // Private resources are only accessible to the owner
  if (permission.visibility === 'private') {
    // Check if user created the resource (use validated table name)
    const tableName = VALID_RESOURCE_TABLES[resourceType];
    if (!tableName) return false;
    
    const row = await queryOne<{ user_id: string }>(
      `SELECT user_id FROM ${tableName} WHERE id = $1`,
      [resourceId]
    );
    return row?.user_id === userId;
  }
  
  // Role-based visibility
  if (permission.visibility === 'role') {
    return ROLE_HIERARCHY[membership.role] >= ROLE_HIERARCHY[permission.min_role];
  }
  
  return false;
}

/**
 * Middleware to require org membership
 * Expects organizationId in req.params.orgId or req.body.organization_id or req.session.currentOrgId
 */
export function requireOrgMembership(orgIdParam: string = 'orgId') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const orgId = req.params[orgIdParam] || req.body.organization_id || req.session.currentOrgId;
    if (!orgId) {
      return res.status(400).json({ error: 'Organization ID required' });
    }
    
    const membership = await getOrgMembership(userId, orgId);
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this organization' });
    }
    
    // Attach org info to request
    (req as any).orgMembership = membership;
    (req as any).organizationId = orgId;
    
    next();
  };
}

/**
 * Middleware to require a minimum role in the organization
 */
export function requireOrgRole(minRole: OrgRole, orgIdParam: string = 'orgId') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const orgId = req.params[orgIdParam] || req.body.organization_id || req.session.currentOrgId;
    if (!orgId) {
      return res.status(400).json({ error: 'Organization ID required' });
    }
    
    const membership = await getOrgMembership(userId, orgId);
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this organization' });
    }
    
    if (ROLE_HIERARCHY[membership.role] < ROLE_HIERARCHY[minRole]) {
      return res.status(403).json({ 
        error: `Requires ${minRole} role or higher`,
        your_role: membership.role 
      });
    }
    
    // Attach org info to request
    (req as any).orgMembership = membership;
    (req as any).organizationId = orgId;
    
    next();
  };
}

/**
 * Middleware to set the current organization context from header or session
 */
export function setOrgContext() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.session.userId;
    if (!userId) {
      return next();
    }
    
    // Check for org ID in header first, then session
    const orgId = req.headers['x-organization-id'] as string || req.session.currentOrgId;
    
    if (orgId) {
      // Verify user is a member
      const membership = await getOrgMembership(userId, orgId);
      if (membership) {
        (req as any).organizationId = orgId;
        (req as any).orgMembership = membership;
      }
    } else {
      // Default to personal org
      const personalOrg = await queryOne<Organization>(
        'SELECT * FROM organizations WHERE owner_id = $1 AND is_personal = $2',
        [userId, true]
      );
      if (personalOrg) {
        (req as any).organizationId = personalOrg.id;
        (req as any).orgMembership = {
          organization_id: personalOrg.id,
          user_id: userId,
          role: 'owner' as OrgRole,
        };
      }
    }
    
    next();
  };
}

/**
 * Helper to generate a slug from a name
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/**
 * Generate a unique slug by appending a suffix if needed
 */
export async function generateUniqueSlug(baseName: string): Promise<string> {
  let slug = generateSlug(baseName);
  let suffix = 0;
  
  while (true) {
    const candidateSlug = suffix === 0 ? slug : `${slug}-${suffix}`;
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM organizations WHERE slug = $1',
      [candidateSlug]
    );
    
    if (!existing) {
      return candidateSlug;
    }
    
    suffix++;
    if (suffix > 100) {
      // Fallback to random suffix
      return `${slug}-${Date.now().toString(36)}`;
    }
  }
}
