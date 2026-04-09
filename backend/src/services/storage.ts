import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable, PassThrough } from 'stream';
import { queryOne } from '../db/index.js';
import type { UserStorageConfig } from '../types/index.js';

// ============================================
// STORAGE PROVIDER CONFIGURATION (SYSTEM-LEVEL)
// ============================================

// Cloudflare R2 configuration
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

// AWS S3 configuration
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Generic S3-compatible configuration (for MinIO, Backblaze B2, DigitalOcean Spaces, etc.)
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.S3_REGION || 'auto';

type StorageProvider = 'r2' | 's3' | 's3-compatible' | 'database' | 'user-config';

// ============================================
// USER-SPECIFIC STORAGE CONFIG
// ============================================

/**
 * Get user's storage configuration from the database
 */
export const getUserStorageConfig = async (userId: string): Promise<UserStorageConfig | null> => {
  const config = await queryOne<UserStorageConfig>(
    'SELECT * FROM user_storage_configs WHERE user_id = $1 AND is_active = $2',
    [userId, true]
  );
  return config || null;
};

/**
 * Create S3 client from user's storage config
 */
const getS3ClientForUser = (config: UserStorageConfig): S3Client => {
  switch (config.provider) {
    case 'r2':
      // For R2, endpoint is required (includes account ID)
      return new S3Client({
        region: 'auto',
        endpoint: config.endpoint,
        credentials: {
          accessKeyId: config.access_key_id,
          secretAccessKey: config.secret_access_key,
        },
      });
      
    case 's3':
      return new S3Client({
        region: config.region || 'us-east-1',
        credentials: {
          accessKeyId: config.access_key_id,
          secretAccessKey: config.secret_access_key,
        },
      });
      
    case 's3-compatible':
      return new S3Client({
        region: config.region || 'auto',
        endpoint: config.endpoint,
        credentials: {
          accessKeyId: config.access_key_id,
          secretAccessKey: config.secret_access_key,
        },
        forcePathStyle: true,
      });
      
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
};

// ============================================
// SYSTEM-LEVEL STORAGE DETECTION
// ============================================

/**
 * Detect which system-level storage provider is configured
 */
export const getStorageProvider = (): StorageProvider => {
  // Check for Cloudflare R2
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME) {
    return 'r2';
  }
  
  // Check for AWS S3
  if (AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY && AWS_S3_BUCKET) {
    return 's3';
  }
  
  // Check for generic S3-compatible storage
  if (S3_ENDPOINT && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY && S3_BUCKET) {
    return 's3-compatible';
  }
  
  // Fallback to database storage
  return 'database';
};

/**
 * Check if system-level object storage is configured
 */
export const isObjectStorageConfigured = (): boolean => {
  return getStorageProvider() !== 'database';
};

// Backwards compatibility alias
export const isR2Configured = isObjectStorageConfigured;

/**
 * Get the system-level bucket name
 */
const getSystemBucketName = (): string => {
  const provider = getStorageProvider();
  switch (provider) {
    case 'r2':
      return R2_BUCKET_NAME!;
    case 's3':
      return AWS_S3_BUCKET!;
    case 's3-compatible':
      return S3_BUCKET!;
    default:
      return '';
  }
};

/**
 * Create S3 client for system-level storage
 */
const getSystemS3Client = (): S3Client | null => {
  const provider = getStorageProvider();
  
  switch (provider) {
    case 'r2':
      return new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: R2_ACCESS_KEY_ID!,
          secretAccessKey: R2_SECRET_ACCESS_KEY!,
        },
      });
      
    case 's3':
      return new S3Client({
        region: AWS_REGION,
        credentials: {
          accessKeyId: AWS_ACCESS_KEY_ID!,
          secretAccessKey: AWS_SECRET_ACCESS_KEY!,
        },
      });
      
    case 's3-compatible':
      return new S3Client({
        region: S3_REGION,
        endpoint: S3_ENDPOINT,
        credentials: {
          accessKeyId: S3_ACCESS_KEY_ID!,
          secretAccessKey: S3_SECRET_ACCESS_KEY!,
        },
        forcePathStyle: true,
      });
      
    default:
      return null;
  }
};

// ============================================
// STORAGE OPERATIONS (WITH USER-CONFIG SUPPORT)
// ============================================

/**
 * Generate a storage key for a file
 * Format: {userId}/{bucketId}/{path/to/filename}
 * This preserves the folder structure from the UI so agents see friendly paths
 */
export const generateStorageKey = (userId: string, bucketId: string, filePath: string): string => {
  // filePath is like "/hello.txt" or "/test/TerminalOutPut.txt"
  // Remove leading slash and use as-is to preserve folder structure
  const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  return `${userId}/${bucketId}/${cleanPath}`;
};

/**
 * Get S3 client and bucket - checks user config first, then system config
 */
const getClientAndBucket = async (userId?: string): Promise<{ client: S3Client | null; bucket: string; isUserConfig: boolean }> => {
  // First, check if user has their own storage config
  if (userId) {
    const userConfig = await getUserStorageConfig(userId);
    if (userConfig) {
      return {
        client: getS3ClientForUser(userConfig),
        bucket: userConfig.bucket_name,
        isUserConfig: true,
      };
    }
  }
  
  // Fall back to system-level config
  return {
    client: getSystemS3Client(),
    bucket: getSystemBucketName(),
    isUserConfig: false,
  };
};

/**
 * Upload a file to object storage (buffer version)
 */
export const uploadToR2 = async (
  storageKey: string,
  content: Buffer,
  contentType: string,
  userId?: string
): Promise<{ success: boolean; error?: string }> => {
  const { client, bucket } = await getClientAndBucket(userId);
  
  if (!client) {
    return { success: false, error: 'Object storage not configured' };
  }
  
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: content,
      ContentType: contentType,
    }));
    
    return { success: true };
  } catch (error: any) {
    console.error(`[Storage] Upload error:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Stream upload a file to object storage
 * Uses multipart upload for memory efficiency with large files
 */
export const streamUploadToR2 = async (
  storageKey: string,
  stream: Readable,
  contentType: string,
  userId?: string,
  contentLength?: number
): Promise<{ success: boolean; size?: number; error?: string }> => {
  const { client, bucket } = await getClientAndBucket(userId);
  
  if (!client) {
    return { success: false, error: 'Object storage not configured' };
  }
  
  try {
    // Use multipart upload for streaming - handles large files efficiently
    const upload = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: storageKey,
        Body: stream,
        ContentType: contentType,
        ...(contentLength ? { ContentLength: contentLength } : {}),
      },
      // 5MB part size (minimum for S3)
      partSize: 5 * 1024 * 1024,
      // Upload up to 4 parts concurrently
      queueSize: 4,
    });
    
    await upload.done();
    
    return { success: true, size: contentLength };
  } catch (error: any) {
    console.error(`[Storage] Stream upload error:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Download a file from object storage (buffer version)
 * Use streamDownloadFromR2 for large files to avoid memory issues
 */
export const downloadFromR2 = async (
  storageKey: string,
  userId?: string
): Promise<{ success: boolean; content?: Buffer; contentType?: string; error?: string }> => {
  const { client, bucket } = await getClientAndBucket(userId);
  
  if (!client) {
    return { success: false, error: 'Object storage not configured' };
  }
  
  try {
    const response = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: storageKey,
    }));
    
    // Convert stream to buffer
    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];
    
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    
    return {
      success: true,
      content: Buffer.concat(chunks),
      contentType: response.ContentType,
    };
  } catch (error: any) {
    console.error(`[Storage] Download error:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Stream download a file from object storage
 * Returns a readable stream instead of buffering the entire file
 */
export const streamDownloadFromR2 = async (
  storageKey: string,
  userId?: string
): Promise<{ success: boolean; stream?: Readable; contentType?: string; contentLength?: number; error?: string }> => {
  const { client, bucket } = await getClientAndBucket(userId);
  
  if (!client) {
    return { success: false, error: 'Object storage not configured' };
  }
  
  try {
    const response = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: storageKey,
    }));
    
    return {
      success: true,
      stream: response.Body as Readable,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
    };
  } catch (error: any) {
    console.error(`[Storage] Stream download error:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Delete a file from object storage
 */
export const deleteFromR2 = async (
  storageKey: string,
  userId?: string
): Promise<{ success: boolean; error?: string }> => {
  const { client, bucket } = await getClientAndBucket(userId);
  
  if (!client) {
    return { success: false, error: 'Object storage not configured' };
  }
  
  try {
    await client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: storageKey,
    }));
    
    return { success: true };
  } catch (error: any) {
    console.error(`[Storage] Delete error:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Check if a file exists in object storage
 */
export const existsInR2 = async (
  storageKey: string,
  userId?: string
): Promise<{ exists: boolean; size?: number; error?: string }> => {
  const { client, bucket } = await getClientAndBucket(userId);
  
  if (!client) {
    return { exists: false, error: 'Object storage not configured' };
  }
  
  try {
    const response = await client.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: storageKey,
    }));
    
    return {
      exists: true,
      size: response.ContentLength,
    };
  } catch (error: any) {
    if (error.name === 'NotFound') {
      return { exists: false };
    }
    console.error(`[Storage] Exists check error:`, error);
    return { exists: false, error: error.message };
  }
};

/**
 * Generate a signed URL for a file in object storage
 * Used for Microsoft Office Online viewer and other external services
 * 
 * @param storageKey - The storage key (path) of the file
 * @param userId - Optional user ID for user-specific storage
 * @param expiresIn - URL expiration time in seconds (default 1 hour)
 * @returns Object with signed URL or error
 */
export const getSignedUrlForFile = async (
  storageKey: string,
  userId?: string,
  expiresIn: number = 3600
): Promise<{ success: boolean; url?: string; error?: string }> => {
  const { client, bucket } = await getClientAndBucket(userId);
  
  if (!client) {
    return { success: false, error: 'Object storage not configured' };
  }
  
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: storageKey,
    });
    
    const url = await getSignedUrl(client, command, { expiresIn });
    
    return { success: true, url };
  } catch (error: any) {
    console.error(`[Storage] Signed URL generation error:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Delete multiple files from object storage (for folder deletion)
 */
export const deleteMultipleFromR2 = async (
  storageKeys: string[],
  userId?: string
): Promise<{ success: boolean; failed: string[] }> => {
  const failed: string[] = [];
  
  for (const key of storageKeys) {
    const result = await deleteFromR2(key, userId);
    if (!result.success) {
      failed.push(key);
    }
  }
  
  return {
    success: failed.length === 0,
    failed,
  };
};

/**
 * Test connection to storage provider
 */
export const testStorageConnection = async (
  config: {
    provider: 's3' | 'r2' | 's3-compatible';
    bucket_name: string;
    region?: string;
    endpoint?: string;
    access_key_id: string;
    secret_access_key: string;
  }
): Promise<{ success: boolean; error?: string }> => {
  try {
    const client = getS3ClientForUser(config as UserStorageConfig);
    
    // Try to list objects (limited to 1) to test connection
    const testKey = `_connection_test_${Date.now()}`;
    
    // Try to put a small test object
    await client.send(new PutObjectCommand({
      Bucket: config.bucket_name,
      Key: testKey,
      Body: 'test',
      ContentType: 'text/plain',
    }));
    
    // Clean up - delete the test object
    await client.send(new DeleteObjectCommand({
      Bucket: config.bucket_name,
      Key: testKey,
    }));
    
    return { success: true };
  } catch (error: any) {
    console.error('[Storage] Connection test failed:', error);
    return { 
      success: false, 
      error: error.message || 'Connection failed' 
    };
  }
};

/**
 * Get storage info for API response
 */
export const getStorageInfo = async (userId?: string) => {
  // Check user config first
  if (userId) {
    const userConfig = await getUserStorageConfig(userId);
    if (userConfig) {
      return {
        provider: 'user-config',
        configured: true,
        backend: userConfig.provider === 'r2' ? 'cloudflare-r2' :
                 userConfig.provider === 's3' ? 'aws-s3' : 
                 's3-compatible',
        bucket: userConfig.bucket_name,
        isUserOwned: true,
        testStatus: userConfig.test_status,
        maxFileSize: 100 * 1024 * 1024,
        maxFilesPerUpload: 10,
      };
    }
  }
  
  // Fall back to system config
  const provider = getStorageProvider();
  
  return {
    provider,
    configured: provider !== 'database',
    backend: provider === 'database' ? 'database' : 
             provider === 'r2' ? 'cloudflare-r2' :
             provider === 's3' ? 'aws-s3' : 
             's3-compatible',
    bucket: provider !== 'database' ? getSystemBucketName() : null,
    isUserOwned: false,
    maxFileSize: 100 * 1024 * 1024,
    maxFilesPerUpload: 10,
  };
};

/**
 * Check if storage is configured for a user (either user-owned or system-level)
 */
export const isStorageConfiguredForUser = async (userId: string): Promise<boolean> => {
  const userConfig = await getUserStorageConfig(userId);
  if (userConfig) return true;
  return isObjectStorageConfigured();
};

/**
 * Get S3 mount configuration for a user (for s3fs mounting in sandbox)
 * Returns credentials and endpoint info needed to mount their storage
 */
export interface S3MountConfig {
  provider: 'r2' | 's3' | 's3-compatible';
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  region?: string;
}

export const getS3MountConfig = async (userId: string): Promise<S3MountConfig | null> => {
  // Check user's own storage config first
  const userConfig = await getUserStorageConfig(userId);
  if (userConfig) {
    return {
      provider: userConfig.provider as 'r2' | 's3' | 's3-compatible',
      bucketName: userConfig.bucket_name,
      accessKeyId: userConfig.access_key_id,
      secretAccessKey: userConfig.secret_access_key,
      endpoint: userConfig.endpoint || undefined,
      region: userConfig.region || undefined,
    };
  }

  // Fall back to system-level storage
  const systemProvider = getStorageProvider();
  
  if (systemProvider === 'r2') {
    return {
      provider: 'r2',
      bucketName: R2_BUCKET_NAME!,
      accessKeyId: R2_ACCESS_KEY_ID!,
      secretAccessKey: R2_SECRET_ACCESS_KEY!,
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    };
  }
  
  if (systemProvider === 's3') {
    return {
      provider: 's3',
      bucketName: AWS_S3_BUCKET!,
      accessKeyId: AWS_ACCESS_KEY_ID!,
      secretAccessKey: AWS_SECRET_ACCESS_KEY!,
      region: AWS_REGION,
    };
  }
  
  if (systemProvider === 's3-compatible') {
    return {
      provider: 's3-compatible',
      bucketName: S3_BUCKET!,
      accessKeyId: S3_ACCESS_KEY_ID!,
      secretAccessKey: S3_SECRET_ACCESS_KEY!,
      endpoint: S3_ENDPOINT!,
      region: S3_REGION,
    };
  }
  
  // No object storage configured
  return null;
};
