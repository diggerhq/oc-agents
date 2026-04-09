import { v4 as uuidv4 } from 'uuid';

const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const QDRANT_CLUSTER = process.env.QDRANT_CLUSTER;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// OpenAI text-embedding-3-small: 1536 dimensions, fast and cost-effective
const EMBEDDING_DIMENSIONS = 1536;
const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

// Check if OpenAI embeddings are available
function useOpenAI(): boolean {
  return Boolean(OPENAI_API_KEY);
}

// Generate embedding using OpenAI API
async function generateOpenAIEmbedding(text: string): Promise<number[]> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI embedding request failed: ${response.status} - ${error}`);
  }

  const data = await response.json() as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

// Generate embeddings for multiple texts using OpenAI (batched)
async function generateOpenAIEmbeddings(texts: string[]): Promise<number[][]> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  // OpenAI supports batch embedding
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI embedding request failed: ${response.status} - ${error}`);
  }

  const data = await response.json() as { data: Array<{ embedding: number[]; index: number }> };
  
  // Sort by index to maintain order
  const sorted = data.data.sort((a, b) => a.index - b.index);
  return sorted.map(d => d.embedding);
}

interface QdrantPoint {
  id: string;
  vector: number[];
  payload: {
    text: string;
    file_path: string;
    file_name: string;
    chunk_index: number;
    knowledge_base_id: string;
    metadata?: Record<string, unknown>;
  };
}

interface SearchResult {
  id: string;
  score: number;
  payload: {
    text: string;
    file_path: string;
    file_name: string;
    chunk_index: number;
  };
}

// Check if Qdrant is configured
export function isQdrantConfigured(): boolean {
  return Boolean(QDRANT_API_KEY && QDRANT_CLUSTER);
}

// Get Qdrant base URL
function getQdrantUrl(): string {
  if (!QDRANT_CLUSTER) {
    throw new Error('QDRANT_CLUSTER not configured');
  }
  return QDRANT_CLUSTER;
}

// Make authenticated request to Qdrant
async function qdrantRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  if (!QDRANT_API_KEY) {
    throw new Error('QDRANT_API_KEY not configured');
  }

  const url = `${getQdrantUrl()}${path}`;
  
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'api-key': QDRANT_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Qdrant request failed: ${response.status} - ${error}`);
  }

  return response.json();
}

// Create a collection for a knowledge base
export async function createCollection(collectionName: string): Promise<void> {
  console.log(`[Qdrant] Creating collection: ${collectionName}`);
  
  await qdrantRequest('PUT', `/collections/${collectionName}`, {
    vectors: {
      size: EMBEDDING_DIMENSIONS,
      distance: 'Cosine',
    },
  });
  
  console.log(`[Qdrant] Collection created: ${collectionName}`);
}

// Delete a collection
export async function deleteCollection(collectionName: string): Promise<void> {
  console.log(`[Qdrant] Deleting collection: ${collectionName}`);
  
  await qdrantRequest('DELETE', `/collections/${collectionName}`);
  
  console.log(`[Qdrant] Collection deleted: ${collectionName}`);
}

// Check if collection exists
export async function collectionExists(collectionName: string): Promise<boolean> {
  try {
    await qdrantRequest('GET', `/collections/${collectionName}`);
    return true;
  } catch {
    return false;
  }
}

// Generate embedding using OpenAI
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!useOpenAI()) {
    throw new Error('OPENAI_API_KEY not configured - embeddings require OpenAI');
  }
  return generateOpenAIEmbedding(text);
}

// Generate embeddings for multiple texts (batched)
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!useOpenAI()) {
    throw new Error('OPENAI_API_KEY not configured - embeddings require OpenAI');
  }
  
  // OpenAI has a limit of ~8000 tokens per batch, so we batch by count
  const batchSize = 100; // Safe batch size for OpenAI
  const embeddings: number[][] = [];
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchEmbeddings = await generateOpenAIEmbeddings(batch);
    embeddings.push(...batchEmbeddings);
    
    if (i + batchSize < texts.length) {
      console.log(`[Qdrant] Embedded ${Math.min(i + batchSize, texts.length)}/${texts.length} chunks`);
    }
  }
  
  return embeddings;
}

// Split text into chunks
export function chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    let end = start + chunkSize;
    
    // Try to break at a sentence or paragraph boundary
    if (end < text.length) {
      const breakPoints = ['\n\n', '\n', '. ', '! ', '? '];
      for (const breakPoint of breakPoints) {
        const breakIndex = text.lastIndexOf(breakPoint, end);
        if (breakIndex > start + chunkSize / 2) {
          end = breakIndex + breakPoint.length;
          break;
        }
      }
    }
    
    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
    
    // Prevent infinite loop
    if (start >= text.length - 1) break;
  }
  
  return chunks.filter(c => c.length > 0);
}

// Index documents into a collection
// Processes documents one at a time to avoid memory pressure
export async function indexDocuments(
  collectionName: string,
  documents: Array<{
    content: string;
    filePath: string;
    fileName: string;
    knowledgeBaseId: string;
    metadata?: Record<string, unknown>;
  }>,
  chunkSize: number = 1000
): Promise<{ indexed: number; chunks: number }> {
  console.log(`[Qdrant] Indexing ${documents.length} documents into ${collectionName}`);
  
  let totalChunks = 0;
  const EMBEDDING_BATCH_SIZE = 10;  // Batch for embedding API calls
  const UPLOAD_BATCH_SIZE = 100;    // Batch for Qdrant uploads
  
  // Process each document individually to avoid memory accumulation
  for (let docIdx = 0; docIdx < documents.length; docIdx++) {
    const doc = documents[docIdx];
    const chunks = chunkText(doc.content, chunkSize);
    
    console.log(`[Qdrant] Processing document ${docIdx + 1}/${documents.length}: ${doc.fileName} (${chunks.length} chunks)`);
    
    // Process chunks in batches, upload immediately after embedding
    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
      const chunkBatch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
      const embeddings = await generateEmbeddings(chunkBatch);
      
      // Build points for this batch
      const points: QdrantPoint[] = [];
      for (let j = 0; j < chunkBatch.length; j++) {
        points.push({
          id: uuidv4(),
          vector: embeddings[j],
          payload: {
            text: chunkBatch[j],
            file_path: doc.filePath,
            file_name: doc.fileName,
            chunk_index: i + j,
            knowledge_base_id: doc.knowledgeBaseId,
            metadata: doc.metadata,
          },
        });
      }
      
      // Upload this batch immediately (don't accumulate)
      await qdrantRequest('PUT', `/collections/${collectionName}/points`, {
        points,
      });
      
      totalChunks += points.length;
    }
    
    console.log(`[Qdrant] Completed document ${docIdx + 1}/${documents.length}, total chunks so far: ${totalChunks}`);
  }
  
  console.log(`[Qdrant] Indexed ${documents.length} documents (${totalChunks} chunks) into ${collectionName}`);
  
  return { indexed: documents.length, chunks: totalChunks };
}

// Search for similar documents
export async function searchDocuments(
  collectionName: string,
  query: string,
  limit: number = 5,
  scoreThreshold: number = 0.3
): Promise<SearchResult[]> {
  console.log(`[Qdrant] Searching ${collectionName}: "${query.slice(0, 50)}..."`);
  
  // Check collection point count first
  try {
    const info = await qdrantRequest('GET', `/collections/${collectionName}`) as { result: { points_count: number } };
    console.log(`[Qdrant] Collection ${collectionName} has ${info.result.points_count} points`);
  } catch (e) {
    console.error(`[Qdrant] Failed to get collection info:`, e);
  }
  
  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);
  
  // Search
  const result = await qdrantRequest('POST', `/collections/${collectionName}/points/search`, {
    vector: queryEmbedding,
    limit,
    score_threshold: scoreThreshold,
    with_payload: true,
  }) as { result: SearchResult[] };
  
  console.log(`[Qdrant] Found ${result.result.length} results (threshold: ${scoreThreshold})`);
  
  return result.result;
}

// Delete points by knowledge base ID
export async function deleteByKnowledgeBase(
  collectionName: string,
  knowledgeBaseId: string
): Promise<void> {
  console.log(`[Qdrant] Deleting points for knowledge base: ${knowledgeBaseId}`);
  
  await qdrantRequest('POST', `/collections/${collectionName}/points/delete`, {
    filter: {
      must: [
        {
          key: 'knowledge_base_id',
          match: { value: knowledgeBaseId },
        },
      ],
    },
  });
  
  console.log(`[Qdrant] Deleted points for knowledge base: ${knowledgeBaseId}`);
}

// Get collection info
export async function getCollectionInfo(collectionName: string): Promise<{
  pointsCount: number;
  status: string;
}> {
  const result = await qdrantRequest('GET', `/collections/${collectionName}`) as {
    result: {
      points_count: number;
      status: string;
    };
  };
  
  return {
    pointsCount: result.result.points_count,
    status: result.result.status,
  };
}
