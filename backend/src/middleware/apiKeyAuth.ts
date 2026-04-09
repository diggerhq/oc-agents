import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { queryOne, execute } from '../db/index.js';
import type { ApiKey } from '../types/index.js';

// Extend Request to include API key info
declare global {
  namespace Express {
    interface Request {
      apiKey?: ApiKey;
      apiUserId?: string;
    }
  }
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'API key required. Use Authorization: Bearer flt_xxx' });
  }
  
  const key = authHeader.slice(7); // Remove 'Bearer '
  
  if (!key.startsWith('flt_')) {
    return res.status(401).json({ error: 'Invalid API key format' });
  }
  
  // Hash the provided key and look it up
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  
  const apiKey = await queryOne<ApiKey>(
    'SELECT * FROM api_keys WHERE key_hash = $1',
    [keyHash]
  );
  
  if (!apiKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  // Update last used timestamp
  await execute(
    'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
    [apiKey.id]
  );
  
  // Attach to request
  req.apiKey = apiKey;
  req.apiUserId = apiKey.user_id;
  
  next();
}
