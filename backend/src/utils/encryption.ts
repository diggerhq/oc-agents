/**
 * Simple encryption utilities for sensitive data at rest
 * Uses AES-256-GCM for authenticated encryption
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get the encryption key from environment
 * Key should be a 64-character hex string (32 bytes)
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  
  if (!key) {
    console.warn('[Encryption] ENCRYPTION_KEY not set - tokens will be stored in plain text');
    return Buffer.alloc(0);
  }
  
  if (key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  
  return Buffer.from(key, 'hex');
}

/**
 * Encrypt a string value
 * Returns base64 encoded string: iv + authTag + ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  
  // If no key, return plaintext (for backwards compatibility)
  if (key.length === 0) {
    return plaintext;
  }
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  const authTag = cipher.getAuthTag();
  
  // Combine: iv (16) + authTag (16) + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);
  
  return combined.toString('base64');
}

/**
 * Decrypt a string value
 * Expects base64 encoded string: iv + authTag + ciphertext
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  
  // If no key, assume plaintext (for backwards compatibility)
  if (key.length === 0) {
    return ciphertext;
  }
  
  // Check if it looks like encrypted data (base64 with minimum length)
  // Minimum: 16 (iv) + 16 (authTag) + 1 (at least 1 byte ciphertext) = 33 bytes = 44+ base64 chars
  if (ciphertext.length < 44 || !/^[A-Za-z0-9+/=]+$/.test(ciphertext)) {
    // Looks like plaintext, return as-is (migration compatibility)
    return ciphertext;
  }
  
  try {
    const combined = Buffer.from(ciphertext, 'base64');
    
    // Ensure minimum length
    if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
      return ciphertext; // Not encrypted, return as-is
    }
    
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    // If decryption fails, assume it's plaintext (migration compatibility)
    console.warn('[Encryption] Decryption failed, assuming plaintext');
    return ciphertext;
  }
}

/**
 * Check if encryption is configured
 */
export function isEncryptionConfigured(): boolean {
  return !!process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length === 64;
}
