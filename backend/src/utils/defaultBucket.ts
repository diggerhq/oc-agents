import { v4 as uuidv4 } from 'uuid';
import { execute, queryOne } from '../db/index.js';

export const DEFAULT_BUCKET_NAME = 'Files';

interface Bucket {
  id: string;
  user_id: string;
  organization_id: string | null;
  name: string;
}

/**
 * Create the default "Files" bucket for an organization
 * This bucket is created automatically for every org and is attached to all agents by default
 */
export async function createDefaultBucket(userId: string, organizationId: string | null): Promise<string> {
  // Check if default bucket already exists for this org
  const existing = await queryOne<Bucket>(
    `SELECT id FROM buckets 
     WHERE organization_id IS NOT DISTINCT FROM $1 
     AND user_id = $2 
     AND name = $3`,
    [organizationId, userId, DEFAULT_BUCKET_NAME]
  );
  
  if (existing) {
    return existing.id;
  }
  
  const bucketId = uuidv4();
  
  await execute(
    `INSERT INTO buckets (id, user_id, organization_id, name, description)
     VALUES ($1, $2, $3, $4, $5)`,
    [bucketId, userId, organizationId, DEFAULT_BUCKET_NAME, 'Default file bucket for all agents']
  );
  
  console.log(`[DefaultBucket] Created default bucket "${DEFAULT_BUCKET_NAME}" for org ${organizationId || 'personal'}`);
  
  return bucketId;
}

/**
 * Get the default bucket ID for an organization
 */
export async function getDefaultBucketId(userId: string, organizationId: string | null): Promise<string | null> {
  const bucket = await queryOne<Bucket>(
    `SELECT id FROM buckets 
     WHERE organization_id IS NOT DISTINCT FROM $1 
     AND name = $2`,
    [organizationId, DEFAULT_BUCKET_NAME]
  );
  
  return bucket?.id || null;
}

/**
 * Attach the default bucket to an agent/session
 * This is called automatically when a new TASK agent is created
 * Code agents have repos attached, so they don't need the default file bucket
 * For portal agents, the default bucket is attached as read-only (input)
 */
export async function attachDefaultBucketToSession(
  sessionId: string, 
  userId: string, 
  organizationId: string | null,
  agentType: 'code' | 'task' | 'portal' = 'task'
): Promise<void> {
  // Only attach default bucket to task and portal agents - code agents have repos
  if (agentType === 'code') {
    console.log(`[DefaultBucket] Skipping default bucket for code agent ${sessionId} (has repo)`);
    return;
  }
  
  // First get or create the default bucket
  let bucketId = await getDefaultBucketId(userId, organizationId);
  
  if (!bucketId) {
    // Create the default bucket if it doesn't exist
    bucketId = await createDefaultBucket(userId, organizationId);
  }
  
  // Check if already attached
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM agent_buckets WHERE session_id = $1 AND bucket_id = $2`,
    [sessionId, bucketId]
  );
  
  if (existing) {
    return; // Already attached
  }
  
  const attachmentId = uuidv4();
  
  // Portal agents: attach default bucket as read-only (input bucket)
  // Task agents: attach default bucket as writable
  const readOnly = agentType === 'portal';
  
  await execute(
    `INSERT INTO agent_buckets (id, session_id, bucket_id, mount_path, read_only)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(session_id, bucket_id) DO NOTHING`,
    [attachmentId, sessionId, bucketId, '/home/user/workspace/files', readOnly]
  );
  
  console.log(`[DefaultBucket] Attached default bucket to ${agentType} agent ${sessionId} (read_only: ${readOnly})`);
}
