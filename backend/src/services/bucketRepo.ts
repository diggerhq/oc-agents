/**
 * Bucket Repository Service
 * 
 * Handles syncing file buckets from git repositories.
 * This is a generic feature - any bucket can optionally be backed by a repo.
 * 
 * Features:
 * - GitHub and GitLab support with FAST archive-based cloning
 * - Progress tracking (download → extract → upload)
 * - Encrypted token storage
 * - Falls back to tree API for unsupported providers
 */

import { v4 as uuidv4 } from 'uuid';
import yauzl from 'yauzl';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import fetch from 'node-fetch';
import { execute, queryOne, query } from '../db/index.js';
import { uploadToR2, generateStorageKey, isStorageConfiguredForUser } from './storage.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import type { BucketRepo, Bucket, SyncProgress } from '../types/index.js';

interface FileEntry {
  path: string;
  content: Buffer;
  size: number;
}

// GitHub App configuration
const GITHUB_APP_ID = process.env.GITHUB_APP_ID;
const GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY 
  ? Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY, 'base64').toString('utf-8')
  : undefined;

/**
 * Generate a JWT for GitHub App authentication
 */
function generateGitHubAppJWT(): string {
  if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY) {
    throw new Error('GitHub App not configured');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 600,
    iss: GITHUB_APP_ID,
  };

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${body}`)
    .sign(GITHUB_APP_PRIVATE_KEY, 'base64url');

  return `${header}.${body}.${signature}`;
}

/**
 * Get an installation access token for a specific GitHub App installation
 */
async function getGitHubInstallationToken(installationId: number): Promise<string> {
  const jwt = generateGitHubAppJWT();
  
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Oshu-Agent-Platform',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('[BucketRepo] Failed to get installation token:', response.status, error);
    throw new Error(`Failed to get installation token: ${response.status}`);
  }

  const data = await response.json() as { token: string };
  return data.token;
}

// Text file extensions for line counting
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.less',
  '.html', '.htm', '.xml', '.svg', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.py', '.rb', '.php', '.java', '.kt', '.scala', '.go', '.rs', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.fs', '.vb', '.swift', '.m', '.mm', '.r', '.R', '.jl', '.lua', '.pl', '.pm',
  '.sql', '.graphql', '.gql', '.prisma',
  '.vue', '.svelte', '.astro', '.mdx',
  '.env', '.gitignore', '.dockerignore', '.editorconfig',
  '.csv', '.tsv', '.log', '.lock',
  'Dockerfile', 'Makefile', 'Rakefile', 'Gemfile', 'Procfile',
]);

/**
 * Check if a file is a text file based on extension
 */
function isTextFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  // Check exact matches (Dockerfile, Makefile, etc.)
  if (TEXT_EXTENSIONS.has(lower)) return true;
  // Check extension
  const ext = lower.substring(lower.lastIndexOf('.'));
  return TEXT_EXTENSIONS.has(ext);
}

/**
 * Count lines in a buffer (for text files)
 */
function countLines(content: Buffer): number {
  let count = 1; // At least one line
  for (let i = 0; i < content.length; i++) {
    if (content[i] === 0x0A) { // newline character
      count++;
    }
  }
  return count;
}

// ============================================
// URL PARSING
// ============================================

function parseRepoUrl(url: string): { owner: string; repo: string; provider: 'github' | 'gitlab' | 'unknown' } {
  let provider: 'github' | 'gitlab' | 'unknown' = 'unknown';
  let owner = '';
  let repo = '';
  
  try {
    if (url.includes('github.com')) {
      provider = 'github';
    } else if (url.includes('gitlab.com')) {
      provider = 'gitlab';
    }
    
    // HTTPS format
    const httpsMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:github|gitlab)\.com\/([^\/]+)\/([^\/\s]+?)(?:\.git)?$/);
    if (httpsMatch) {
      owner = httpsMatch[1];
      repo = httpsMatch[2].replace(/\.git$/, '');
    }
    
    // SSH format
    const sshMatch = url.match(/git@(?:github|gitlab)\.com:([^\/]+)\/([^\/\s]+?)(?:\.git)?$/);
    if (sshMatch) {
      owner = sshMatch[1];
      repo = sshMatch[2].replace(/\.git$/, '');
    }
  } catch {
    // Ignore parse errors
  }
  
  return { owner, repo, provider };
}

// ============================================
// PROGRESS TRACKING
// ============================================

async function updateProgress(bucketRepoId: string, progress: SyncProgress): Promise<void> {
  await execute(
    `UPDATE bucket_repos SET sync_progress = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(progress), bucketRepoId]
  );
}

// ============================================
// ARCHIVE-BASED CLONING (FAST!)
// ============================================

/**
 * Download repository archive from GitHub to a temp file
 * Uses the zipball API for fast, single-request downloads
 * Streams directly to disk to avoid memory issues with large repos
 */
async function downloadGitHubArchiveToFile(
  owner: string,
  repo: string,
  branch: string,
  token?: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/zipball/${branch}`;
  
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Jeff-Agent-Platform',
  };
  
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }
  
  console.log(`[BucketRepo] Downloading GitHub archive: ${owner}/${repo}@${branch}`);
  
  const response = await fetch(url, { headers });
  
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Repository not found or private (add token for private repos)');
    } else if (response.status === 403) {
      throw new Error('API rate limit exceeded or access denied');
    }
    throw new Error(`GitHub API error: ${response.status}`);
  }
  
  if (!response.body) {
    throw new Error('No response body');
  }
  
  // Get content length for progress tracking
  const contentLength = parseInt(response.headers.get('content-length') || '0');
  
  // Create temp file path
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `repo-${uuidv4()}.zip`);
  
  // Stream directly to file with progress tracking
  let downloadedBytes = 0;
  const writeStream = fs.createWriteStream(tempFile);
  
  // Wrap the response body to track progress
  const { Transform } = await import('stream');
  const progressStream = new Transform({
    transform(chunk, encoding, callback) {
      downloadedBytes += chunk.length;
      if (onProgress && contentLength > 0) {
        onProgress(downloadedBytes, contentLength);
      }
      callback(null, chunk);
    }
  });
  
  try {
    await pipeline(response.body, progressStream, writeStream);
    console.log(`[BucketRepo] Downloaded ${(downloadedBytes / 1024 / 1024).toFixed(2)} MB to ${tempFile}`);
    return tempFile;
  } catch (err) {
    // Clean up temp file on error
    try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Download repository archive from GitLab to a temp file
 * Uses the archive API for fast, single-request downloads
 * Streams directly to disk to avoid memory issues with large repos
 */
async function downloadGitLabArchiveToFile(
  owner: string,
  repo: string,
  branch: string,
  token?: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<string> {
  const projectPath = encodeURIComponent(`${owner}/${repo}`);
  const url = `https://gitlab.com/api/v4/projects/${projectPath}/repository/archive.zip?sha=${encodeURIComponent(branch)}`;
  
  const headers: Record<string, string> = {
    'User-Agent': 'Jeff-Agent-Platform',
    'Accept': 'application/octet-stream, application/zip, */*',
  };
  
  if (token) {
    // Use Bearer auth which works for both OAuth and Personal Access Tokens
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  console.log(`[BucketRepo] Downloading GitLab archive: ${owner}/${repo}@${branch}`);
  
  const response = await fetch(url, { headers });
  
  if (!response.ok) {
    // Try to get error details from response body
    let errorDetail = '';
    try {
      const errorBody = await response.text();
      errorDetail = errorBody ? `: ${errorBody.substring(0, 200)}` : '';
    } catch {
      // Ignore
    }
    
    if (response.status === 404) {
      throw new Error('Repository not found or private (add token for private repos)');
    }
    if (response.status === 406) {
      throw new Error(`GitLab requires authentication for this repository. Please add a GitLab Personal Access Token.${errorDetail}`);
    }
    throw new Error(`GitLab API error: ${response.status}${errorDetail}`);
  }
  
  if (!response.body) {
    throw new Error('No response body');
  }
  
  // Get content length for progress tracking
  const contentLength = parseInt(response.headers.get('content-length') || '0');
  
  // Create temp file path
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `repo-${uuidv4()}.zip`);
  
  // Stream directly to file with progress tracking
  let downloadedBytes = 0;
  const writeStream = fs.createWriteStream(tempFile);
  
  // Wrap the response body to track progress
  const { Transform } = await import('stream');
  const progressStream = new Transform({
    transform(chunk, encoding, callback) {
      downloadedBytes += chunk.length;
      if (onProgress && contentLength > 0) {
        onProgress(downloadedBytes, contentLength);
      }
      callback(null, chunk);
    }
  });
  
  try {
    await pipeline(response.body, progressStream, writeStream);
    console.log(`[BucketRepo] Downloaded ${(downloadedBytes / 1024 / 1024).toFixed(2)} MB to ${tempFile}`);
    return tempFile;
  } catch (err) {
    // Clean up temp file on error
    try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Extract files from zip archive using yauzl for true streaming
 * Opens the ZIP from a file path - only one file is in memory at a time
 * Much better memory usage for large repos
 */
async function* extractZipFilesFromPath(
  zipPath: string,
  onProgress?: (current: number, total: number) => void
): AsyncGenerator<FileEntry> {
  console.log(`[BucketRepo] Extracting zip archive from ${zipPath} with yauzl (streaming)...`);

  // Open ZIP from file path (not memory!)
  const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) reject(err);
      else if (zip) resolve(zip);
      else reject(new Error('Failed to open ZIP'));
    });
  });

  const totalFiles = zipFile.entryCount;
  let currentFile = 0;

  console.log(`[BucketRepo] Found ${totalFiles} entries in archive`);

  // Create async iterator from yauzl's event-based API
  const entries: FileEntry[] = [];
  let resolveNext: ((value: FileEntry | null) => void) | null = null;
  let rejectNext: ((err: Error) => void) | null = null;
  let finished = false;
  let pendingEntry: FileEntry | null = null;

  // Queue to hold entries as they're extracted
  const entryQueue: (FileEntry | null)[] = [];
  let waitingForEntry: ((entry: FileEntry | null) => void) | null = null;

  const pushEntry = (entry: FileEntry | null) => {
    if (waitingForEntry) {
      const resolve = waitingForEntry;
      waitingForEntry = null;
      resolve(entry);
    } else {
      entryQueue.push(entry);
    }
  };

  const getNextEntry = (): Promise<FileEntry | null> => {
    if (entryQueue.length > 0) {
      return Promise.resolve(entryQueue.shift()!);
    }
    return new Promise((resolve) => {
      waitingForEntry = resolve;
    });
  };

  zipFile.on('entry', async (entry: yauzl.Entry) => {
    // Skip directories
    if (entry.fileName.endsWith('/')) {
      zipFile.readEntry();
      return;
    }

    // GitHub/GitLab zips have a root folder like "owner-repo-sha/", remove it
    const pathParts = entry.fileName.split('/');
    pathParts.shift(); // Remove the root folder
    const relativePath = pathParts.join('/');

    if (!relativePath) {
      zipFile.readEntry();
      return;
    }

    // Open read stream for this entry
    zipFile.openReadStream(entry, (err, readStream) => {
      if (err || !readStream) {
        console.error(`[BucketRepo] Error reading entry ${entry.fileName}:`, err);
        zipFile.readEntry();
        return;
      }

      // Collect chunks for this file
      const chunks: Buffer[] = [];

      readStream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      readStream.on('end', () => {
        const content = Buffer.concat(chunks);
        currentFile++;

        if (onProgress) {
          onProgress(currentFile, totalFiles);
        }

        pushEntry({
          path: relativePath,
          content,
          size: content.length,
        });

        // Request next entry
        zipFile.readEntry();
      });

      readStream.on('error', (err) => {
        console.error(`[BucketRepo] Stream error for ${entry.fileName}:`, err);
        zipFile.readEntry();
      });
    });
  });

  zipFile.on('end', () => {
    pushEntry(null); // Signal completion
  });

  zipFile.on('error', (err) => {
    console.error(`[BucketRepo] ZIP error:`, err);
    pushEntry(null);
  });

  // Start reading entries
  zipFile.readEntry();

  // Yield entries as they become available
  while (true) {
    const entry = await getNextEntry();
    if (entry === null) {
      break;
    }
    yield entry;
  }

  zipFile.close();
}

/**
 * Download and extract repository archive
 * Works for both GitHub and GitLab
 * Streams to temp file to avoid memory issues with large repos
 */
async function* streamRepoArchive(
  repoUrl: string,
  branch: string = 'main',
  token?: string,
  bucketRepoId?: string
): AsyncGenerator<FileEntry> {
  const { owner, repo, provider } = parseRepoUrl(repoUrl);
  
  if (!owner || !repo) {
    throw new Error('Invalid repository URL');
  }
  
  if (provider === 'unknown') {
    throw new Error('Unsupported git provider. Use GitHub or GitLab URLs.');
  }
  
  console.log(`[BucketRepo] Fast cloning ${provider}:${owner}/${repo}@${branch} via archive API (streaming to disk)`);
  
  // Phase 1: Download archive to temp file (not memory!)
  let tempFilePath: string;
  
  const downloadProgress = bucketRepoId ? async (downloaded: number, total: number) => {
    const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
    const mb = (downloaded / 1024 / 1024).toFixed(1);
    await updateProgress(bucketRepoId, {
      phase: 'downloading',
      current: downloaded,
      total,
      message: `Downloading archive... ${mb} MB (${percent}%)`
    });
  } : undefined;
  
  if (provider === 'github') {
    tempFilePath = await downloadGitHubArchiveToFile(owner, repo, branch, token, downloadProgress);
  } else {
    tempFilePath = await downloadGitLabArchiveToFile(owner, repo, branch, token, downloadProgress);
  }
  
  // Phase 2: Extract files from temp file (streaming, low memory)
  if (bucketRepoId) {
    await updateProgress(bucketRepoId, {
      phase: 'extracting',
      current: 0,
      total: 0,
      message: 'Extracting archive...'
    });
  }
  
  const extractProgress = bucketRepoId ? async (current: number, total: number) => {
    await updateProgress(bucketRepoId, {
      phase: 'extracting',
      current,
      total,
      message: `Extracting files... ${current}/${total}`
    });
  } : undefined;
  
  try {
    yield* extractZipFilesFromPath(tempFilePath, extractProgress);
  } finally {
    // Clean up temp file after extraction
    try {
      fs.unlinkSync(tempFilePath);
      console.log(`[BucketRepo] Cleaned up temp file: ${tempFilePath}`);
    } catch (err) {
      console.warn(`[BucketRepo] Failed to clean up temp file: ${tempFilePath}`, err);
    }
  }
}

// ============================================
// BUCKET OPERATIONS
// ============================================

/**
 * Process a single file - create folders and upload
 * Returns the file size if successful, 0 otherwise
 */
async function processAndUploadFile(
  file: FileEntry,
  bucketId: string,
  userId: string,
  createdFolders: Map<string, string> // path -> folderId
): Promise<{ size: number; success: boolean }> {
  const pathParts = file.path.split('/');
  const fileName = pathParts.pop()!;

  let currentPath = '/';
  let parentId: string | null = null;

  // Ensure parent folders exist
  for (const part of pathParts) {
    const folderPath = currentPath === '/' ? `/${part}` : `${currentPath}/${part}`;

    if (!createdFolders.has(folderPath)) {
      const folderId = uuidv4();
      await execute(
        `INSERT INTO files (id, bucket_id, user_id, name, path, parent_id, is_folder, size)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0)
         ON CONFLICT DO NOTHING`,
        [folderId, bucketId, userId, part, folderPath, parentId, true]
      );
      createdFolders.set(folderPath, folderId);
      parentId = folderId;
    } else {
      parentId = createdFolders.get(folderPath) || null;
    }

    currentPath = folderPath;
  }

  // Upload file
  const fullPath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
  const storageKey = generateStorageKey(userId, bucketId, fullPath);
  const mimeType = getMimeType(fileName);

  const uploadResult = await uploadToR2(storageKey, file.content, mimeType, userId);

  if (uploadResult.success) {
    const fileId = uuidv4();
    const lineCount = isTextFile(fileName) ? countLines(file.content) : null;

    await execute(
      `INSERT INTO files (id, bucket_id, user_id, name, path, parent_id, is_folder, mime_type, size, storage_key, line_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [fileId, bucketId, userId, fileName, fullPath, parentId, false, mimeType, file.size, storageKey, lineCount]
    );
    return { size: file.size, success: true };
  }

  return { size: 0, success: false };
}

/**
 * Perform the actual cloning work (runs in background)
 * Processes files sequentially to avoid race conditions with folder creation
 * 
 * For GitHub App installations, token is a short-lived installation token.
 * For long operations, the token may expire - we handle this by catching auth errors.
 */
async function performRepoClone(
  bucketId: string,
  bucketRepoId: string,
  userId: string,
  repoUrl: string,
  branch: string,
  token?: string,
  githubInstallationId?: number
): Promise<void> {
  const authMethod = githubInstallationId 
    ? `GitHub App installation ${githubInstallationId}`
    : token ? 'token' : 'none';
  console.log(`[BucketRepo] performRepoClone - auth: ${authMethod}`);

  let totalSize = 0;
  let fileCount = 0;
  const createdFolders = new Map<string, string>();

  // Get the current commit SHA before syncing
  const { sha: commitSha } = await getLatestCommitSha(repoUrl, branch, token);

  try {
    let processedCount = 0;

    console.log(`[BucketRepo] Starting sequential upload...`);

    // Process files sequentially - simpler and avoids folder creation race conditions
    for await (const file of streamRepoArchive(repoUrl, branch, token, bucketRepoId)) {
      const result = await processAndUploadFile(file, bucketId, userId, createdFolders);
      
      if (result.success) {
        totalSize += result.size;
        fileCount++;
      }
      processedCount++;

      // Update progress periodically
      if (processedCount % 50 === 0) {
        await updateProgress(bucketRepoId, {
          phase: 'uploading',
          current: processedCount,
          total: 0, // Unknown total with streaming
          message: `Uploading files... ${processedCount} processed`
        });
      }
    }

    // Update bucket and mark as synced
    await execute(
      `UPDATE buckets SET storage_used = $1, updated_at = NOW() WHERE id = $2`,
      [totalSize, bucketId]
    );

    await execute(
      `UPDATE bucket_repos SET sync_status = 'synced', last_synced_at = NOW(), file_count = $1, sync_progress = NULL, last_sync_commit = $2, updated_at = NOW() WHERE id = $3`,
      [fileCount, commitSha || null, bucketRepoId]
    );

    console.log(`[BucketRepo] Created bucket with ${fileCount} files (${(totalSize / 1024 / 1024).toFixed(2)} MB), commit: ${commitSha?.substring(0, 8)}`);

  } catch (error) {
    // Mark as failed
    await execute(
      `UPDATE bucket_repos SET sync_status = 'failed', sync_error = $1, sync_progress = NULL, updated_at = NOW() WHERE id = $2`,
      [error instanceof Error ? error.message : 'Unknown error', bucketRepoId]
    );
    console.error('[BucketRepo] Clone failed:', error);
  }
}

/**
 * Create a bucket from a git repository (archive-based fast clone)
 * Returns immediately with bucket info, cloning happens in background
 * 
 * Supports two auth methods for GitHub:
 * - githubInstallationId: Uses GitHub App installation token (preferred)
 * - token: Uses OAuth or PAT token
 */
export async function createBucketFromRepo(
  userId: string,
  name: string,
  repoUrl: string,
  branch: string = 'main',
  token?: string,
  description?: string,
  organizationId?: string | null,
  githubInstallationId?: number
): Promise<{ bucket: Bucket; bucketRepo: BucketRepo } | { error: string }> {
  try {
    // Check if storage is configured
    const hasStorage = await isStorageConfiguredForUser(userId);
    if (!hasStorage) {
      return { error: 'Object storage required. Please configure S3 or R2 storage in Settings.' };
    }
    
    // Check if bucket name already exists in org or user scope
    const existing = organizationId
      ? await queryOne<Bucket>(
          'SELECT id FROM buckets WHERE organization_id = $1 AND name = $2',
          [organizationId, name]
        )
      : await queryOne<Bucket>(
          'SELECT id FROM buckets WHERE user_id = $1 AND name = $2 AND organization_id IS NULL',
          [userId, name]
        );
    
    if (existing) {
      return { error: 'A bucket with this name already exists' };
    }
    
    // Create the bucket with organization_id
    const bucketId = uuidv4();
    await execute(
      `INSERT INTO buckets (id, user_id, organization_id, name, description) VALUES ($1, $2, $3, $4, $5)`,
      [bucketId, userId, organizationId || null, name, description || `Synced from ${repoUrl}`]
    );
    
    // Encrypt token before storing (only if not using installation)
    const encryptedToken = token && !githubInstallationId ? encrypt(token) : null;
    
    // Create the bucket_repo record with 'syncing' status
    const bucketRepoId = uuidv4();
    await execute(
      `INSERT INTO bucket_repos (id, bucket_id, user_id, repo_url, repo_branch, repo_token, github_installation_id, sync_status, sync_progress) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'syncing', $8)`,
      [bucketRepoId, bucketId, userId, repoUrl, branch, encryptedToken, githubInstallationId || null, JSON.stringify({
        phase: 'discovering',
        current: 0,
        total: 0,
        message: 'Starting clone...'
      })]
    );
    
    // Fetch the created records to return immediately
    const bucket = await queryOne<Bucket>('SELECT * FROM buckets WHERE id = $1', [bucketId]);
    const bucketRepo = await queryOne<BucketRepo>('SELECT * FROM bucket_repos WHERE id = $1', [bucketRepoId]);
    
    // Get effective token for cloning
    let effectiveToken = token;
    if (githubInstallationId) {
      try {
        effectiveToken = await getGitHubInstallationToken(githubInstallationId);
        console.log(`[BucketRepo] Generated installation token for installation ${githubInstallationId}`);
      } catch (err) {
        console.error('[BucketRepo] Failed to get installation token:', err);
        return { error: 'Failed to authenticate with GitHub App. Please check your installation.' };
      }
    }
    
    // Start cloning in background (fire-and-forget)
    performRepoClone(bucketId, bucketRepoId, userId, repoUrl, branch, effectiveToken, githubInstallationId).catch(err => {
      console.error('[BucketRepo] Background clone error:', err);
    });
    
    return { bucket: bucket!, bucketRepo: bucketRepo! };
  } catch (error) {
    console.error('[BucketRepo] Create bucket from repo error:', error);
    return { error: error instanceof Error ? error.message : 'Failed to create bucket from repository' };
  }
}

/**
 * Sync an existing repo-backed bucket with the remote repository
 * Processes files sequentially to avoid race conditions
 */
export async function syncBucketRepo(bucketRepoId: string, userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Get the bucket repo
    const bucketRepo = await queryOne<BucketRepo>(
      'SELECT * FROM bucket_repos WHERE id = $1 AND user_id = $2',
      [bucketRepoId, userId]
    );

    if (!bucketRepo) {
      return { success: false, error: 'Bucket repo not found' };
    }

    // Get effective token - prefer GitHub App installation token, fall back to stored token
    let effectiveToken: string | undefined;
    if (bucketRepo.github_installation_id) {
      try {
        effectiveToken = await getGitHubInstallationToken(bucketRepo.github_installation_id);
        console.log(`[BucketRepo] Sync - using GitHub App installation ${bucketRepo.github_installation_id}`);
      } catch (err) {
        console.error('[BucketRepo] Failed to get installation token:', err);
        return { success: false, error: 'Failed to authenticate with GitHub App. Please check your installation.' };
      }
    } else if (bucketRepo.repo_token) {
      effectiveToken = decrypt(bucketRepo.repo_token);
      console.log(`[BucketRepo] Sync - using stored token (length: ${effectiveToken?.length || 0})`);
    } else {
      console.log(`[BucketRepo] Sync - no authentication configured`);
    }

    // Get the current commit SHA before syncing
    const { sha: commitSha } = await getLatestCommitSha(bucketRepo.repo_url, bucketRepo.repo_branch, effectiveToken);

    // Update status to syncing
    await execute(
      `UPDATE bucket_repos SET sync_status = 'syncing', sync_error = NULL, sync_progress = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify({ phase: 'discovering', current: 0, total: 0, message: 'Starting sync...' }), bucketRepoId]
    );

    // Delete existing files from bucket
    await execute('DELETE FROM files WHERE bucket_id = $1', [bucketRepo.bucket_id]);

    // Process files sequentially
    let totalSize = 0;
    let fileCount = 0;
    const createdFolders = new Map<string, string>();

    try {
      let processedCount = 0;

      console.log(`[BucketRepo] Starting sequential sync...`);

      // Process files sequentially - simpler and avoids folder creation race conditions
      for await (const file of streamRepoArchive(bucketRepo.repo_url, bucketRepo.repo_branch, effectiveToken, bucketRepoId)) {
        const result = await processAndUploadFile(file, bucketRepo.bucket_id, userId, createdFolders);
        
        if (result.success) {
          totalSize += result.size;
          fileCount++;
        }
        processedCount++;

        // Update progress periodically
        if (processedCount % 50 === 0) {
          await updateProgress(bucketRepoId, {
            phase: 'uploading',
            current: processedCount,
            total: 0,
            message: `Uploading files... ${processedCount} processed`
          });
        }
      }

      // Update bucket and mark as synced
      await execute(
        `UPDATE buckets SET storage_used = $1, updated_at = NOW() WHERE id = $2`,
        [totalSize, bucketRepo.bucket_id]
      );

      await execute(
        `UPDATE bucket_repos SET sync_status = 'synced', last_synced_at = NOW(), file_count = $1, sync_progress = NULL, last_sync_commit = $2, updated_at = NOW() WHERE id = $3`,
        [fileCount, commitSha || null, bucketRepoId]
      );

      console.log(`[BucketRepo] Synced bucket with ${fileCount} files (${(totalSize / 1024 / 1024).toFixed(2)} MB), commit: ${commitSha?.substring(0, 8)}`);

      return { success: true };
    } catch (error) {
      await execute(
        `UPDATE bucket_repos SET sync_status = 'failed', sync_error = $1, sync_progress = NULL, updated_at = NOW() WHERE id = $2`,
        [error instanceof Error ? error.message : 'Unknown error', bucketRepoId]
      );
      throw error;
    }
  } catch (error) {
    console.error('[BucketRepo] Sync error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Sync failed' };
  }
}

/**
 * Get the bucket repo info for a bucket (if it's repo-backed)
 */
export async function getBucketRepoForBucket(bucketId: string, userId: string): Promise<BucketRepo | null> {
  try {
    const result = await queryOne<BucketRepo>(
      'SELECT * FROM bucket_repos WHERE bucket_id = $1 AND user_id = $2',
      [bucketId, userId]
    );
    return result || null;
  } catch (error: any) {
    if (error.message?.includes('no such table') || error.code === '42P01') {
      console.log('[BucketRepo] bucket_repos table does not exist yet');
      return null;
    }
    throw error;
  }
}

/**
 * Get all repo-backed buckets for a user
 */
export async function getUserBucketRepos(userId: string): Promise<(BucketRepo & { bucket_name: string })[]> {
  try {
    return await query<BucketRepo & { bucket_name: string }>(
      `SELECT br.*, b.name as bucket_name 
       FROM bucket_repos br 
       JOIN buckets b ON br.bucket_id = b.id 
       WHERE br.user_id = $1 
       ORDER BY br.created_at DESC`,
      [userId]
    );
  } catch (error: any) {
    if (error.message?.includes('no such table') || error.code === '42P01') {
      console.log('[BucketRepo] bucket_repos table does not exist yet');
      return [];
    }
    throw error;
  }
}

/**
 * Get mime type from file extension
 */
function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  
  const mimeTypes: Record<string, string> = {
    'md': 'text/markdown',
    'markdown': 'text/markdown',
    'txt': 'text/plain',
    'json': 'application/json',
    'yaml': 'application/x-yaml',
    'yml': 'application/x-yaml',
    'toml': 'application/toml',
    'sh': 'application/x-sh',
    'bash': 'application/x-sh',
    'py': 'text/x-python',
    'ts': 'text/typescript',
    'js': 'text/javascript',
    'jsx': 'text/javascript',
    'tsx': 'text/typescript',
    'css': 'text/css',
    'html': 'text/html',
    'xml': 'application/xml',
    'svg': 'image/svg+xml',
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Get the latest commit SHA from the remote repository
 */
async function getLatestCommitSha(
  repoUrl: string,
  branch: string,
  token?: string
): Promise<{ sha: string | null; error?: string }> {
  const { owner, repo, provider } = parseRepoUrl(repoUrl);
  
  if (provider === 'github') {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Jeff-Agent-Builder',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    });
    
    if (!response.ok) {
      return { sha: null, error: `GitHub API error: ${response.status}` };
    }
    
    const data = await response.json() as { sha: string };
    return { sha: data.sha };
    
  } else if (provider === 'gitlab') {
    const projectPath = encodeURIComponent(`${owner}/${repo}`);
    const url = `https://gitlab.com/api/v4/projects/${projectPath}/repository/branches/${encodeURIComponent(branch)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Jeff-Agent-Builder',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    });
    
    if (!response.ok) {
      return { sha: null, error: `GitLab API error: ${response.status}` };
    }
    
    const data = await response.json() as { commit?: { id: string } };
    return { sha: data.commit?.id || null };
  }
  
  return { sha: null, error: 'Unsupported provider' };
}

/**
 * Check if a repo bucket needs to be synced
 * Compares the remote commit SHA with what we last synced
 */
export async function checkSyncStatus(
  bucketId: string,
  userId: string
): Promise<{ needsSync: boolean; remoteCommit?: string; localCommit?: string; error?: string }> {
  try {
    const bucketRepo = await queryOne<BucketRepo & { last_sync_commit?: string }>(
      'SELECT * FROM bucket_repos WHERE bucket_id = $1 AND user_id = $2',
      [bucketId, userId]
    );
    
    if (!bucketRepo) {
      return { needsSync: false, error: 'Not a repo-backed bucket' };
    }
    
    // Get effective token - prefer installation token
    let token: string | undefined;
    if (bucketRepo.github_installation_id) {
      try {
        token = await getGitHubInstallationToken(bucketRepo.github_installation_id);
      } catch {
        // Fall back to stored token if installation token fails
        token = bucketRepo.repo_token ? decrypt(bucketRepo.repo_token) : undefined;
      }
    } else {
      token = bucketRepo.repo_token ? decrypt(bucketRepo.repo_token) : undefined;
    }
    
    // Get the latest commit from remote
    const { sha: remoteCommit, error } = await getLatestCommitSha(
      bucketRepo.repo_url,
      bucketRepo.repo_branch,
      token
    );
    
    if (error || !remoteCommit) {
      return { needsSync: true, error }; // If we can't check, assume sync needed
    }
    
    // Compare with stored commit (if we have one)
    const localCommit = bucketRepo.last_sync_commit;
    
    if (!localCommit) {
      // Never synced or no commit stored - needs sync
      return { needsSync: true, remoteCommit };
    }
    
    const needsSync = remoteCommit !== localCommit;
    return { needsSync, remoteCommit, localCommit };
    
  } catch (error) {
    console.error('[BucketRepo] Check sync status error:', error);
    return { needsSync: true, error: 'Failed to check sync status' };
  }
}

/**
 * Commit and push a file change to the remote repository
 */
export async function commitAndPushFile(
  bucketRepoId: string,
  userId: string,
  filePath: string,
  content: string,
  commitMessage: string
): Promise<{ success: boolean; error?: string; sha?: string }> {
  try {
    const bucketRepo = await queryOne<BucketRepo>(
      'SELECT * FROM bucket_repos WHERE id = $1 AND user_id = $2',
      [bucketRepoId, userId]
    );
    
    if (!bucketRepo) {
      return { success: false, error: 'Bucket repo not found' };
    }
    
    // Get effective token - prefer installation token for GitHub
    let token: string | undefined;
    if (bucketRepo.github_installation_id) {
      try {
        token = await getGitHubInstallationToken(bucketRepo.github_installation_id);
      } catch (err) {
        console.error('[BucketRepo] Failed to get installation token for push:', err);
        return { success: false, error: 'Failed to authenticate with GitHub App. Please check your installation.' };
      }
    } else {
      token = bucketRepo.repo_token ? decrypt(bucketRepo.repo_token) : undefined;
    }
    
    if (!token) {
      return { success: false, error: 'Repository token required for pushing changes' };
    }
    
    const { owner, repo, provider } = parseRepoUrl(bucketRepo.repo_url);
    if (provider === 'unknown') {
      return { success: false, error: 'Unsupported repository provider' };
    }
    
    // Remove leading slash from path
    const apiPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    
    if (provider === 'github') {
      // GitHub: Use Contents API
      const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(apiPath)}?ref=${bucketRepo.repo_branch}`;
      const getResponse = await fetch(getUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Jeff-Agent-Builder',
        },
      });
      
      let existingSha: string | undefined;
      if (getResponse.ok) {
        const existingFile = await getResponse.json() as { sha: string };
        existingSha = existingFile.sha;
      } else if (getResponse.status !== 404) {
        const error = await getResponse.json() as { message?: string };
        return { success: false, error: error.message || 'Failed to check existing file' };
      }
      
      const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(apiPath)}`;
      const putResponse = await fetch(putUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Jeff-Agent-Builder',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: commitMessage,
          content: Buffer.from(content).toString('base64'),
          branch: bucketRepo.repo_branch,
          ...(existingSha ? { sha: existingSha } : {}),
        }),
      });
      
      if (!putResponse.ok) {
        const error = await putResponse.json() as { message?: string };
        console.error('[BucketRepo] GitHub push failed:', error);
        return { success: false, error: error.message || 'Failed to push changes' };
      }
      
      const result = await putResponse.json() as { commit?: { sha: string } };
      console.log(`[BucketRepo] Successfully pushed ${filePath} to GitHub ${owner}/${repo}`);
      return { success: true, sha: result.commit?.sha };
      
    } else if (provider === 'gitlab') {
      // GitLab: Use Repository Files API
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const encodedPath = encodeURIComponent(apiPath);
      
      // Check if file exists
      const getUrl = `https://gitlab.com/api/v4/projects/${projectPath}/repository/files/${encodedPath}?ref=${encodeURIComponent(bucketRepo.repo_branch)}`;
      const getResponse = await fetch(getUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'Jeff-Agent-Builder',
        },
      });
      
      const fileExists = getResponse.ok;
      
      // Create or update file
      const fileUrl = `https://gitlab.com/api/v4/projects/${projectPath}/repository/files/${encodedPath}`;
      const method = fileExists ? 'PUT' : 'POST';
      
      const putResponse = await fetch(fileUrl, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'Jeff-Agent-Builder',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          branch: bucketRepo.repo_branch,
          content: content, // GitLab accepts plain text content
          commit_message: commitMessage,
          encoding: 'text', // or 'base64' if sending base64
        }),
      });
      
      if (!putResponse.ok) {
        let errorMessage = 'Failed to push changes';
        try {
          const error = await putResponse.json() as { message?: string; error?: string };
          errorMessage = error.message || error.error || errorMessage;
        } catch {
          // Ignore JSON parse errors
        }
        console.error('[BucketRepo] GitLab push failed:', putResponse.status, errorMessage);
        return { success: false, error: errorMessage };
      }
      
      const result = await putResponse.json() as { file_path?: string; branch?: string };
      console.log(`[BucketRepo] Successfully pushed ${filePath} to GitLab ${owner}/${repo}`);
      return { success: true, sha: result.branch };
    }
    
    return { success: false, error: 'Unsupported provider' };
  } catch (error) {
    console.error('[BucketRepo] Push error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Push failed' };
  }
}
