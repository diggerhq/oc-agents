import { useState, useEffect } from 'react';
import { ShareResourceModal } from '@/components/ShareResourceModal';

interface Bucket {
  id: string;
  name: string;
}

interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  source_bucket_id: string | null;
  source_folder_path: string;
  bucket_name?: string;
  collection_name: string;
  status: 'pending' | 'indexing' | 'ready' | 'failed' | 'deleting';
  indexed_files: number;
  indexed_chunks: number;
  last_indexed_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface File {
  id: string;
  name: string;
  path: string;
  is_folder: boolean;
}

export function Knowledge() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false); // Silent refresh flag
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qdrantStatus, setQdrantStatus] = useState<{ configured: boolean; message: string } | null>(null);
  
  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [selectedBucket, setSelectedBucket] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('/');
  const [folders, setFolders] = useState<File[]>([]);
  
  // Detail view state
  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null);

  // Share modal state
  const [shareModal, setShareModal] = useState<{
    isOpen: boolean;
    kbId: string;
    kbName: string;
  }>({ isOpen: false, kbId: '', kbName: '' });

  const openShareModal = (kb: KnowledgeBase) => {
    setShareModal({
      isOpen: true,
      kbId: kb.id,
      kbName: kb.name,
    });
  };

  const closeShareModal = () => {
    setShareModal({ isOpen: false, kbId: '', kbName: '' });
  };

  useEffect(() => {
    loadData();
    checkQdrantStatus();
  }, []);

  useEffect(() => {
    if (selectedBucket) {
      loadFolders(selectedBucket);
    } else {
      setFolders([]);
      setSelectedFolder('/');
    }
  }, [selectedBucket]);

  // Auto-refresh when indexing (silent refresh - no loading indicator)
  useEffect(() => {
    if (knowledgeBases.some(kb => kb.status === 'indexing')) {
      const interval = setInterval(() => loadData(true), 3000); // Faster refresh, silent
      return () => clearInterval(interval);
    }
  }, [knowledgeBases]);

  async function loadData(isRefresh = false) {
    try {
      // Only show full loading state on initial load, not refreshes
      if (!isRefresh) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      
      const [kbRes, bucketsRes] = await Promise.all([
        fetch('/api/knowledge', { credentials: 'include' }),
        fetch('/api/files/buckets', { credentials: 'include' }),
      ]);
      
      if (kbRes.ok) {
        const data = await kbRes.json();
        setKnowledgeBases(data.knowledgeBases);
      }
      
      if (bucketsRes.ok) {
        const data = await bucketsRes.json();
        setBuckets(data.buckets);
      }
    } catch (err) {
      setError('Failed to load data');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  async function checkQdrantStatus() {
    try {
      const res = await fetch('/api/knowledge/status', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setQdrantStatus(data);
      }
    } catch {
      setQdrantStatus({ configured: false, message: 'Failed to check Qdrant status' });
    }
  }

  async function loadFolders(bucketId: string) {
    try {
      const res = await fetch(`/api/files/buckets/${bucketId}/files?path=/`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setFolders(data.files.filter((f: File) => f.is_folder));
      }
    } catch {
      setFolders([]);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    
    try {
      setIsCreating(true);
      setError(null);
      
      const res = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newName,
          description: newDescription || null,
          sourceBucketId: selectedBucket || null,
          sourceFolderPath: selectedFolder,
        }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create knowledge base');
      }
      
      const data = await res.json();
      setKnowledgeBases(prev => [data.knowledgeBase, ...prev]);
      
      // Reset form
      setShowCreateForm(false);
      setNewName('');
      setNewDescription('');
      setSelectedBucket('');
      setSelectedFolder('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleIndex(kb: KnowledgeBase) {
    try {
      setError(null);
      const res = await fetch(`/api/knowledge/${kb.id}/index`, {
        method: 'POST',
        credentials: 'include',
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start indexing');
      }
      
      // Update local state
      setKnowledgeBases(prev => prev.map(k => 
        k.id === kb.id ? { ...k, status: 'indexing' as const } : k
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to index');
    }
  }

  async function handleDelete(kb: KnowledgeBase) {
    if (!confirm(`Delete knowledge base "${kb.name}"? This will remove all indexed data.`)) {
      return;
    }
    
    try {
      setError(null);
      const res = await fetch(`/api/knowledge/${kb.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete');
      }
      
      setKnowledgeBases(prev => prev.filter(k => k.id !== kb.id));
      if (selectedKb?.id === kb.id) {
        setSelectedKb(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  function getStatusBadge(status: KnowledgeBase['status']) {
    const styles: Record<string, string> = {
      pending: 'bg-slate-100 dark:bg-slate-500/20 text-slate-600 dark:text-slate-400',
      indexing: 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400',
      ready: 'bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400',
      failed: 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400',
      deleting: 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
    };
    
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
        {status === 'indexing' && (
          <span className="inline-block w-2 h-2 mr-1 rounded-full bg-blue-400 animate-pulse" />
        )}
        {status}
      </span>
    );
  }

  if (isLoading) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <div className="text-center py-16 text-slate-500 dark:text-slate-400">Loading knowledge bases...</div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            Knowledge Bases
            {isRefreshing && (
              <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" title="Refreshing..." />
            )}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Create vector indexes from your files for RAG-enhanced agents
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          disabled={!qdrantStatus?.configured}
          className="bg-slate-800 dark:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-900 dark:hover:bg-blue-600 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-600 disabled:cursor-not-allowed"
        >
          + New Knowledge Base
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/50 rounded text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {qdrantStatus !== null && !qdrantStatus.configured && (
        <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/50 rounded text-yellow-700 dark:text-yellow-400 text-sm">
          <strong>Qdrant not configured.</strong> Set <code className="bg-yellow-100 dark:bg-black/30 px-1 rounded">QDRANT_API_KEY</code> and <code className="bg-yellow-100 dark:bg-black/30 px-1 rounded">QDRANT_CLUSTER</code> environment variables to enable knowledge bases.
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <div className="mb-8 p-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
          <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4">Create Knowledge Base</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Name *</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., Company Docs, Product Manual"
                className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded text-slate-900 dark:text-white text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            
            <div>
              <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Description</label>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What kind of documents does this knowledge base contain?"
                rows={2}
                className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded text-slate-900 dark:text-white text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Source Bucket</label>
                <select
                  value={selectedBucket}
                  onChange={(e) => setSelectedBucket(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded text-slate-900 dark:text-white text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="">Select a bucket...</option>
                  {buckets.map(bucket => (
                    <option key={bucket.id} value={bucket.id}>{bucket.name}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Source Folder</label>
                <select
                  value={selectedFolder}
                  onChange={(e) => setSelectedFolder(e.target.value)}
                  disabled={!selectedBucket}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded text-slate-900 dark:text-white text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none disabled:opacity-50"
                >
                  <option value="/">/ (root)</option>
                  {folders.map(folder => (
                    <option key={folder.id} value={folder.path}>{folder.path}</option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleCreate}
                disabled={isCreating || !newName.trim()}
                className="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-600 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-600"
              >
                {isCreating ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => setShowCreateForm(false)}
                className="border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Knowledge Bases List */}
      {knowledgeBases.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-12 text-center">
          <div className="text-4xl mb-4">📚</div>
          <h3 className="text-slate-900 dark:text-white font-medium mb-2">No knowledge bases yet</h3>
          <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
            Create a knowledge base to enable RAG for your agents
          </p>
          {qdrantStatus?.configured && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="bg-slate-800 dark:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium hover:bg-slate-900 dark:hover:bg-blue-600"
            >
              Create Knowledge Base
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {knowledgeBases.map(kb => (
            <div
              key={kb.id}
              className={`bg-white dark:bg-slate-800 border rounded-lg p-5 cursor-pointer transition-colors ${
                selectedKb?.id === kb.id ? 'border-blue-500' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
              onClick={() => setSelectedKb(selectedKb?.id === kb.id ? null : kb)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-medium text-slate-900 dark:text-white">{kb.name}</h3>
                    {getStatusBadge(kb.status)}
                  </div>
                  {kb.description && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">{kb.description}</p>
                  )}
                  <div className="flex gap-4 text-xs text-slate-500 dark:text-slate-400">
                    <span>📁 {kb.bucket_name || 'No bucket'}</span>
                    <span>📄 {kb.indexed_files} files</span>
                    <span>🧩 {kb.indexed_chunks} chunks</span>
                    {kb.last_indexed_at && (
                      <span>⏱️ Indexed {new Date(kb.last_indexed_at).toLocaleDateString()}</span>
                    )}
                  </div>
                  {kb.status === 'indexing' && kb.error && (kb.error.startsWith('Processing') || kb.error.startsWith('Generating')) && (
                    <p className="text-sm text-blue-600 dark:text-blue-400 mt-2 flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                      {kb.error}
                    </p>
                  )}
                  {kb.error && kb.status === 'failed' && (
                    <p className="text-sm text-red-600 dark:text-red-400 mt-2">Error: {kb.error}</p>
                  )}
                </div>
                
                <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                  {kb.source_bucket_id && kb.status !== 'indexing' && kb.status !== 'deleting' && (
                    <button
                      onClick={() => handleIndex(kb)}
                      className="px-3 py-1.5 bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded text-xs font-medium hover:bg-blue-200 dark:hover:bg-blue-500/30"
                    >
                      {kb.status === 'ready' ? 'Re-index' : 'Index'}
                    </button>
                  )}
                  <button
                    onClick={() => openShareModal(kb)}
                    className="px-3 py-1.5 bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 rounded text-xs font-medium hover:bg-purple-200 dark:hover:bg-purple-500/30"
                    title="Share settings"
                  >
                    Share
                  </button>
                  <button
                    onClick={() => handleDelete(kb)}
                    disabled={kb.status === 'indexing' || kb.status === 'deleting'}
                    className="px-3 py-1.5 bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 rounded text-xs font-medium hover:bg-red-200 dark:hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Delete
                  </button>
                </div>
              </div>
              
              {/* Expanded details */}
              {selectedKb?.id === kb.id && (
                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Collection:</span>
                      <code className="ml-2 text-xs bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded font-mono text-slate-900 dark:text-slate-200">{kb.collection_name}</code>
                    </div>
                    <div className="text-slate-900 dark:text-slate-200">
                      <span className="text-slate-500 dark:text-slate-400">Source Path:</span>
                      <span className="ml-2">{kb.source_folder_path || '/'}</span>
                    </div>
                    <div className="text-slate-900 dark:text-slate-200">
                      <span className="text-slate-500 dark:text-slate-400">Created:</span>
                      <span className="ml-2">{new Date(kb.created_at).toLocaleString()}</span>
                    </div>
                    <div className="text-slate-900 dark:text-slate-200">
                      <span className="text-slate-500 dark:text-slate-400">Updated:</span>
                      <span className="ml-2">{new Date(kb.updated_at).toLocaleString()}</span>
                    </div>
                  </div>
                  
                  <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-700 rounded">
                    <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">How to use</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Attach this knowledge base to an agent in the agent configuration page. 
                      When the agent receives a message, relevant content from this knowledge base 
                      will be automatically retrieved and injected into the context.
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Auto-refresh indicator for indexing */}
      {knowledgeBases.some(kb => kb.status === 'indexing') && (
        <div className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
          <span className="inline-block w-2 h-2 mr-2 rounded-full bg-blue-400 animate-pulse" />
          Indexing in progress... refreshing automatically
        </div>
      )}

      {/* Share Modal */}
      <ShareResourceModal
        isOpen={shareModal.isOpen}
        onClose={closeShareModal}
        resourceType="knowledge_base"
        resourceId={shareModal.kbId}
        resourceName={shareModal.kbName}
      />
    </div>
  );
}
