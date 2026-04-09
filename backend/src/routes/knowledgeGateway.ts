/**
 * Knowledge Base Gateway API
 * 
 * Allows Claude Code in E2B sandboxes to query knowledge bases via REST.
 * The sandbox can't access Qdrant directly, so this proxies the requests.
 * 
 * Security: URLs are HMAC-signed to prevent unauthorized access.
 * 
 * Usage from sandbox:
 *   curl -s "https://oshu.dev/api/kb-gateway/search?agentId=xxx&sig=SIGNATURE&query=how+to+authenticate"
 */

import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/index.js';
import { searchDocuments } from '../services/qdrant.js';
import { verifyGatewaySignature } from '../services/oc.js';
import { logEvent } from '../services/analytics.js';

const router = Router();

// Middleware to verify gateway signature
function verifySignature(req: Request, res: Response, next: Function) {
  const { agentId, sig } = req.query;
  
  if (!agentId || !sig) {
    return res.status(400).json({ success: false, error: 'agentId and sig are required' });
  }
  
  try {
    if (!verifyGatewaySignature(agentId as string, sig as string)) {
      console.warn(`[KB Gateway] Invalid signature for agentId: ${agentId}`);
      return res.status(403).json({ success: false, error: 'Invalid signature' });
    }
  } catch (error) {
    console.error(`[KB Gateway] Signature verification error:`, error);
    return res.status(403).json({ success: false, error: 'Invalid signature' });
  }
  
  next();
}

interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  collection_name: string;
  status: string;
  indexed_files: number;
  indexed_chunks: number;
}

interface AgentKnowledgeBase {
  session_id: string;  // session_id is the agent ID
  knowledge_base_id: string;
}

/**
 * List knowledge bases attached to an agent
 * 
 * GET /api/kb-gateway/list?agentId=xxx&sig=SIGNATURE
 */
router.get('/list', verifySignature, async (req: Request, res: Response) => {
  const { agentId } = req.query;

  try {
    // Get attached knowledge bases
    const attachments = await query<AgentKnowledgeBase>(
      'SELECT * FROM agent_knowledge_bases WHERE session_id = $1',
      [agentId as string]
    );

    if (attachments.length === 0) {
      return res.json({ success: true, knowledgeBases: [] });
    }

    const kbIds = attachments.map(a => a.knowledge_base_id);
    
    const knowledgeBases = await query<KnowledgeBase>(
      `SELECT id, name, description, collection_name, status, indexed_files, indexed_chunks 
       FROM knowledge_bases 
       WHERE id = ANY($1::text[]) AND status = 'ready'`,
      [kbIds]
    );

    res.json({ 
      success: true, 
      knowledgeBases: knowledgeBases.map(kb => ({
        id: kb.id,
        name: kb.name,
        description: kb.description,
        files: kb.indexed_files,
        chunks: kb.indexed_chunks,
      }))
    });
  } catch (error) {
    console.error('[KB Gateway] Error listing knowledge bases:', error);
    res.status(500).json({ success: false, error: 'Failed to list knowledge bases' });
  }
});

/**
 * Search knowledge bases for relevant content
 * 
 * GET /api/kb-gateway/search?agentId=xxx&sig=SIGNATURE&query=your+search+query&limit=5
 * 
 * Returns the most relevant chunks from all attached knowledge bases.
 */
router.get('/search', verifySignature, async (req: Request, res: Response) => {
  const { agentId, query: searchQuery, limit = '5' } = req.query;

  if (!searchQuery) {
    return res.status(400).json({ success: false, error: 'query is required' });
  }

  const limitNum = Math.min(parseInt(limit as string) || 5, 20); // Max 20 results

  try {
    // Get attached knowledge bases
    const attachments = await query<AgentKnowledgeBase>(
      'SELECT * FROM agent_knowledge_bases WHERE session_id = $1',
      [agentId as string]
    );

    if (attachments.length === 0) {
      return res.json({ 
        success: true, 
        results: [],
        message: 'No knowledge bases attached to this agent'
      });
    }

    const kbIds = attachments.map(a => a.knowledge_base_id);
    
    const knowledgeBases = await query<KnowledgeBase>(
      `SELECT * FROM knowledge_bases WHERE id = ANY($1::text[]) AND status = 'ready'`,
      [kbIds]
    );

    if (knowledgeBases.length === 0) {
      return res.json({ 
        success: true, 
        results: [],
        message: 'No ready knowledge bases found'
      });
    }

    // Search each knowledge base and combine results
    const allResults: Array<{
      knowledgeBase: string;
      content: string;
      source: string;
      score: number;
    }> = [];

    for (const kb of knowledgeBases) {
      try {
        const results = await searchDocuments(
          kb.collection_name,
          searchQuery as string,
          limitNum
        );

        for (const result of results) {
          allResults.push({
            knowledgeBase: kb.name,
            content: result.payload?.text || '',
            source: result.payload?.file_path || 'unknown',
            score: result.score,
          });
        }
      } catch (searchError) {
        console.error(`[KB Gateway] Error searching ${kb.name}:`, searchError);
        // Continue with other knowledge bases
      }
    }

    // Sort by score and limit
    allResults.sort((a, b) => b.score - a.score);
    const topResults = allResults.slice(0, limitNum);
    
    // Log KB search event for analytics
    logEvent({
      agentId: agentId as string,
      eventType: 'kb_search',
      source: 'api',
      success: topResults.length > 0,
      metadata: {
        query: (searchQuery as string).slice(0, 200), // Truncate long queries
        resultsCount: topResults.length,
        topScore: topResults[0]?.score || 0,
        topDocument: topResults[0]?.source || null,
        knowledgeBasesSearched: knowledgeBases.length,
      },
    });

    res.json({ 
      success: true, 
      query: searchQuery,
      results: topResults,
      totalKnowledgeBases: knowledgeBases.length,
    });
  } catch (error) {
    console.error('[KB Gateway] Error searching:', error);
    
    // Log error event
    logEvent({
      agentId: agentId as string,
      eventType: 'kb_search',
      source: 'api',
      success: false,
      errorMessage: String(error),
      metadata: { query: (searchQuery as string).slice(0, 200) },
    });
    
    res.status(500).json({ success: false, error: 'Failed to search knowledge bases' });
  }
});

/**
 * POST version of search (for longer queries)
 * 
 * POST /api/kb-gateway/search
 * Body: { agentId: string, sig: string, query: string, limit?: number }
 */
router.post('/search', async (req: Request, res: Response) => {
  const { agentId, sig, query: searchQuery, limit = 5 } = req.body;

  if (!agentId || !sig) {
    return res.status(400).json({ success: false, error: 'agentId and sig are required' });
  }

  try {
    if (!verifyGatewaySignature(agentId, sig)) {
      console.warn(`[KB Gateway] Invalid signature for agentId: ${agentId}`);
      return res.status(403).json({ success: false, error: 'Invalid signature' });
    }
  } catch (error) {
    return res.status(403).json({ success: false, error: 'Invalid signature' });
  }

  if (!searchQuery) {
    return res.status(400).json({ success: false, error: 'query is required' });
  }

  const limitNum = Math.min(limit || 5, 20);

  try {
    const attachments = await query<AgentKnowledgeBase>(
      'SELECT * FROM agent_knowledge_bases WHERE session_id = $1',
      [agentId]
    );

    if (attachments.length === 0) {
      return res.json({ 
        success: true, 
        results: [],
        message: 'No knowledge bases attached to this agent'
      });
    }

    const kbIds = attachments.map(a => a.knowledge_base_id);
    
    const knowledgeBases = await query<KnowledgeBase>(
      `SELECT * FROM knowledge_bases WHERE id = ANY($1::text[]) AND status = 'ready'`,
      [kbIds]
    );

    const allResults: Array<{
      knowledgeBase: string;
      content: string;
      source: string;
      score: number;
    }> = [];

    for (const kb of knowledgeBases) {
      try {
        const results = await searchDocuments(
          kb.collection_name,
          searchQuery,
          limitNum
        );

        for (const result of results) {
          allResults.push({
            knowledgeBase: kb.name,
            content: result.payload?.text || '',
            source: result.payload?.file_path || 'unknown',
            score: result.score,
          });
        }
      } catch (searchError) {
        console.error(`[KB Gateway] Error searching ${kb.name}:`, searchError);
      }
    }

    allResults.sort((a, b) => b.score - a.score);
    const topResults = allResults.slice(0, limitNum);
    
    // Log KB search event for analytics
    logEvent({
      agentId,
      eventType: 'kb_search',
      source: 'api',
      success: topResults.length > 0,
      metadata: {
        query: searchQuery.slice(0, 200),
        resultsCount: topResults.length,
        topScore: topResults[0]?.score || 0,
        topDocument: topResults[0]?.source || null,
        knowledgeBasesSearched: knowledgeBases.length,
      },
    });

    res.json({ 
      success: true, 
      query: searchQuery,
      results: topResults,
      totalKnowledgeBases: knowledgeBases.length,
    });
  } catch (error) {
    console.error('[KB Gateway] Error searching:', error);
    
    logEvent({
      agentId,
      eventType: 'kb_search',
      source: 'api',
      success: false,
      errorMessage: String(error),
      metadata: { query: searchQuery.slice(0, 200) },
    });
    
    res.status(500).json({ success: false, error: 'Failed to search knowledge bases' });
  }
});

export default router;
