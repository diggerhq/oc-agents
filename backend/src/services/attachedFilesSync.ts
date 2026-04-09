import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute } from '../db/index.js';
import { ocService } from './oc.js';
import { getS3MountConfig, generateStorageKey } from './storage.js';
import type { AgentBucket, FileRecord } from '../types/index.js';

type AttachedBucketRow = AgentBucket & { bucket_name: string };

function normalizeSandboxPath(path: string): string {
  // In E2B, the user's home is /home/user. We store mount paths like "/workspace/files".
  if (path.startsWith('/home/')) return path;
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `/home/user${clean}`;
}

function toBucketFilePath(relativePath: string): string {
  // DB paths are stored with leading slash, rooted at bucket.
  const clean = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
  return `/${clean}`;
}

function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    yaml: 'application/x-yaml',
    yml: 'application/x-yaml',
    toml: 'application/toml',
    sh: 'application/x-sh',
    bash: 'application/x-sh',
    py: 'text/x-python',
    ts: 'text/typescript',
    js: 'text/javascript',
    jsx: 'text/javascript',
    tsx: 'text/typescript',
    css: 'text/css',
    html: 'text/html',
    xml: 'application/xml',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    pdf: 'application/pdf',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function parentPathOf(path: string): string | null {
  // path is like "/a/b.txt" or "/a/b"
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return null;
  return `/${parts.slice(0, -1).join('/')}`;
}

function nameOf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

function depthOf(path: string): number {
  return path.split('/').filter(Boolean).length;
}

export async function indexBucketFromSandboxDir(params: {
  sandboxSessionId: string;
  bucketId: string;
  ownerUserId: string;
  localPath: string;
  portalVisitorId?: string; // If set, new files will be scoped to this visitor only (works across sessions for JWT users)
}): Promise<{ filesIndexed: number; totalBytes: number }> {
  const { sandboxSessionId, bucketId, ownerUserId, localPath, portalVisitorId } = params;

  // Confirm path exists (avoid treating "cd" failures as empty index)
  const existsCheck = await ocService.runCommand(
    sandboxSessionId,
    `test -d "${localPath}" && echo OK || echo MISSING`,
    '/'
  );
  if (!existsCheck.stdout.includes('OK')) {
    console.warn(`[FilesSync] Bucket localPath missing, skipping index: ${localPath}`);
    return { filesIndexed: 0, totalBytes: 0 };
  }

  // Collect directories and files from within the mounted bucket directory
  const dirsResult = await ocService.runCommand(
    sandboxSessionId,
    `find . -mindepth 1 -type d -printf '%P\\n' 2>/dev/null || true`,
    localPath
  );
  const filesResult = await ocService.runCommand(
    sandboxSessionId,
    `find . -type f -printf '%P\\t%s\\n' 2>/dev/null || true`,
    localPath
  );

  const dirRelPaths = dirsResult.stdout
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  const fileLines = filesResult.stdout
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  const existing = await query<Pick<FileRecord, 'id' | 'path' | 'is_folder'>>(
    `SELECT id, path, is_folder FROM files WHERE bucket_id = $1`,
    [bucketId]
  );
  const existingByPath = new Map<string, { id: string; is_folder: boolean | number }>();
  for (const r of existing) {
    // If duplicates exist, keep the first one we see
    if (!existingByPath.has(r.path)) existingByPath.set(r.path, { id: r.id, is_folder: r.is_folder });
  }

  // Build folder set (explicit dirs + implied parents for files)
  const folderPaths = new Set<string>();
  for (const rel of dirRelPaths) {
    folderPaths.add(toBucketFilePath(rel));
  }
  for (const line of fileLines) {
    const [rel] = line.split('\t');
    if (!rel) continue;
    const full = toBucketFilePath(rel);
    let p = parentPathOf(full);
    while (p) {
      folderPaths.add(p);
      p = parentPathOf(p);
    }
  }

  // Create folders from shallow to deep so parent_id is available
  const sortedFolders = Array.from(folderPaths).sort((a, b) => depthOf(a) - depthOf(b));
  const folderIdByPath = new Map<string, string>();

  for (const folderPath of sortedFolders) {
    const parentPath = parentPathOf(folderPath);
    const parentId = parentPath ? folderIdByPath.get(parentPath) || null : null;
    const folderName = nameOf(folderPath);

    const existingRec = existingByPath.get(folderPath);
    if (existingRec && (existingRec.is_folder === true || existingRec.is_folder === 1)) {
      folderIdByPath.set(folderPath, existingRec.id);
      // Keep parent pointers reasonably correct
      await execute(
        `UPDATE files SET parent_id = $1, updated_at = NOW() WHERE id = $2`,
        [parentId, existingRec.id]
      );
      continue;
    }

    const id = uuidv4();
    await execute(
      `INSERT INTO files (id, bucket_id, user_id, name, path, parent_id, is_folder, size, portal_visitor_id)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, 0, $7)`,
      [id, bucketId, ownerUserId, folderName, folderPath, parentId, portalVisitorId || null]
    );
    folderIdByPath.set(folderPath, id);
    existingByPath.set(folderPath, { id, is_folder: true });
  }

  // Upsert files
  let filesIndexed = 0;
  let totalBytes = 0;

  for (const line of fileLines) {
    const [rel, sizeStr] = line.split('\t');
    if (!rel) continue;
    const filePath = toBucketFilePath(rel);
    const fileName = nameOf(filePath);
    const parentPath = parentPathOf(filePath);
    const parentId = parentPath ? folderIdByPath.get(parentPath) || null : null;
    const size = Number.parseInt(sizeStr || '0', 10) || 0;
    const mimeType = getMimeType(fileName);
    const storageKey = generateStorageKey(ownerUserId, bucketId, filePath);

    const existingRec = existingByPath.get(filePath);
    if (existingRec && (existingRec.is_folder === false || existingRec.is_folder === 0)) {
      await execute(
        `UPDATE files
         SET parent_id = $1, mime_type = $2, size = $3, storage_key = $4, updated_at = NOW()
         WHERE id = $5`,
        [parentId, mimeType, size, storageKey, existingRec.id]
      );
    } else if (!existingRec) {
      const id = uuidv4();
      await execute(
        `INSERT INTO files (id, bucket_id, user_id, name, path, parent_id, is_folder, mime_type, size, storage_key, portal_visitor_id)
         VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7, $8, $9, $10)`,
        [id, bucketId, ownerUserId, fileName, filePath, parentId, mimeType, size, storageKey, portalVisitorId || null]
      );
      existingByPath.set(filePath, { id, is_folder: false });
    }

    filesIndexed += 1;
    totalBytes += size;
  }

  // Update bucket storage_used from the mounted view (best-effort)
  await execute(`UPDATE buckets SET storage_used = $1, updated_at = NOW() WHERE id = $2`, [totalBytes, bucketId]);

  return { filesIndexed, totalBytes };
}

export async function syncAgentBucketsBackAndIndex(params: {
  sandboxSessionId: string;
  agentId: string;
  ownerUserId: string;
  portalVisitorId?: string; // If set, new files will be scoped to this visitor only (works across sessions for JWT users)
}): Promise<{ bucketsSynced: number; bucketsIndexed: number; filesIndexed: number }> {
  const { sandboxSessionId, agentId, ownerUserId, portalVisitorId } = params;

  const agentBuckets = await query<AttachedBucketRow>(
    `SELECT ab.*, b.name as bucket_name
     FROM agent_buckets ab
     JOIN buckets b ON ab.bucket_id = b.id
     WHERE ab.session_id = $1`,
    [agentId]
  );

  if (!agentBuckets.length) {
    return { bucketsSynced: 0, bucketsIndexed: 0, filesIndexed: 0 };
  }

  const storageConfig = await getS3MountConfig(ownerUserId);
  if (!storageConfig) {
    console.warn(`[FilesSync] No object storage config for user ${ownerUserId}; cannot sync back`);
    return { bucketsSynced: 0, bucketsIndexed: 0, filesIndexed: 0 };
  }

  // Ensure rclone is available
  const rcloneResult = await ocService.installRclone(sandboxSessionId);
  if (!rcloneResult.success) {
    console.warn(`[FilesSync] rclone install failed; cannot sync back: ${rcloneResult.error}`);
    return { bucketsSynced: 0, bucketsIndexed: 0, filesIndexed: 0 };
  }

  // Find the correct bucket to rescue orphaned files from workspace root
  // Prefer the portal bucket if configured, otherwise use the first writable bucket
  const agentConfig = await queryOne<{ portal_bucket_id: string | null }>(
    `SELECT portal_bucket_id FROM agent_configs WHERE session_id = $1`,
    [agentId]
  );
  
  let targetBucket: AttachedBucketRow | undefined;
  
  if (agentConfig?.portal_bucket_id) {
    // Use the configured portal bucket if it's writable
    targetBucket = agentBuckets.find(b => 
      b.bucket_id === agentConfig.portal_bucket_id && 
      !(b.read_only === true || b.read_only === 1)
    );
  }
  
  // Fall back to first writable bucket
  if (!targetBucket) {
    targetBucket = agentBuckets.find(b => !(b.read_only === true || b.read_only === 1));
  }
  
  if (targetBucket) {
    // Check for orphaned files in ~/workspace/ that should be moved to the bucket
    // The agent sometimes creates files in the wrong place (workspace root instead of bucket)
    try {
      const basePath = normalizeSandboxPath(targetBucket.mount_path);
      const isPortalSandboxPath = /\/(output|input|skills)$/.test(basePath);
      const bucketPath = isPortalSandboxPath ? basePath : `${basePath}/${targetBucket.bucket_name}`;
      
      // Find files in ~/workspace/ (excluding system files, config files, and hidden files)
      // Exclude: hidden files, CLAUDE.md (Claude Code config), common config files
      // Also check ~/workspace/output/ for files not in a bucket subfolder
      const orphanedFilesResult = await ocService.runCommand(
        sandboxSessionId,
        `find /home/user/workspace -maxdepth 1 -type f ! -name ".*" ! -name "CLAUDE.md" ! -name "*.config.*" ! -name "package*.json" ! -name "tsconfig.json" ! -name "*.lock" 2>/dev/null; find /home/user -maxdepth 1 -type f ! -name ".*" 2>/dev/null || true`,
        '/'
      );
      
      const orphanedFiles = orphanedFilesResult.stdout
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
      
      if (orphanedFiles.length > 0) {
        console.log(`[FilesSync] Found ${orphanedFiles.length} orphaned files in workspace root, moving to bucket "${targetBucket.bucket_name}"${agentConfig?.portal_bucket_id ? ' (portal bucket)' : ''}`);
        
        // Move each file to the bucket
        for (const filePath of orphanedFiles) {
          const fileName = filePath.split('/').pop();
          if (!fileName) continue;
          
          const moveCmd = `mv "${filePath}" "${bucketPath}/${fileName}" 2>/dev/null || cp "${filePath}" "${bucketPath}/${fileName}" 2>/dev/null || true`;
          await ocService.runCommand(sandboxSessionId, moveCmd, '/');
          console.log(`[FilesSync] Moved orphaned file: ${fileName} -> ${bucketPath}/${fileName}`);
        }
      }
    } catch (err) {
      console.warn(`[FilesSync] Error checking for orphaned files:`, err);
      // Continue with normal sync even if orphan check fails
    }
  }

  let bucketsSynced = 0;
  let bucketsIndexed = 0;
  let filesIndexed = 0;

  for (const bucket of agentBuckets) {
    const isReadOnly = bucket.read_only === true || bucket.read_only === 1;
    if (isReadOnly) continue;

    const basePath = normalizeSandboxPath(bucket.mount_path);
    // Portal-sandbox agents: mount_path IS the directory (e.g. /home/user/workspace/output)
    // Task agents: bucket_name is a subdirectory under mount_path
    const isPortalSandboxPath = /\/(output|input|skills)$/.test(basePath);
    const localPath = isPortalSandboxPath ? basePath : `${basePath}/${bucket.bucket_name}`;
    const remotePath = `${ownerUserId}/${bucket.bucket_id}`;
    
    // Ensure directory exists before sync
    await ocService.runCommand(sandboxSessionId, `mkdir -p "${localPath}"`, '/');

    const syncResult = await ocService.syncBackWithRclone(sandboxSessionId, {
      provider: storageConfig.provider,
      bucketName: storageConfig.bucketName,
      accessKeyId: storageConfig.accessKeyId,
      secretAccessKey: storageConfig.secretAccessKey,
      endpoint: storageConfig.endpoint,
      region: storageConfig.region,
      remotePath,
      localPath,
    });

    if (!syncResult.success) {
      console.error(`[FilesSync] Sync-back failed for bucket ${bucket.bucket_id}: ${syncResult.error}`);
      continue;
    }

    bucketsSynced += 1;

    try {
      const indexResult = await indexBucketFromSandboxDir({
        sandboxSessionId,
        bucketId: bucket.bucket_id,
        ownerUserId,
        localPath,
        portalVisitorId,
      });
      bucketsIndexed += 1;
      filesIndexed += indexResult.filesIndexed;
    } catch (err) {
      console.error(`[FilesSync] Index failed for bucket ${bucket.bucket_id}:`, err);
    }
  }

  return { bucketsSynced, bucketsIndexed, filesIndexed };
}

