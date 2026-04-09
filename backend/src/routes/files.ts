import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';
import { query, queryOne, execute } from '../db/index.js';
import { canRead, canWrite, canDelete } from '../utils/resourceAccess.js';
import { getUserOrgRole, ROLE_HIERARCHY } from '../middleware/orgAuth.js';
import type { Bucket, FileRecord, AgentBucket, OrgRole } from '../types/index.js';
import multer from 'multer';
import { 
  generateStorageKey, 
  uploadToR2, 
  downloadFromR2, 
  streamDownloadFromR2,
  streamUploadToR2,
  deleteFromR2,
  deleteMultipleFromR2,
  getStorageProvider,
  getStorageInfo,
  isStorageConfiguredForUser,
} from '../services/storage.js';
import { Readable } from 'stream';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  createBucketFromRepo,
  syncBucketRepo,
  getBucketRepoForBucket,
  getUserBucketRepos,
  commitAndPushFile,
  checkSyncStatus,
} from '../services/bucketRepo.js';
import type { BucketRepo } from '../types/index.js';
import { withConstraintHandling, isForeignKeyViolation, handleForeignKeyError } from '../utils/dbErrors.js';

const router = Router();

// Configure multer for file uploads - use disk storage to avoid memory pressure
// Files are streamed to temp disk, then streamed to R2, then cleaned up
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, cb) => {
      // Use unique filename to avoid collisions
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
      cb(null, `upload-${uniqueSuffix}-${file.originalname}`);
    },
  }),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max per file
    files: 1000, // Max 1000 files per upload request
  },
});

// ============================================
// BUCKET ROUTES
// ============================================

// Helper to normalize bucket BIGINT fields to numbers (pg returns BIGINT as strings)
function normalizeBucket(bucket: Bucket): Bucket {
  return {
    ...bucket,
    storage_used: Number(bucket.storage_used) || 0,
    storage_limit: Number(bucket.storage_limit) || 0,
  };
}

// List all buckets for the user's current organization, filtered by visibility
router.get('/buckets', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const orgId = (req as any).organizationId;
  
  if (!orgId) {
    // Fall back to user's own buckets (no org context), include repo info
    const buckets = await query<Bucket & { repo_url?: string; repo_branch?: string; sync_status?: string; sync_progress?: any; last_synced_at?: string }>(
      `SELECT b.*, br.repo_url, br.repo_branch, br.sync_status, br.sync_progress, br.last_synced_at
       FROM buckets b
       LEFT JOIN bucket_repos br ON br.bucket_id = b.id
       WHERE b.user_id = $1 
       ORDER BY b.created_at DESC`,
      [userId]
    );
    return res.json({ buckets: buckets.map(normalizeBucket) });
  }
  
  // Get user's role in the org
  const userRole = await getUserOrgRole(userId, orgId);
  if (!userRole) {
    return res.json({ buckets: [] });
  }
  const userRoleLevel = ROLE_HIERARCHY[userRole];
  
  // Check if this is a personal org (legacy resources only show in personal org)
  const org = await queryOne<{ is_personal: boolean }>('SELECT is_personal FROM organizations WHERE id = $1', [orgId]);
  const isPersonalOrg = org?.is_personal === true;
  
  // Query buckets with visibility filtering and include repo info
  // Legacy resources (no org_id) only show in personal org
  const buckets = await query<Bucket & { repo_url?: string; repo_branch?: string; sync_status?: string; sync_progress?: any; last_synced_at?: string }>(
    `SELECT b.*, br.repo_url, br.repo_branch, br.sync_status, br.sync_progress, br.last_synced_at
     FROM buckets b 
     LEFT JOIN resource_permissions rp ON rp.resource_type = 'bucket' AND rp.resource_id = b.id
     LEFT JOIN bucket_repos br ON br.bucket_id = b.id
     WHERE (
       b.organization_id = $1 
       OR ($4 = true AND b.organization_id IS NULL AND b.user_id = $2)
     )
       AND (
         rp.id IS NULL
         OR rp.visibility = 'org'
         OR (rp.visibility = 'private' AND b.user_id = $2)
         OR (rp.visibility = 'role' AND $3 >= CASE rp.min_role 
           WHEN 'owner' THEN 3 
           WHEN 'admin' THEN 2 
           WHEN 'member' THEN 1 
           ELSE 1 
         END)
       )
     ORDER BY b.created_at DESC`,
    [orgId, userId, userRoleLevel, isPersonalOrg]
  );
  
  res.json({ buckets: buckets.map(normalizeBucket) });
});

// Get a specific bucket
router.get('/buckets/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { id } = req.params;
  
  const bucket = await queryOne<Bucket>(
    `SELECT * FROM buckets WHERE id = $1`,
    [id]
  );
  
  if (!bucket) {
    return res.status(404).json({ error: 'Bucket not found' });
  }
  
  // Check access
  const hasAccess = await canRead(userId, 'bucket', id, bucket.user_id, bucket.organization_id);
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  res.json({ bucket: normalizeBucket(bucket) });
});

// Create a new bucket
router.post('/buckets', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;
    const orgId = (req as any).organizationId;
    const { name, description } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    // Check if bucket with same name exists for this user in this org
    // The constraint is UNIQUE(organization_id, user_id, name)
    const existing = await queryOne<Bucket>(
      `SELECT id FROM buckets WHERE organization_id IS NOT DISTINCT FROM $1 AND user_id = $2 AND name = $3`,
      [orgId || null, userId, name]
    );
    
    if (existing) {
      return res.status(409).json({ 
        error: 'A file bucket with this name already exists. Please choose a different name.',
        code: 'DUPLICATE_RESOURCE',
        field: 'name'
      });
    }
    
    const id = uuidv4();
    
    // Wrap in constraint handling for race conditions
    await withConstraintHandling(async () => {
      await execute(
        `INSERT INTO buckets (id, user_id, organization_id, name, description) VALUES ($1, $2, $3, $4, $5)`,
        [id, userId, orgId || null, name, description || null]
      );
    }, 'file bucket');
    
    const bucket = await queryOne<Bucket>(
      `SELECT * FROM buckets WHERE id = $1`,
      [id]
    );
    
    res.status(201).json({ bucket: bucket ? normalizeBucket(bucket) : null });
  } catch (error: any) {
    if (error.code === 'DUPLICATE_RESOURCE') {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        field: error.field
      });
    }
    console.error('Error creating bucket:', error);
    res.status(500).json({ error: 'Failed to create file bucket' });
  }
});

// Update a bucket
router.patch('/buckets/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { id } = req.params;
  const { name, description } = req.body;
  
  const bucket = await queryOne<Bucket>(
    `SELECT * FROM buckets WHERE id = $1`,
    [id]
  );
  
  if (!bucket) {
    return res.status(404).json({ error: 'Bucket not found' });
  }
  
  // Check write access
  const hasAccess = await canWrite(userId, 'bucket', id, bucket.user_id, bucket.organization_id);
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  const updates: string[] = [];
  const values: (string | null)[] = [];
  const setValue = (col: string, val: string | null) => {
    values.push(val);
    updates.push(`${col} = $${values.length}`);
  };
  
  if (name !== undefined) {
    setValue('name', name);
  }
  if (description !== undefined) {
    setValue('description', description || null);
  }
  
  if (updates.length > 0) {
    updates.push('updated_at = NOW()');
    values.push(id);
    await execute(
      `UPDATE buckets SET ${updates.join(', ')} WHERE id = $${values.length}`,
      values
    );
  }
  
  const updated = await queryOne<Bucket>(
    `SELECT * FROM buckets WHERE id = $1`,
    [id]
  );
  
  res.json({ bucket: updated ? normalizeBucket(updated) : null });
});

// Delete a bucket
router.delete('/buckets/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const { id } = req.params;
    
    const bucket = await queryOne<Bucket>(
      `SELECT * FROM buckets WHERE id = $1`,
      [id]
    );
    
    if (!bucket) {
      return res.status(404).json({ error: 'Bucket not found' });
    }
    
    // Check delete access (admin+ required)
    const hasAccess = await canDelete(userId, 'bucket', id, bucket.user_id, bucket.organization_id);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get all storage keys BEFORE deleting from database
    const files = await query<{ storage_key: string }>(
      `SELECT storage_key FROM files WHERE bucket_id = $1 AND storage_key IS NOT NULL`,
      [id]
    );
    const storageKeys = files.map(f => f.storage_key).filter(Boolean);
    
    // Delete related records first (foreign key constraints)
    try {
      // Delete bucket_repos record if exists
      await execute(`DELETE FROM bucket_repos WHERE bucket_id = $1`, [id]);
    } catch (e) {
      // Table might not exist, ignore
    }
    
    try {
      // Delete agent_buckets associations
      await execute(`DELETE FROM agent_buckets WHERE bucket_id = $1`, [id]);
    } catch (e) {
      // Table might not exist, ignore
    }
    
    try {
      // Delete workflow_buckets associations if exists
      await execute(`DELETE FROM workflow_buckets WHERE bucket_id = $1`, [id]);
    } catch (e) {
      // Table might not exist, ignore
    }
    
    // Delete files from database
    await execute(`DELETE FROM files WHERE bucket_id = $1`, [id]);
    
    // Delete bucket from database (with FK error handling)
    try {
      await execute(`DELETE FROM buckets WHERE id = $1`, [id]);
    } catch (error: any) {
      if (isForeignKeyViolation(error)) {
        const friendlyError = handleForeignKeyError(error, 'file bucket');
        return res.status(409).json({
          error: friendlyError.message,
          code: friendlyError.code,
        });
      }
      throw error;
    }
    
    // Respond immediately - storage cleanup happens in background
    res.json({ success: true });
    
    // Delete files from object storage in the background (fire-and-forget)
    if (storageKeys.length > 0) {
      console.log(`[Files] Deleting ${storageKeys.length} files from storage for bucket ${bucket.name}...`);
      
      // Process in batches of 100 to avoid overwhelming the storage service
      const BATCH_SIZE = 100;
      (async () => {
        try {
          for (let i = 0; i < storageKeys.length; i += BATCH_SIZE) {
            const batch = storageKeys.slice(i, i + BATCH_SIZE);
            await deleteMultipleFromR2(batch, userId);
            
            if (i + BATCH_SIZE < storageKeys.length) {
              console.log(`[Files] Deleted ${Math.min(i + BATCH_SIZE, storageKeys.length)}/${storageKeys.length} files...`);
            }
          }
          console.log(`[Files] Finished deleting ${storageKeys.length} files from storage for bucket ${bucket.name}`);
        } catch (err) {
          console.error(`[Files] Error deleting files from storage:`, err);
        }
      })();
    }
  } catch (error: any) {
    console.error('Error deleting bucket:', error);
    res.status(500).json({ error: 'Failed to delete file bucket' });
  }
});

// ============================================
// REPO-BACKED BUCKET ROUTES
// ============================================

// Create a bucket from a git repository
// Returns immediately with bucket info, cloning happens in background
// Supports three auth methods:
// 1. installation_id - GitHub App installation (preferred for GitHub)
// 2. token - Manual PAT
// 3. Auto-fetch OAuth token if connected
router.post('/buckets/from-repo', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const orgId = (req as any).organizationId;
  const { name, repo_url, branch, token, description, installation_id } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  if (!repo_url) {
    return res.status(400).json({ error: 'Repository URL is required' });
  }
  
  let effectiveToken = token;
  let githubInstallationId: number | undefined;
  
  // If GitHub App installation_id provided, verify ownership and use it
  if (installation_id && repo_url.includes('github.com')) {
    const installation = await queryOne<{ installation_id: number; user_id: string }>(
      'SELECT installation_id, user_id FROM github_app_installations WHERE installation_id = $1 AND user_id = $2',
      [installation_id, userId]
    );
    
    if (!installation) {
      return res.status(403).json({ error: 'GitHub App installation not found or access denied' });
    }
    
    githubInstallationId = installation.installation_id;
    // Token will be generated on-demand in bucketRepo service
    console.log(`[Files] Using GitHub App installation ${installation_id} for repo clone`);
  }
  // Otherwise, fall back to OAuth token or manual token
  else if (!effectiveToken) {
    if (repo_url.includes('gitlab.com')) {
      const user = await queryOne<{ gitlab_access_token?: string }>(
        'SELECT gitlab_access_token FROM users WHERE id = $1',
        [userId]
      );
      if (user?.gitlab_access_token) {
        effectiveToken = user.gitlab_access_token;
        console.log('[Files] Using user GitLab OAuth token for repo clone');
      }
    } else if (repo_url.includes('github.com')) {
      const user = await queryOne<{ github_access_token?: string }>(
        'SELECT github_access_token FROM users WHERE id = $1',
        [userId]
      );
      if (user?.github_access_token) {
        effectiveToken = user.github_access_token;
        console.log('[Files] Using user GitHub OAuth token for repo clone');
      }
    }
  }
  
  // Start the cloning process (runs in background, returns bucket info immediately)
  const result = await createBucketFromRepo(
    userId,
    name,
    repo_url,
    branch || 'main',
    effectiveToken,
    description,
    orgId || null,
    githubInstallationId
  );
  
  if ('error' in result) {
    return res.status(400).json({ error: result.error });
  }
  
  res.status(201).json({ 
    bucket: result.bucket, 
    bucketRepo: result.bucketRepo 
  });
});

// Get repo info for a bucket (if it's repo-backed)
router.get('/buckets/:id/repo', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { id } = req.params;
  
  const bucketRepo = await getBucketRepoForBucket(id, userId);
  
  if (!bucketRepo) {
    return res.json({ bucketRepo: null });
  }
  
  // Don't expose the token, parse sync_progress JSON
  const { repo_token, sync_progress, ...safeRepo } = bucketRepo;
  
  // Parse sync_progress if it's a string
  let parsedProgress = null;
  if (sync_progress) {
    try {
      parsedProgress = typeof sync_progress === 'string' ? JSON.parse(sync_progress) : sync_progress;
    } catch {
      // Ignore parse errors
    }
  }
  
  res.json({ 
    bucketRepo: {
      ...safeRepo,
      has_token: !!repo_token,
      sync_progress: parsedProgress,
    }
  });
});

// Sync a repo-backed bucket with its remote repository
router.post('/buckets/:id/sync', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { id } = req.params;
  
  // Get the bucket repo
  const bucketRepo = await getBucketRepoForBucket(id, userId);
  
  if (!bucketRepo) {
    return res.status(404).json({ error: 'This bucket is not backed by a repository' });
  }
  
  // If no token is stored, try to update with user's OAuth token
  if (!bucketRepo.repo_token) {
    let oauthToken: string | undefined;
    
    if (bucketRepo.repo_url.includes('gitlab.com')) {
      const user = await queryOne<{ gitlab_access_token?: string }>(
        'SELECT gitlab_access_token FROM users WHERE id = $1',
        [userId]
      );
      oauthToken = user?.gitlab_access_token;
      if (oauthToken) console.log('[Files] Using user GitLab OAuth token for sync');
    } else if (bucketRepo.repo_url.includes('github.com')) {
      const user = await queryOne<{ github_access_token?: string }>(
        'SELECT github_access_token FROM users WHERE id = $1',
        [userId]
      );
      oauthToken = user?.github_access_token;
      if (oauthToken) console.log('[Files] Using user GitHub OAuth token for sync');
    }
    
    if (oauthToken) {
      const { encrypt } = await import('../utils/encryption.js');
      const encryptedToken = encrypt(oauthToken);
      await execute(
        'UPDATE bucket_repos SET repo_token = $1, updated_at = NOW() WHERE id = $2',
        [encryptedToken, bucketRepo.id]
      );
    }
  }
  
  // Start sync in background
  syncBucketRepo(bucketRepo.id, userId).catch(err => {
    console.error('[Files] Background sync error:', err);
  });
  
  res.json({ success: true, message: 'Sync started' });
});

// Check if a repo-backed bucket needs to be synced
router.get('/buckets/:id/sync-status', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { id } = req.params;
  
  const result = await checkSyncStatus(id, userId);
  
  res.json(result);
});

// Commit and push a file change to the repo
router.post('/buckets/:id/commit-push', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { id } = req.params;
  const { file_id, file_path, content, commit_message } = req.body;
  
  if (!file_path && !file_id) {
    return res.status(400).json({ error: 'file_path or file_id is required' });
  }
  
  if (content === undefined) {
    return res.status(400).json({ error: 'content is required' });
  }
  
  // Get the bucket repo
  const bucketRepo = await getBucketRepoForBucket(id, userId);
  
  if (!bucketRepo) {
    return res.status(404).json({ error: 'This bucket is not backed by a repository' });
  }
  
  // Determine file path
  let finalPath = file_path;
  if (file_id && !file_path) {
    const file = await queryOne<{ path: string }>('SELECT path FROM files WHERE id = $1', [file_id]);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    finalPath = file.path;
  }
  
  const message = commit_message || `Update ${finalPath}`;
  
  const result = await commitAndPushFile(bucketRepo.id, userId, finalPath, content, message);
  
  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }
  
  res.json({ 
    success: true, 
    sha: result.sha,
    message: `Pushed changes to ${bucketRepo.repo_branch}` 
  });
});

// List all repo-backed buckets for the user
router.get('/repos', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  
  const repos = await getUserBucketRepos(userId);
  
  // Don't expose tokens
  const safeRepos = repos.map(({ repo_token, ...repo }) => ({
    ...repo,
    has_token: !!repo_token,
  }));
  
  res.json({ repos: safeRepos });
});

// ============================================
// FILE ROUTES
// ============================================

// List files in a bucket (with pagination, folder support, and search)
router.get('/buckets/:bucketId/files', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { bucketId } = req.params;
  const { path = '/', limit = '50', offset = '0', search = '' } = req.query;
  const searchTerm = (search as string).trim();
  
  // Verify bucket belongs to user
  const bucket = await queryOne<Bucket>(
    `SELECT * FROM buckets WHERE id = $1 AND user_id = $2`,
    [bucketId, userId]
  );
  
  if (!bucket) {
    return res.status(404).json({ error: 'Bucket not found' });
  }
  
  // If searching, search across ALL files in bucket (ignoring folder structure)
  if (searchTerm) {
    const searchPattern = `%${searchTerm}%`;
    
    const files = await query<FileRecord>(
      `SELECT id, bucket_id, name, path, parent_id, is_folder, mime_type, size, storage_key, created_at, updated_at
       FROM files 
       WHERE bucket_id = $1 AND name LIKE $2
       ORDER BY is_folder DESC, name ASC
       LIMIT $3 OFFSET $4`,
      [bucketId, searchPattern, parseInt(limit as string), parseInt(offset as string)]
    );
    
    const countResult = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM files WHERE bucket_id = $1 AND name LIKE $2`,
      [bucketId, searchPattern]
    );
    
    return res.json({
      files: files.map(f => ({
        ...f,
        is_folder: f.is_folder === true || f.is_folder === 1,
        size: Number(f.size) || 0,  // Normalize BIGINT
        storage_key: undefined,
      })),
      total: Number(countResult?.count) || 0,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
      path: '/', // Search ignores path
      bucket: normalizeBucket(bucket),
      storage: getStorageProvider(),
      search: searchTerm,
    });
  }
  
  // Get parent folder if not root
  let parentId: string | null = null;
  if (path !== '/') {
    const parent = await queryOne<FileRecord>(
      `SELECT id FROM files WHERE bucket_id = $1 AND path = $2 AND is_folder = $3`,
      [bucketId, path, true]
    );
    parentId = parent?.id || null;
  }
  
  // Get files in this folder
  const files = parentId
    ? await query<FileRecord>(
        `SELECT id, bucket_id, name, path, parent_id, is_folder, mime_type, size, storage_key, created_at, updated_at
         FROM files 
         WHERE bucket_id = $1 AND parent_id = $2
         ORDER BY is_folder DESC, name ASC
         LIMIT $3 OFFSET $4`,
        [bucketId, parentId, parseInt(limit as string), parseInt(offset as string)]
      )
    : await query<FileRecord>(
        `SELECT id, bucket_id, name, path, parent_id, is_folder, mime_type, size, storage_key, created_at, updated_at
         FROM files 
         WHERE bucket_id = $1 AND parent_id IS NULL
         ORDER BY is_folder DESC, name ASC
         LIMIT $2 OFFSET $3`,
        [bucketId, parseInt(limit as string), parseInt(offset as string)]
      );
  
  // Get total count
  const countResult = parentId
    ? await queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM files 
         WHERE bucket_id = $1 AND parent_id = $2`,
        [bucketId, parentId]
      )
    : await queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM files 
         WHERE bucket_id = $1 AND parent_id IS NULL`,
        [bucketId]
      );
  
  res.json({
    files: files.map(f => ({
      ...f,
      is_folder: f.is_folder === true || f.is_folder === 1,
      size: Number(f.size) || 0,  // Normalize BIGINT
      // Don't expose storage_key to frontend
      storage_key: undefined,
    })),
    total: Number(countResult?.count) || 0,
    limit: parseInt(limit as string),
    offset: parseInt(offset as string),
    path,
    bucket: normalizeBucket(bucket),
    storage: getStorageProvider(),
  });
});

// Create a folder
router.post('/buckets/:bucketId/folders', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { bucketId } = req.params;
  const { name, parentPath = '/' } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Folder name is required' });
  }
  
  // Verify bucket belongs to user
  const bucket = await queryOne<Bucket>(
    `SELECT * FROM buckets WHERE id = $1 AND user_id = $2`,
    [bucketId, userId]
  );
  
  if (!bucket) {
    return res.status(404).json({ error: 'Bucket not found' });
  }
  
  // Get parent folder if not root
  let parentId: string | null = null;
  if (parentPath !== '/') {
    const parent = await queryOne<FileRecord>(
      `SELECT id FROM files WHERE bucket_id = $1 AND path = $2 AND is_folder = $3`,
      [bucketId, parentPath, true]
    );
    parentId = parent?.id || null;
  }
  
  // Build the full path
  const fullPath = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`;
  
  // Check if folder already exists
  const existing = await queryOne<FileRecord>(
    `SELECT id FROM files WHERE bucket_id = $1 AND path = $2`,
    [bucketId, fullPath]
  );
  
  if (existing) {
    return res.status(400).json({ error: 'A folder with this name already exists' });
  }
  
  const id = uuidv4();
  
  await execute(
    `INSERT INTO files (id, bucket_id, user_id, name, path, parent_id, is_folder) 
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, bucketId, userId, name, fullPath, parentId, true]
  );
  
  const folder = await queryOne<FileRecord>(
    `SELECT * FROM files WHERE id = $1`,
    [id]
  );
  
  res.status(201).json({ 
    file: {
      ...folder,
      is_folder: true,
    }
  });
});

// Upload file(s) - uses streaming to avoid memory pressure
router.post('/buckets/:bucketId/upload', requireAuth, upload.array('files', 1000), async (req: Request, res: Response) => {
  const userId = req.session.userId!;  // requireAuth ensures this exists
  const { bucketId } = req.params;
  const { parentPath = '/', relativePaths: relativePathsJson } = req.body;
  const uploadedFiles = req.files as Express.Multer.File[];
  
  // Track temp files for cleanup
  const tempFilePaths: string[] = [];
  
  // Cleanup function to remove temp files
  const cleanup = () => {
    for (const tempPath of tempFilePaths) {
      fs.unlink(tempPath, () => {}); // Fire and forget
    }
  };
  
  try {
    if (!uploadedFiles || uploadedFiles.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }
    
    // Track temp files for cleanup
    for (const file of uploadedFiles) {
      if (file.path) tempFilePaths.push(file.path);
    }
    
    // Parse relative paths (for folder uploads)
    let relativePaths: string[] = [];
    try {
      relativePaths = relativePathsJson ? JSON.parse(relativePathsJson) : [];
    } catch {
      // Ignore parse errors, use filenames
    }
    
    // Verify bucket belongs to user
    const bucket = await queryOne<Bucket>(
      `SELECT * FROM buckets WHERE id = $1 AND user_id = $2`,
      [bucketId, userId]
    );
    
    if (!bucket) {
      cleanup();
      return res.status(404).json({ error: 'Bucket not found' });
    }
    
    // Object storage is REQUIRED for file uploads (scalable s3fs mounting)
    const hasObjectStorage = await isStorageConfiguredForUser(userId);
    
    if (!hasObjectStorage) {
      cleanup();
      return res.status(400).json({ 
        error: 'Object storage required. Please configure S3 or R2 storage in Settings before uploading files.',
        code: 'STORAGE_NOT_CONFIGURED'
      });
    }
    
    // Helper to ensure a folder path exists, returns the folder's ID
    const ensureFolderPath = async (folderPath: string): Promise<string | null> => {
      if (folderPath === '/' || folderPath === '') return null;
      
      // Check if folder already exists
      const existing = await queryOne<FileRecord>(
        `SELECT id FROM files WHERE bucket_id = $1 AND path = $2 AND is_folder = $3`,
        [bucketId, folderPath, true]
      );
      if (existing) return existing.id;
      
      // Need to create the folder - first ensure parent exists
      const parts = folderPath.split('/').filter(Boolean);
      const folderName = parts.pop()!;
      const parentFolderPath = parts.length === 0 ? '/' : '/' + parts.join('/');
      
      const parentFolderId = await ensureFolderPath(parentFolderPath);
      
      // Create this folder
      const folderId = uuidv4();
      await execute(
        `INSERT INTO files (id, bucket_id, user_id, name, path, parent_id, is_folder, size)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0)`,
        [folderId, bucketId, userId, folderName, folderPath, parentFolderId, true]
      );
      
      return folderId;
    };
    
    const savedFiles: FileRecord[] = [];
    let totalSize = 0;
    const friendlyNameErrors: Array<{ filename: string; error: string }> = [];

    for (let i = 0; i < uploadedFiles.length; i++) {
      const file = uploadedFiles[i];
      const relativePath = relativePaths[i] || file.originalname;
      
      // Parse the relative path to get folder structure
      // e.g., "folder/subfolder/file.txt" -> folder structure + filename
      const pathParts = relativePath.split('/').filter(Boolean);
      const fileName = pathParts.pop() || file.originalname;
      
      // Determine the target folder path
      let targetFolderPath: string;
      if (pathParts.length > 0) {
        // Has subfolder structure
        targetFolderPath = parentPath === '/' 
          ? '/' + pathParts.join('/')
          : parentPath + '/' + pathParts.join('/');
      } else {
        targetFolderPath = parentPath;
      }
      
      // Ensure folder structure exists
      const parentId = await ensureFolderPath(targetFolderPath);
      
      // Build full path for the file
      const fullPath = targetFolderPath === '/' ? `/${fileName}` : `${targetFolderPath}/${fileName}`;
      
      const id = uuidv4();
      const isSkillsBucket = bucket.name.includes(' - Skills') || bucket.name.includes('_skills');

      // Handle .skill files (ZIP archives containing SKILL.md) in skills buckets
      let actualFileName = fileName;
      let actualFullPath = fullPath;
      let actualMimeType = file.mimetype;
      let actualSize = file.size;
      let extractedContent: string | null = null;

      if (isSkillsBucket && fileName.endsWith('.skill')) {
        try {
          const zipBuffer = await fs.promises.readFile(file.path);
          const zip = await JSZip.loadAsync(zipBuffer);

          // Look for SKILL.md (case-insensitive, may be in a subdirectory)
          let skillMdFile: JSZip.JSZipObject | null = null;
          let skillMdPath = '';
          zip.forEach((relativePath, zipEntry) => {
            if (!zipEntry.dir && /skill\.md$/i.test(relativePath)) {
              // Prefer root-level SKILL.md, but accept nested
              if (!skillMdFile || relativePath.split('/').length < skillMdPath.split('/').length) {
                skillMdFile = zipEntry;
                skillMdPath = relativePath;
              }
            }
          });

          if (skillMdFile) {
            extractedContent = await (skillMdFile as JSZip.JSZipObject).async('string');
            // Rename to .md for storage
            actualFileName = fileName.replace(/\.skill$/i, '.md');
            actualFullPath = fullPath.replace(/\.skill$/i, '.md');
            actualMimeType = 'text/markdown';
            actualSize = Buffer.byteLength(extractedContent, 'utf-8');
            console.log(`[Files] Extracted SKILL.md from ${fileName} (${skillMdPath}, ${actualSize} bytes)`);
          } else {
            console.warn(`[Files] No SKILL.md found in ${fileName}, storing as-is`);
          }
        } catch (err) {
          console.warn(`[Files] Failed to extract .skill file ${fileName}, storing as-is:`, err);
        }
      }

      // Upload to object storage
      const storageKey = generateStorageKey(userId, bucketId, actualFullPath);
      let uploadResult;
      if (extractedContent !== null) {
        // Upload extracted markdown content
        uploadResult = await uploadToR2(storageKey, Buffer.from(extractedContent, 'utf-8'), actualMimeType, userId);
      } else {
        // Stream upload original file
        const fileStream = fs.createReadStream(file.path);
        uploadResult = await streamUploadToR2(storageKey, fileStream, actualMimeType, userId, actualSize);
      }

      if (!uploadResult.success) {
        console.error(`[Files] Upload failed for ${actualFileName}:`, uploadResult.error);
        cleanup();
        return res.status(500).json({ error: `Failed to upload ${actualFileName}: ${uploadResult.error}` });
      }

      // Store metadata in DB
      await execute(
        `INSERT INTO files (id, bucket_id, user_id, name, path, parent_id, is_folder, mime_type, size, storage_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, bucketId, userId, actualFileName, actualFullPath, parentId, false, actualMimeType, actualSize, storageKey]
      );

      // Generate friendly name for skill files in skills buckets
      if (isSkillsBucket && (actualFileName.endsWith('.md') || actualFileName.endsWith('.mdc') || actualFileName.endsWith('.skill') || actualFileName.endsWith('.txt') || actualFileName.endsWith('.json'))) {
        try {
          const fileContent = extractedContent || await fs.promises.readFile(file.path, 'utf-8');
          const { generateSkillFriendlyName } = await import('../services/skillDetection.js');
          const friendlyName = await generateSkillFriendlyName(actualFileName, fileContent);

          await execute(
            `UPDATE files SET friendly_name = $1 WHERE id = $2`,
            [friendlyName, id]
          );
          console.log(`[Files] Generated friendly name for skill ${actualFileName}: "${friendlyName}"`);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[Files] Failed to generate friendly name for ${actualFileName}:`, err);
          friendlyNameErrors.push({
            filename: actualFileName,
            error: errorMsg
          });
        }
      }

      totalSize += actualSize;

      const saved = await queryOne<FileRecord>(
        `SELECT id, bucket_id, name, path, parent_id, is_folder, mime_type, size, created_at, updated_at, friendly_name FROM files WHERE id = $1`,
        [id]
      );
      if (saved) {
        savedFiles.push({
          ...saved,
          is_folder: false,
        } as FileRecord);
      }
    }
    
    // Update bucket storage used
    await execute(
      `UPDATE buckets SET storage_used = storage_used + $1, updated_at = NOW() WHERE id = $2`,
      [totalSize, bucketId]
    );
    
    // Cleanup temp files
    cleanup();

    res.status(201).json({
      files: savedFiles,
      storage: 'object-storage',
      ...(friendlyNameErrors.length > 0 && { friendlyNameErrors }),
    });
  } catch (error) {
    cleanup();
    throw error;
  }
});

// Download a file - streams directly to response without buffering
router.get('/files/:id/download', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { id } = req.params;
  
  const file = await queryOne<FileRecord>(
    `SELECT f.*, b.user_id as bucket_user_id 
     FROM files f 
     JOIN buckets b ON f.bucket_id = b.id 
     WHERE f.id = $1 AND b.user_id = $2`,
    [id, userId]
  );
  
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  if (file.is_folder === true || file.is_folder === 1) {
    return res.status(400).json({ error: 'Cannot download a folder' });
  }
  
  // All files must have a storage_key (object storage is required)
  if (!file.storage_key) {
    return res.status(404).json({ error: 'File content not available. File may have been uploaded before object storage was required.' });
  }
  
  // Stream download - no memory buffering
  const downloadResult = await streamDownloadFromR2(file.storage_key, userId);
  
  if (!downloadResult.success || !downloadResult.stream) {
    console.error(`[Files] Download failed for ${file.name}:`, downloadResult.error);
    return res.status(500).json({ error: 'Failed to download file from storage' });
  }
  
  res.setHeader('Content-Type', downloadResult.contentType || file.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
  if (downloadResult.contentLength) {
    res.setHeader('Content-Length', downloadResult.contentLength);
  }
  
  // Pipe stream directly to response
  downloadResult.stream.pipe(res);
});

// Get file content as text (for editor)
router.get('/files/:id/content', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { id } = req.params;
  
  const file = await queryOne<FileRecord>(
    `SELECT f.*, b.user_id as bucket_user_id 
     FROM files f 
     JOIN buckets b ON f.bucket_id = b.id 
     WHERE f.id = $1 AND b.user_id = $2`,
    [id, userId]
  );
  
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  if (file.is_folder === true || file.is_folder === 1) {
    return res.status(400).json({ error: 'Cannot get content of a folder' });
  }
  
  if (!file.storage_key) {
    return res.status(404).json({ error: 'File content not available' });
  }
  
  const downloadResult = await downloadFromR2(file.storage_key, userId);
  
  if (!downloadResult.success) {
    console.error(`[Files] Content fetch failed for ${file.name}:`, downloadResult.error);
    return res.status(500).json({ error: 'Failed to fetch file content' });
  }
  
  // Convert buffer to string
  const content = downloadResult.content instanceof Buffer 
    ? downloadResult.content.toString('utf-8')
    : String(downloadResult.content);
  
  res.json({ 
    content,
    file: {
      id: file.id,
      name: file.name,
      path: file.path,
      mime_type: file.mime_type,
      size: file.size,
    }
  });
});

// Update file content (for editor save)
router.put('/files/:id/content', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { id } = req.params;
  const { content } = req.body;
  
  if (content === undefined) {
    return res.status(400).json({ error: 'Content is required' });
  }
  
  const file = await queryOne<FileRecord>(
    `SELECT f.*, b.user_id as bucket_user_id 
     FROM files f 
     JOIN buckets b ON f.bucket_id = b.id 
     WHERE f.id = $1 AND b.user_id = $2`,
    [id, userId]
  );
  
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  if (file.is_folder === true || file.is_folder === 1) {
    return res.status(400).json({ error: 'Cannot update content of a folder' });
  }
  
  if (!file.storage_key) {
    return res.status(400).json({ error: 'File has no storage key' });
  }
  
  // Convert content to buffer
  const buffer = Buffer.from(content, 'utf-8');
  const newSize = buffer.length;
  const oldSize = file.size || 0;
  
  // Upload new content to R2
  const uploadResult = await uploadToR2(
    file.storage_key,
    buffer,
    file.mime_type || 'text/plain',
    userId
  );
  
  if (!uploadResult.success) {
    console.error(`[Files] Content update failed for ${file.name}:`, uploadResult.error);
    return res.status(500).json({ error: 'Failed to save file content' });
  }
  
  // Update file size in database
  await execute(
    `UPDATE files SET size = $1, updated_at = NOW() WHERE id = $2`,
    [newSize, id]
  );
  
  // Update bucket storage if size changed
  const sizeDiff = newSize - oldSize;
  if (sizeDiff !== 0) {
    await execute(
      `UPDATE buckets SET storage_used = storage_used + $1, updated_at = NOW() WHERE id = $2`,
      [sizeDiff, file.bucket_id]
    );
  }
  
  res.json({ 
    success: true,
    file: {
      id: file.id,
      name: file.name,
      path: file.path,
      size: newSize,
    }
  });
});

// ============================================
// STREAMING EDITOR ENDPOINTS (for large files)
// ============================================

const STREAMING_THRESHOLD = 2 * 1024 * 1024; // 2MB

/**
 * Get file metadata with streaming info
 * Returns whether file should use streaming mode
 */
router.get('/files/:id/info', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { id } = req.params;
  
  const file = await queryOne<FileRecord & { line_count: number | null }>(
    `SELECT f.*, b.user_id as bucket_user_id 
     FROM files f 
     JOIN buckets b ON f.bucket_id = b.id 
     WHERE f.id = $1 AND b.user_id = $2`,
    [id, userId]
  );
  
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  const size = Number(file.size) || 0;
  const useStreaming = size >= STREAMING_THRESHOLD;
  
  res.json({
    id: file.id,
    name: file.name,
    path: file.path,
    size,
    line_count: file.line_count,
    mime_type: file.mime_type,
    useStreaming,
    streamingThreshold: STREAMING_THRESHOLD,
  });
});

/**
 * Get a range of lines from a file (for streaming editor)
 * Query params: start (0-indexed), count (number of lines)
 */
router.get('/files/:id/lines', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { id } = req.params;
  const start = parseInt(req.query.start as string) || 0;
  const count = Math.min(parseInt(req.query.count as string) || 200, 1000); // Max 1000 lines per request
  
  const file = await queryOne<FileRecord & { line_count: number | null }>(
    `SELECT f.*, b.user_id as bucket_user_id 
     FROM files f 
     JOIN buckets b ON f.bucket_id = b.id 
     WHERE f.id = $1 AND b.user_id = $2`,
    [id, userId]
  );
  
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  if (file.is_folder === true || file.is_folder === 1) {
    return res.status(400).json({ error: 'Cannot read lines from a folder' });
  }
  
  if (!file.storage_key) {
    return res.status(404).json({ error: 'File content not available' });
  }
  
  const downloadResult = await downloadFromR2(file.storage_key, userId);
  
  if (!downloadResult.success) {
    console.error(`[Files] Lines fetch failed for ${file.name}:`, downloadResult.error);
    return res.status(500).json({ error: 'Failed to fetch file content' });
  }
  
  // Convert buffer to string and split into lines
  const content = downloadResult.content instanceof Buffer 
    ? downloadResult.content.toString('utf-8')
    : String(downloadResult.content);
  
  const allLines = content.split('\n');
  const totalLines = allLines.length;
  
  // Get requested range
  const endIndex = Math.min(start + count, totalLines);
  const lines = allLines.slice(start, endIndex);
  
  res.json({
    lines,
    start,
    count: lines.length,
    totalLines,
    hasMore: endIndex < totalLines,
  });
});

/**
 * Apply a patch to a file (for streaming editor saves)
 * Body: { edits: [{ startLine, deleteCount, insertLines }] }
 * 
 * This allows saving large files without loading the entire content
 * into the frontend. Edits are applied server-side.
 */
router.put('/files/:id/patch', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { id } = req.params;
  const { edits } = req.body as { 
    edits: Array<{ 
      startLine: number; 
      deleteCount: number; 
      insertLines: string[] 
    }> 
  };
  
  if (!edits || !Array.isArray(edits)) {
    return res.status(400).json({ error: 'Edits array is required' });
  }
  
  const file = await queryOne<FileRecord>(
    `SELECT f.*, b.user_id as bucket_user_id 
     FROM files f 
     JOIN buckets b ON f.bucket_id = b.id 
     WHERE f.id = $1 AND b.user_id = $2`,
    [id, userId]
  );
  
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  if (file.is_folder === true || file.is_folder === 1) {
    return res.status(400).json({ error: 'Cannot patch a folder' });
  }
  
  if (!file.storage_key) {
    return res.status(400).json({ error: 'File has no storage key' });
  }
  
  // Download current content
  const downloadResult = await downloadFromR2(file.storage_key, userId);
  
  if (!downloadResult.success) {
    console.error(`[Files] Patch download failed for ${file.name}:`, downloadResult.error);
    return res.status(500).json({ error: 'Failed to fetch file content' });
  }
  
  // Convert to lines
  const content = downloadResult.content instanceof Buffer 
    ? downloadResult.content.toString('utf-8')
    : String(downloadResult.content);
  
  let lines = content.split('\n');
  
  // Apply edits in reverse order (so line numbers remain valid)
  const sortedEdits = [...edits].sort((a, b) => b.startLine - a.startLine);
  
  for (const edit of sortedEdits) {
    const { startLine, deleteCount, insertLines } = edit;
    
    // Validate
    if (startLine < 0 || startLine > lines.length) {
      return res.status(400).json({ error: `Invalid startLine: ${startLine}` });
    }
    
    // Apply splice
    lines.splice(startLine, deleteCount, ...insertLines);
  }
  
  // Rebuild content
  const newContent = lines.join('\n');
  const buffer = Buffer.from(newContent, 'utf-8');
  const newSize = buffer.length;
  const newLineCount = lines.length;
  const oldSize = Number(file.size) || 0;
  
  // Upload patched content
  const uploadResult = await uploadToR2(
    file.storage_key,
    buffer,
    file.mime_type || 'text/plain',
    userId
  );
  
  if (!uploadResult.success) {
    console.error(`[Files] Patch upload failed for ${file.name}:`, uploadResult.error);
    return res.status(500).json({ error: 'Failed to save patched content' });
  }
  
  // Update database
  await execute(
    `UPDATE files SET size = $1, line_count = $2, updated_at = NOW() WHERE id = $3`,
    [newSize, newLineCount, id]
  );
  
  // Update bucket storage if size changed
  const sizeDiff = newSize - oldSize;
  if (sizeDiff !== 0) {
    await execute(
      `UPDATE buckets SET storage_used = storage_used + $1, updated_at = NOW() WHERE id = $2`,
      [sizeDiff, file.bucket_id]
    );
  }
  
  console.log(`[Files] Applied ${edits.length} edits to ${file.name}, new size: ${newSize} bytes, ${newLineCount} lines`);
  
  res.json({ 
    success: true,
    file: {
      id: file.id,
      name: file.name,
      path: file.path,
      size: newSize,
      line_count: newLineCount,
    }
  });
});

// Get file info
router.get('/files/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { id } = req.params;
  
  const file = await queryOne<FileRecord>(
    `SELECT f.id, f.bucket_id, f.name, f.path, f.parent_id, f.is_folder, f.mime_type, f.size, f.created_at, f.updated_at
     FROM files f 
     JOIN buckets b ON f.bucket_id = b.id 
     WHERE f.id = $1 AND b.user_id = $2`,
    [id, userId]
  );
  
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  res.json({ 
    file: {
      ...file,
      is_folder: file.is_folder === true || file.is_folder === 1,
    }
  });
});

// Delete a file or folder
router.delete('/files/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { id } = req.params;
  
  const file = await queryOne<FileRecord>(
    `SELECT f.*, b.user_id as bucket_user_id 
     FROM files f 
     JOIN buckets b ON f.bucket_id = b.id 
     WHERE f.id = $1 AND b.user_id = $2`,
    [id, userId]
  );
  
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Get total size to delete (including children for folders)
  const isFolder = file.is_folder === true || file.is_folder === 1;
  let sizeToRemove = file.size || 0;
  
  if (isFolder) {
    const childrenSize = await queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(size), 0) as total FROM files WHERE path LIKE $1`,
      [`${file.path}/%`]
    );
    sizeToRemove += childrenSize?.total || 0;
    
    // Delete all children from object storage if they have storage keys
    const childFiles = await query<{ storage_key: string }>(
      `SELECT storage_key FROM files WHERE path LIKE $1 AND storage_key IS NOT NULL`,
      [`${file.path}/%`]
    );
    const storageKeys = childFiles.map(f => f.storage_key).filter(Boolean);
    if (storageKeys.length > 0) {
      await deleteMultipleFromR2(storageKeys, userId);
    }
  } else {
    // Delete single file from object storage if it has a storage key
    if (file.storage_key) {
      await deleteFromR2(file.storage_key, userId);
    }
  }
  
  // Delete file/folder from DB
  await execute(`DELETE FROM files WHERE id = $1`, [id]);
  
  // Also delete children if it's a folder
  if (isFolder) {
    await execute(`DELETE FROM files WHERE path LIKE $1`, [`${file.path}/%`]);
  }
  
  // Update bucket storage
  await execute(
    `UPDATE buckets SET storage_used = storage_used - $1, updated_at = NOW() WHERE id = $2`,
    [sizeToRemove, file.bucket_id]
  );
  
  res.json({ success: true });
});

// Rename a file or folder
router.patch('/files/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { id } = req.params;
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  const file = await queryOne<FileRecord>(
    `SELECT f.*, b.user_id as bucket_user_id 
     FROM files f 
     JOIN buckets b ON f.bucket_id = b.id 
     WHERE f.id = $1 AND b.user_id = $2`,
    [id, userId]
  );
  
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Calculate new path
  const pathParts = file.path.split('/');
  pathParts[pathParts.length - 1] = name;
  const newPath = pathParts.join('/');
  
  await execute(
    `UPDATE files SET name = $1, path = $2, updated_at = NOW() WHERE id = $3`,
    [name, newPath, id]
  );
  
  // If folder, update children paths
  const isFolder = file.is_folder === true || file.is_folder === 1;
  if (isFolder) {
    await execute(
      `UPDATE files SET path = REPLACE(path, $1, $2) WHERE path LIKE $3`,
      [file.path, newPath, `${file.path}/%`]
    );
  }
  
  const updated = await queryOne<FileRecord>(
    `SELECT id, bucket_id, name, path, parent_id, is_folder, mime_type, size, created_at, updated_at FROM files WHERE id = $1`,
    [id]
  );
  
  res.json({ 
    file: {
      ...updated,
      is_folder: isFolder,
    }
  });
});

// ============================================
// AGENT-BUCKET ASSOCIATIONS
// ============================================

// Get buckets for an agent
router.get('/agents/:sessionId/buckets', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { sessionId } = req.params;
  const organizationId = (req as any).organizationId as string | undefined;
  
  // SECURITY: Verify session/agent access (ownership or org membership)
  const session = await queryOne<{ user_id: string; organization_id: string | null }>(
    'SELECT user_id, organization_id FROM sessions WHERE id = $1',
    [sessionId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  // Check access: either owner or member of same org
  const hasAccess = session.user_id === userId || 
    (session.organization_id && session.organization_id === organizationId);
  
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  // Get attached buckets - include org buckets if agent is in an org
  const buckets = await query<AgentBucket & { bucket_name: string; storage_used: number }>(
    `SELECT ab.*, b.name as bucket_name, b.storage_used
     FROM agent_buckets ab
     JOIN buckets b ON ab.bucket_id = b.id
     WHERE ab.session_id = $1 
       AND (b.user_id = $2 OR b.organization_id = $3)`,
    [sessionId, userId, session.organization_id || organizationId]
  );
  
  res.json({ 
    buckets: buckets.map(b => ({
      ...b,
      read_only: b.read_only === true || b.read_only === 1,
      storage_used: Number(b.storage_used) || 0,
    }))
  });
});

// Add a bucket to an agent
router.post('/agents/:sessionId/buckets', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { sessionId } = req.params;
  const { bucket_id, mount_path = '/home/user/workspace/files', read_only = false } = req.body;
  
  console.log(`[Files] Attaching bucket: bucket_id=${bucket_id}, mount_path=${mount_path}, read_only=${read_only} (type: ${typeof read_only})`);
  
  if (!bucket_id) {
    return res.status(400).json({ error: 'bucket_id is required' });
  }
  
  // SECURITY: Verify session/agent ownership
  const session = await queryOne<{ user_id: string }>(
    'SELECT user_id FROM sessions WHERE id = $1',
    [sessionId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  if (session.user_id !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  // Verify bucket belongs to user
  const bucket = await queryOne<Bucket>(
    `SELECT * FROM buckets WHERE id = $1 AND user_id = $2`,
    [bucket_id, userId]
  );
  
  if (!bucket) {
    return res.status(404).json({ error: 'Bucket not found' });
  }
  
  const id = uuidv4();
  // Ensure read_only is properly converted to boolean
  const isReadOnly = read_only === true || read_only === 'true' || read_only === 1;
  console.log(`[Files] readOnlyValue=${isReadOnly}`);
  
  await execute(
    `INSERT INTO agent_buckets (id, session_id, bucket_id, mount_path, read_only) 
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(session_id, bucket_id) DO UPDATE SET mount_path = $6, read_only = $7`,
    [id, sessionId, bucket_id, mount_path, isReadOnly, mount_path, isReadOnly]
  );
  
  res.status(201).json({ success: true });
});

// Remove a bucket from an agent
router.delete('/agents/:sessionId/buckets/:bucketId', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { sessionId, bucketId } = req.params;
  
  // SECURITY: Verify session/agent ownership
  const session = await queryOne<{ user_id: string }>(
    'SELECT user_id FROM sessions WHERE id = $1',
    [sessionId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  if (session.user_id !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  await execute(
    `DELETE FROM agent_buckets WHERE session_id = $1 AND bucket_id = $2`,
    [sessionId, bucketId]
  );
  
  // Also remove any portal bucket access entries
  await execute(
    `DELETE FROM portal_bucket_access WHERE session_id = $1 AND bucket_id = $2`,
    [sessionId, bucketId]
  );
  
  res.json({ success: true });
});

// ============================================
// STORAGE INFO & USER CONFIG
// ============================================

// Get storage configuration info
router.get('/storage/info', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  res.json(await getStorageInfo(userId));
});

// Get user's storage config
router.get('/storage/config', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  
  const config = await queryOne<any>(
    `SELECT id, user_id, provider, bucket_name, region, endpoint, is_active, last_tested_at, test_status, test_error, created_at, updated_at
     FROM user_storage_configs WHERE user_id = $1`,
    [userId]
  );
  
  if (!config) {
    return res.json({ config: null });
  }
  
  res.json({ 
    config: {
      ...config,
      is_active: config.is_active === true || config.is_active === 1,
      // Don't expose credentials
    }
  });
});

// Save user's storage config
router.post('/storage/config', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { provider, bucket_name, region, endpoint, access_key_id, secret_access_key } = req.body;
  
  if (!provider || !bucket_name || !access_key_id || !secret_access_key) {
    return res.status(400).json({ error: 'Missing required fields: provider, bucket_name, access_key_id, secret_access_key' });
  }
  
  if (!['s3', 'r2', 's3-compatible'].includes(provider)) {
    return res.status(400).json({ error: 'Invalid provider. Must be s3, r2, or s3-compatible' });
  }
  
  // For R2 and s3-compatible, endpoint is required
  if ((provider === 'r2' || provider === 's3-compatible') && !endpoint) {
    return res.status(400).json({ error: 'Endpoint is required for R2 and S3-compatible providers' });
  }
  
  const id = uuidv4();
  
  // Check if config already exists
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM user_storage_configs WHERE user_id = $1`,
    [userId]
  );
  
  if (existing) {
    // Update existing config
    await execute(
      `UPDATE user_storage_configs 
       SET provider = $1, bucket_name = $2, region = $3, endpoint = $4, access_key_id = $5, secret_access_key = $6, 
           test_status = 'untested', test_error = NULL, updated_at = NOW()
       WHERE user_id = $7`,
      [provider, bucket_name, region || null, endpoint || null, access_key_id, secret_access_key, userId]
    );
  } else {
    // Insert new config
    await execute(
      `INSERT INTO user_storage_configs (id, user_id, provider, bucket_name, region, endpoint, access_key_id, secret_access_key, is_active, test_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'untested')`,
      [id, userId, provider, bucket_name, region || null, endpoint || null, access_key_id, secret_access_key, true]
    );
  }
  
  const config = await queryOne<any>(
    `SELECT id, user_id, provider, bucket_name, region, endpoint, is_active, test_status, created_at, updated_at
     FROM user_storage_configs WHERE user_id = $1`,
    [userId]
  );
  
  res.json({ 
    config: {
      ...config,
      is_active: config.is_active === true || config.is_active === 1,
    }
  });
});

// Test user's storage config
router.post('/storage/config/test', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  
  // Get the config from DB
  const config = await queryOne<any>(
    `SELECT * FROM user_storage_configs WHERE user_id = $1`,
    [userId]
  );
  
  if (!config) {
    return res.status(404).json({ error: 'No storage config found. Please save a config first.' });
  }
  
  // Import the test function
  const { testStorageConnection } = await import('../services/storage.js');
  
  const result = await testStorageConnection({
    provider: config.provider,
    bucket_name: config.bucket_name,
    region: config.region,
    endpoint: config.endpoint,
    access_key_id: config.access_key_id,
    secret_access_key: config.secret_access_key,
  });
  
  // Update test status in DB
  const testStatus = result.success ? 'success' : 'failed';
  await execute(
    `UPDATE user_storage_configs 
     SET test_status = $1, test_error = $2, last_tested_at = NOW(), updated_at = NOW()
     WHERE user_id = $3`,
    [testStatus, result.error || null, userId]
  );
  
  res.json({ 
    success: result.success,
    error: result.error,
    test_status: testStatus,
  });
});

// Delete user's storage config
router.delete('/storage/config', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  
  await execute(
    `DELETE FROM user_storage_configs WHERE user_id = $1`,
    [userId]
  );
  
  res.json({ success: true });
});

// Toggle user's storage config active status
router.patch('/storage/config/toggle', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const { is_active } = req.body;
  
  await execute(
    `UPDATE user_storage_configs SET is_active = $1, updated_at = NOW() WHERE user_id = $2`,
    [Boolean(is_active), userId]
  );
  
  res.json({ success: true });
});

export default router;
