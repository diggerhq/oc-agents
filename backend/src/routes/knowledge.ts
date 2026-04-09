import { Router, Response, Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';
import { getUserOrgRole, ROLE_HIERARCHY } from '../middleware/orgAuth.js';
import type { OrgRole } from '../types/index.js';
import { extractText } from 'unpdf';
import { withConstraintHandling } from '../utils/dbErrors.js';

// Extend Request to include session with userId
interface AuthenticatedRequest extends Request {
  session: Request['session'] & { userId?: string };
}
import { execute, query, queryOne } from '../db/index.js';
import { downloadFromR2 } from '../services/storage.js';
import {
  isQdrantConfigured,
  createCollection,
  deleteCollection,
  indexDocuments,
  getCollectionInfo,
  collectionExists,
} from '../services/qdrant.js';

const router = Router();

interface KnowledgeBase {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  source_bucket_id: string | null;
  source_folder_path: string;
  collection_name: string;
  status: 'pending' | 'indexing' | 'ready' | 'failed' | 'deleting';
  indexed_files: number;
  indexed_chunks: number;
  last_indexed_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface FileRecord {
  id: string;
  bucket_id: string;
  name: string;
  path: string;
  is_folder: boolean | number;
  mime_type: string | null;
  size: number | null;
  storage_key: string | null;
}

interface Bucket {
  id: string;
  name: string;
}

// Check if Qdrant is configured
router.get('/status', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  res.json({
    configured: isQdrantConfigured(),
    message: isQdrantConfigured() 
      ? 'Qdrant is configured and ready'
      : 'Qdrant is not configured. Set QDRANT_API_KEY and QDRANT_CLUSTER environment variables.',
  });
});

// List all knowledge bases for the user's current organization, filtered by visibility
router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.session.userId!;
    const orgId = (req as any).organizationId;
    
    let knowledgeBases: (KnowledgeBase & { bucket_name?: string })[];
    
    if (!orgId) {
      // Fall back to user's own knowledge bases (no org context)
      knowledgeBases = await query<KnowledgeBase & { bucket_name?: string }>(
        `SELECT kb.*, b.name as bucket_name 
         FROM knowledge_bases kb
         LEFT JOIN buckets b ON kb.source_bucket_id = b.id
         WHERE kb.user_id = $1
         ORDER BY kb.created_at DESC`,
        [userId]
      );
    } else {
      // Get user's role in the org
      const userRole = await getUserOrgRole(userId, orgId);
      if (!userRole) {
        return res.json({ knowledgeBases: [] });
      }
      const userRoleLevel = ROLE_HIERARCHY[userRole];
      
      // Check if this is a personal org (legacy resources only show in personal org)
      const org = await queryOne<{ is_personal: boolean }>('SELECT is_personal FROM organizations WHERE id = $1', [orgId]);
      const isPersonalOrg = org?.is_personal === true;
      
      // Query knowledge bases with visibility filtering
      // Legacy resources (no org_id) only show in personal org
      knowledgeBases = await query<KnowledgeBase & { bucket_name?: string }>(
        `SELECT kb.*, b.name as bucket_name 
         FROM knowledge_bases kb
         LEFT JOIN buckets b ON kb.source_bucket_id = b.id
         LEFT JOIN resource_permissions rp ON rp.resource_type = 'knowledge_base' AND rp.resource_id = kb.id
         WHERE (
           kb.organization_id = $1 
           OR ($4 = true AND kb.organization_id IS NULL AND kb.user_id = $2)
         )
           AND (
             rp.id IS NULL
             OR rp.visibility = 'org'
             OR (rp.visibility = 'private' AND kb.user_id = $2)
             OR (rp.visibility = 'role' AND $3 >= CASE rp.min_role 
               WHEN 'owner' THEN 3 
               WHEN 'admin' THEN 2 
               WHEN 'member' THEN 1 
               ELSE 1 
             END)
           )
         ORDER BY kb.created_at DESC`,
        [orgId, userId, userRoleLevel, isPersonalOrg]
      );
    }
    
    res.json({ knowledgeBases });
  } catch (error) {
    console.error('[Knowledge] List error:', error);
    res.status(500).json({ error: 'Failed to list knowledge bases' });
  }
});

// Get a specific knowledge base
router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.session.userId!;
    
    const kb = await queryOne<KnowledgeBase & { bucket_name?: string }>(
      `SELECT kb.*, b.name as bucket_name 
       FROM knowledge_bases kb
       LEFT JOIN buckets b ON kb.source_bucket_id = b.id
       WHERE kb.id = $1 AND kb.user_id = $2`,
      [id, userId]
    );
    
    if (!kb) {
      return res.status(404).json({ error: 'Knowledge base not found' });
    }
    
    // Get Qdrant collection info if ready
    let collectionInfo = null;
    if (kb.status === 'ready' && isQdrantConfigured()) {
      try {
        collectionInfo = await getCollectionInfo(kb.collection_name);
      } catch {
        // Collection might not exist
      }
    }
    
    res.json({ knowledgeBase: kb, collectionInfo });
  } catch (error) {
    console.error('[Knowledge] Get error:', error);
    res.status(500).json({ error: 'Failed to get knowledge base' });
  }
});

// Create a new knowledge base
router.post('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.session.userId!;
    const orgId = (req as any).organizationId;
    const { name, description, sourceBucketId, sourceFolderPath } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    if (!isQdrantConfigured()) {
      return res.status(400).json({ error: 'Qdrant is not configured' });
    }
    
    // Verify bucket exists and user has access if provided
    if (sourceBucketId) {
      const bucket = await queryOne<Bucket>(
        'SELECT * FROM buckets WHERE id = $1',
        [sourceBucketId]
      );
      if (!bucket) {
        return res.status(404).json({ error: 'Bucket not found' });
      }
      // Check bucket belongs to user or same org
      if (bucket.user_id !== userId && bucket.organization_id !== orgId) {
        return res.status(403).json({ error: 'Access denied to bucket' });
      }
    }
    
    const id = uuidv4();
    const collectionName = `kb_${id.replace(/-/g, '_')}`;
    
    // Set initial status based on whether we have a source bucket to index
    const initialStatus = sourceBucketId ? 'indexing' : 'pending';
    
    // Wrap in constraint handling
    await withConstraintHandling(async () => {
      await execute(
        `INSERT INTO knowledge_bases (id, user_id, organization_id, name, description, source_bucket_id, source_folder_path, collection_name, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, userId, orgId || null, name, description || null, sourceBucketId || null, sourceFolderPath || '/', collectionName, initialStatus]
      );
    }, 'knowledge base');
    
    const kb = await queryOne<KnowledgeBase>(
      'SELECT * FROM knowledge_bases WHERE id = $1',
      [id]
    );
    
    // Auto-index if source bucket is provided
    if (kb && sourceBucketId) {
      console.log(`[Knowledge] Auto-indexing new knowledge base: ${name} (${id})`);
      indexKnowledgeBase(kb, userId).catch(error => {
        console.error('[Knowledge] Auto-indexing error:', error);
      });
    }
    
    res.status(201).json({ knowledgeBase: kb });
  } catch (error: any) {
    if (error.code === 'DUPLICATE_RESOURCE') {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        field: error.field
      });
    }
    console.error('[Knowledge] Create error:', error);
    res.status(500).json({ error: 'Failed to create knowledge base' });
  }
});

// Update a knowledge base
router.patch('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.session.userId!;
    const { name, description, sourceBucketId, sourceFolderPath } = req.body;
    
    const kb = await queryOne<KnowledgeBase>(
      'SELECT * FROM knowledge_bases WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    
    if (!kb) {
      return res.status(404).json({ error: 'Knowledge base not found' });
    }
    
    const updates: string[] = [];
    const values: unknown[] = [];
    const setValue = (column: string, value: unknown) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };
    
    if (name !== undefined) {
      setValue('name', name);
    }
    if (description !== undefined) {
      setValue('description', description || null);
    }
    if (sourceBucketId !== undefined) {
      setValue('source_bucket_id', sourceBucketId || null);
    }
    if (sourceFolderPath !== undefined) {
      setValue('source_folder_path', sourceFolderPath || '/');
    }
    
    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      values.push(id);
      
      await execute(
        `UPDATE knowledge_bases SET ${updates.join(', ')} WHERE id = $${values.length}`,
        values
      );
    }
    
    const updated = await queryOne<KnowledgeBase>(
      'SELECT * FROM knowledge_bases WHERE id = $1',
      [id]
    );
    
    res.json({ knowledgeBase: updated });
  } catch (error) {
    console.error('[Knowledge] Update error:', error);
    res.status(500).json({ error: 'Failed to update knowledge base' });
  }
});

// Delete a knowledge base
router.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.session.userId!;
    
    const kb = await queryOne<KnowledgeBase>(
      'SELECT * FROM knowledge_bases WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    
    if (!kb) {
      return res.status(404).json({ error: 'Knowledge base not found' });
    }
    
    // Update status to deleting
    await execute(
      "UPDATE knowledge_bases SET status = 'deleting', updated_at = NOW() WHERE id = $1",
      [id]
    );
    
    // Delete Qdrant collection if exists
    if (isQdrantConfigured()) {
      try {
        if (await collectionExists(kb.collection_name)) {
          await deleteCollection(kb.collection_name);
        }
      } catch (qdrantError) {
        console.error('[Knowledge] Failed to delete Qdrant collection:', qdrantError);
      }
    }
    
    // Delete from database
    await execute('DELETE FROM knowledge_bases WHERE id = $1', [id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Knowledge] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete knowledge base' });
  }
});

// Index/re-index a knowledge base
router.post('/:id/index', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.session.userId!;
    
    const kb = await queryOne<KnowledgeBase>(
      'SELECT * FROM knowledge_bases WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    
    if (!kb) {
      return res.status(404).json({ error: 'Knowledge base not found' });
    }
    
    if (!kb.source_bucket_id) {
      return res.status(400).json({ error: 'No source bucket configured' });
    }
    
    if (!isQdrantConfigured()) {
      return res.status(400).json({ error: 'Qdrant is not configured' });
    }
    
    // Update status to indexing
    await execute(
      "UPDATE knowledge_bases SET status = 'indexing', error = NULL, updated_at = NOW() WHERE id = $1",
      [id]
    );
    
    // Start indexing in background
    indexKnowledgeBase(kb, userId).catch(error => {
      console.error('[Knowledge] Background indexing error:', error);
    });
    
    res.json({ success: true, message: 'Indexing started' });
  } catch (error) {
    console.error('[Knowledge] Index error:', error);
    res.status(500).json({ error: 'Failed to start indexing' });
  }
});

// Background indexing function
// Processes files one at a time to avoid memory pressure
async function indexKnowledgeBase(kb: KnowledgeBase, userId: string): Promise<void> {
  try {
    console.log(`[Knowledge] Starting indexing for ${kb.name} (${kb.id})`);
    
    // Create or recreate collection
    if (await collectionExists(kb.collection_name)) {
      await deleteCollection(kb.collection_name);
    }
    await createCollection(kb.collection_name);
    
    // Get files from source bucket/folder (text files and PDFs)
    const files = await query<FileRecord>(
      `SELECT * FROM files 
       WHERE bucket_id = $1 
       AND path LIKE $2 
       AND is_folder = $3
       AND (
         mime_type LIKE 'text/%' 
         OR mime_type = 'application/json'
         OR mime_type = 'application/javascript'
         OR mime_type = 'application/xml'
         OR mime_type = 'application/x-yaml'
         OR mime_type = 'application/pdf'
         OR name LIKE '%.md'
         OR name LIKE '%.markdown'
         OR name LIKE '%.txt'
         OR name LIKE '%.json'
         OR name LIKE '%.yaml'
         OR name LIKE '%.yml'
         OR name LIKE '%.pdf'
       )`,
      [kb.source_bucket_id, `${kb.source_folder_path}%`, false]
    );
    
    console.log(`[Knowledge] Found ${files.length} indexable files (text + PDF)`);
    
    if (files.length === 0) {
      await execute(
        `UPDATE knowledge_bases 
         SET status = 'ready', indexed_files = 0, indexed_chunks = 0, last_indexed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [kb.id]
      );
      return;
    }
    
    const totalFiles = files.length;
    let processedFiles = 0;
    let totalChunks = 0;
    let indexedFiles = 0;
    
    // Process files ONE AT A TIME to avoid memory pressure
    // Download -> extract -> embed -> upload -> release memory -> next file
    for (const file of files) {
      if (!file.storage_key) continue;
      
      try {
        const result = await downloadFromR2(file.storage_key, userId);
        if (result.success && result.content) {
          let textContent: string;
          
          // Handle PDF files
          const isPdf = file.mime_type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
          if (isPdf) {
            try {
              // Convert Buffer to Uint8Array for unpdf
              const uint8Array = new Uint8Array(result.content);
              const { text } = await extractText(uint8Array);
              // text can be string or array of strings per page
              textContent = Array.isArray(text) ? text.join('\n') : String(text);
              console.log(`[Knowledge] Extracted ${textContent.length} chars from PDF: ${file.name}`);
            } catch (pdfError) {
              console.error(`[Knowledge] Failed to parse PDF ${file.path}:`, pdfError);
              processedFiles++;
              continue;
            }
          } else {
            textContent = result.content.toString('utf8');
          }
          
          // Index this single document immediately (don't accumulate)
          if (textContent && textContent.trim().length > 0) {
            const { chunks } = await indexDocuments(kb.collection_name, [{
              content: textContent,
              filePath: file.path,
              fileName: file.name,
              knowledgeBaseId: kb.id,
            }]);
            
            totalChunks += chunks;
            indexedFiles++;
          }
          
          // Content is now garbage collected - no accumulation
        }
      } catch (fileError) {
        console.error(`[Knowledge] Failed to process file ${file.path}:`, fileError);
      }
      
      // Update progress every 5 files or at the end
      processedFiles++;
      if (processedFiles % 5 === 0 || processedFiles === totalFiles) {
        await execute(
          'UPDATE knowledge_bases SET indexed_files = $1, indexed_chunks = $2, error = $3 WHERE id = $4',
          [indexedFiles, totalChunks, `Processing ${processedFiles}/${totalFiles} files...`, kb.id]
        );
      }
    }
    
    console.log(`[Knowledge] Indexed ${indexedFiles} documents (${totalChunks} chunks)`);
    
    // Update status - clear error on success
    await execute(
      `UPDATE knowledge_bases 
       SET status = 'ready', indexed_files = $1, indexed_chunks = $2, error = NULL, last_indexed_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [indexedFiles, totalChunks, kb.id]
    );
    
    console.log(`[Knowledge] Indexing complete for ${kb.name}: ${indexedFiles} files, ${totalChunks} chunks`);
  } catch (error) {
    console.error(`[Knowledge] Indexing failed for ${kb.id}:`, error);
    
    await execute(
      'UPDATE knowledge_bases SET status = $1, error = $2, updated_at = NOW() WHERE id = $3',
      ['failed', error instanceof Error ? error.message : String(error), kb.id]
    );
  }
}

// Get agent's attached knowledge bases
router.get('/agents/:sessionId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.session.userId!;
    
    // Verify agent belongs to user
    const session = await queryOne<{ id: string }>(
      'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const knowledgeBases = await query<KnowledgeBase & { bucket_name?: string }>(
      `SELECT kb.*, b.name as bucket_name
       FROM agent_knowledge_bases akb
       JOIN knowledge_bases kb ON akb.knowledge_base_id = kb.id
       LEFT JOIN buckets b ON kb.source_bucket_id = b.id
       WHERE akb.session_id = $1`,
      [sessionId]
    );
    
    res.json({ knowledgeBases });
  } catch (error) {
    console.error('[Knowledge] Get agent knowledge bases error:', error);
    res.status(500).json({ error: 'Failed to get agent knowledge bases' });
  }
});

// Attach knowledge base to agent
router.post('/agents/:sessionId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { knowledgeBaseId } = req.body;
    const userId = req.session.userId!;
    
    if (!knowledgeBaseId) {
      return res.status(400).json({ error: 'knowledgeBaseId is required' });
    }
    
    // Verify agent belongs to user
    const session = await queryOne<{ id: string }>(
      'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Verify knowledge base belongs to user
    const kb = await queryOne<KnowledgeBase>(
      'SELECT * FROM knowledge_bases WHERE id = $1 AND user_id = $2',
      [knowledgeBaseId, userId]
    );
    
    if (!kb) {
      return res.status(404).json({ error: 'Knowledge base not found' });
    }
    
    // Create association
    const id = uuidv4();
    await execute(
      `INSERT INTO agent_knowledge_bases (id, session_id, knowledge_base_id) VALUES ($1, $2, $3)
       ON CONFLICT (session_id, knowledge_base_id) DO NOTHING`,
      [id, sessionId, knowledgeBaseId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Knowledge] Attach error:', error);
    res.status(500).json({ error: 'Failed to attach knowledge base' });
  }
});

// Detach knowledge base from agent
router.delete('/agents/:sessionId/:knowledgeBaseId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId, knowledgeBaseId } = req.params;
    const userId = req.session.userId!;
    
    // Verify agent belongs to user
    const session = await queryOne<{ id: string }>(
      'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    await execute(
      'DELETE FROM agent_knowledge_bases WHERE session_id = $1 AND knowledge_base_id = $2',
      [sessionId, knowledgeBaseId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Knowledge] Detach error:', error);
    res.status(500).json({ error: 'Failed to detach knowledge base' });
  }
});

export default router;
