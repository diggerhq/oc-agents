import { useEffect, useState, useCallback, useRef } from 'react';
import { files as filesApi, Bucket, FileItem, BucketRepo } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { Modal } from '@/components/Modal';
import { ShareResourceModal } from '@/components/ShareResourceModal';
import { RepoPicker, SelectedRepo } from '@/components/RepoPicker';
import Editor, { Monaco } from '@monaco-editor/react';
import { handleApiError, showToast } from '@/lib/toast';
import type { editor } from 'monaco-editor';

// File extension to Monaco language mapping
const getLanguageFromPath = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'json': 'json',
    'md': 'markdown',
    'py': 'python',
    'rb': 'ruby',
    'go': 'go',
    'rs': 'rust',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'css': 'css',
    'scss': 'scss',
    'less': 'less',
    'html': 'html',
    'xml': 'xml',
    'yaml': 'yaml',
    'yml': 'yaml',
    'toml': 'toml',
    'sh': 'shell',
    'bash': 'shell',
    'zsh': 'shell',
    'sql': 'sql',
    'graphql': 'graphql',
    'dockerfile': 'dockerfile',
    'makefile': 'makefile',
  };
  return langMap[ext] || 'plaintext';
};

export function Files() {
  const { } = useAuth();
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [selectedBucket, setSelectedBucket] = useState<Bucket | null>(null);
  const [currentPath, setCurrentPath] = useState('/');
  const [filesList, setFilesList] = useState<FileItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; currentBatch: number; totalBatches: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [newBucketName, setNewBucketName] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewBucketModal, setShowNewBucketModal] = useState(false);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  
  // Repo bucket state
  const [bucketMode, setBucketMode] = useState<'empty' | 'repo'>('empty');
  const [selectedRepoInfo, setSelectedRepoInfo] = useState<SelectedRepo | null>(null);
  // Legacy state kept for backwards compatibility in handleCreateBucket
  const [repoUrl, setRepoUrl] = useState('');
  const [repoBranch, setRepoBranch] = useState('main');
  const [repoToken, setRepoToken] = useState('');
  const [isCreatingFromRepo, setIsCreatingFromRepo] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<BucketRepo['sync_progress'] | null>(null);
  const [bucketRepos, setBucketRepos] = useState<Record<string, BucketRepo>>({});
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [jumpToPage, setJumpToPage] = useState('');
  const limit = 50;
  
  // Modal state
  const [modal, setModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'alert' | 'confirm' | 'danger';
    onConfirm?: () => void;
  }>({ isOpen: false, title: '', message: '', type: 'alert' });
  const closeModal = () => setModal(prev => ({ ...prev, isOpen: false }));

  // Share modal state
  const [shareModal, setShareModal] = useState<{
    isOpen: boolean;
    bucketId: string;
    bucketName: string;
  }>({ isOpen: false, bucketId: '', bucketName: '' });

  const openShareModal = (bucket: Bucket) => {
    setShareModal({
      isOpen: true,
      bucketId: bucket.id,
      bucketName: bucket.name,
    });
  };

  const closeShareModal = () => {
    setShareModal({ isOpen: false, bucketId: '', bucketName: '' });
  };

  // Editor state
  const [editingFile, setEditingFile] = useState<FileItem | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const [editorLoadingStatus, setEditorLoadingStatus] = useState<string>('');
  const [editorLoadingProgress, setEditorLoadingProgress] = useState<number | null>(null); // 0-100 or null for indeterminate
  const [isSaving, setIsSaving] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // Warn user before closing browser/tab with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (editingFile && editorContent !== originalContent) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [editingFile, editorContent, originalContent]);

  // Load buckets
  const loadBuckets = useCallback(async () => {
    try {
      const { buckets: list } = await filesApi.listBuckets();
      setBuckets(list);
      
      // Auto-select first bucket if none selected
      if (list.length > 0 && !selectedBucket) {
        setSelectedBucket(list[0]);
      }
      
      // Extract repo info from buckets (now included in list response)
      const repoInfos: Record<string, BucketRepo> = {};
      for (const bucket of list) {
        if (bucket.repo_url) {
          repoInfos[bucket.id] = {
            id: bucket.id, // Using bucket_id as id since we don't have separate repo id
            bucket_id: bucket.id,
            user_id: bucket.user_id,
            repo_url: bucket.repo_url,
            repo_branch: bucket.repo_branch || 'main',
            has_token: false, // Not included in join, would need separate call if needed
            sync_status: bucket.sync_status || 'synced',
            sync_progress: bucket.sync_progress,
            last_synced_at: bucket.last_synced_at,
            file_count: 0, // Not included in join
            created_at: bucket.created_at,
            updated_at: bucket.updated_at,
          };
        }
      }
      setBucketRepos(repoInfos);
    } catch (err) {
      console.error('Failed to load buckets:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedBucket]);

  // Load files in current path
  const loadFiles = useCallback(async () => {
    if (!selectedBucket) return;
    
    try {
      const { files, total: totalFiles } = await filesApi.listFiles(
        selectedBucket.id,
        currentPath,
        limit,
        page * limit,
        searchQuery
      );
      setFilesList(files);
      setTotal(totalFiles);
    } catch (err) {
      console.error('Failed to load files:', err);
    }
  }, [selectedBucket, currentPath, page, searchQuery]);

  useEffect(() => {
    loadBuckets();
  }, [loadBuckets]);

  // Clear files immediately when bucket changes to prevent stale data
  useEffect(() => {
    setFilesList([]);
    setTotal(0);
  }, [selectedBucket?.id]);

  useEffect(() => {
    if (selectedBucket) {
      loadFiles();
    }
  }, [selectedBucket, currentPath, page, searchQuery, loadFiles]);

  // Create bucket
  const handleCreateBucket = async () => {
    if (!newBucketName.trim()) return;
    
    try {
      if (bucketMode === 'repo') {
        // Create from repository - use RepoPicker selection or legacy URL input
        const repoUrlToUse = selectedRepoInfo?.repo.clone_url || selectedRepoInfo?.repo.url || repoUrl;
        const branchToUse = selectedRepoInfo?.branch || repoBranch || 'main';
        
        if (!repoUrlToUse?.trim()) {
          setError('Please select a repository');
          return;
        }
        
        setIsCreatingFromRepo(true);
        setCloneProgress(null);
        
        // This now returns immediately with bucket info
        const { bucket, bucketRepo } = await filesApi.createBucketFromRepo({
          name: newBucketName,
          repo_url: repoUrlToUse,
          branch: branchToUse,
          token: repoToken || undefined,
          // Pass installation_id for GitHub App repos
          installation_id: selectedRepoInfo?.installationId,
        });
        
        setBuckets(prev => [bucket, ...prev]);
        setBucketRepos(prev => ({ ...prev, [bucket.id]: bucketRepo }));
        setSelectedBucket(bucket);
        
        // Poll for progress while modal is open
        const pollProgress = async () => {
          try {
            const { bucketRepo: updatedRepo } = await filesApi.getBucketRepo(bucket.id);
            if (updatedRepo) {
              setCloneProgress(updatedRepo.sync_progress || null);
              setBucketRepos(prev => ({ ...prev, [bucket.id]: updatedRepo }));
              
              if (updatedRepo.sync_status === 'syncing') {
                // Keep polling
                setTimeout(pollProgress, 1000);
              } else {
                // Done! Close modal after a brief delay
                setTimeout(async () => {
                  setIsCreatingFromRepo(false);
                  setCloneProgress(null);
                  setNewBucketName('');
                  setRepoUrl('');
                  setRepoBranch('main');
                  setRepoToken('');
                  setSelectedRepoInfo(null);
                  setBucketMode('empty');
                  setShowNewBucketModal(false);
                  
                  // FIX: Avoid stale closure — call API directly with known bucket ID
                  // instead of relying on loadBuckets/loadFiles which capture old state.
                  try {
                    // Refresh bucket list
                    const { buckets: freshBuckets } = await filesApi.listBuckets();
                    setBuckets(freshBuckets);
                    
                    // Find and select the updated bucket (with repo metadata)
                    const updatedBucket = freshBuckets.find(b => b.id === bucket.id);
                    if (updatedBucket) {
                      setSelectedBucket(updatedBucket);
                    }
                    
                    // Load files directly for this specific bucket
                    const { files: freshFiles, total: totalFiles } = await filesApi.listFiles(
                      bucket.id, '/', limit, 0
                    );
                    setFilesList(freshFiles);
                    setTotal(totalFiles);
                    setCurrentPath('/');
                    setPage(0);
                    
                    if (updatedRepo.sync_status === 'synced') {
                      showToast(`Repository imported successfully`, { type: 'success' });
                    } else if (updatedRepo.sync_status === 'failed') {
                      showToast(`Repository import failed: ${updatedRepo.sync_error || 'Unknown error'}`, { type: 'error' });
                    }
                  } catch (refreshErr) {
                    console.error('Failed to refresh after repo sync:', refreshErr);
                  }
                }, 500);
              }
            }
          } catch {
            // Ignore poll errors
          }
        };
        
        // Start polling
        setTimeout(pollProgress, 500);
        
      } else {
        // Create empty bucket
        const { bucket } = await filesApi.createBucket(newBucketName);
        setBuckets(prev => [bucket, ...prev]);
        setSelectedBucket(bucket);
        
        // Show success message
        showToast(`File bucket "${newBucketName}" created successfully`, { type: 'success' });
        
        // Reset form
        setNewBucketName('');
        setRepoUrl('');
        setRepoBranch('main');
        setRepoToken('');
        setSelectedRepoInfo(null);
        setBucketMode('empty');
        setShowNewBucketModal(false);
      }
    } catch (err: any) {
      // Show user-friendly error message via toast
      handleApiError(err, 'Failed to create file bucket');
      setError(err.message || 'Failed to create file bucket');
      setIsCreatingFromRepo(false);
      setCloneProgress(null);
    }
  };
  
  // Sync repo bucket
  const handleSyncRepo = async (bucketId: string) => {
    try {
      await filesApi.syncBucketRepo(bucketId);
      // Update local state to show syncing
      setBucketRepos(prev => ({
        ...prev,
        [bucketId]: { ...prev[bucketId], sync_status: 'syncing' },
      }));
      
      // Poll until sync completes - poll faster for progress updates
      const pollStatus = async (attempts = 0) => {
        if (attempts > 300) return; // Max 300 attempts (5 minutes at 1s intervals)
        
        try {
          const { bucketRepo } = await filesApi.getBucketRepo(bucketId);
          if (bucketRepo) {
            // Update local state with latest progress
            setBucketRepos(prev => ({
              ...prev,
              [bucketId]: bucketRepo,
            }));
            
            if (bucketRepo.sync_status !== 'syncing') {
              // Sync finished — refresh directly with known bucketId to avoid stale closures
              try {
                const { buckets: freshBuckets } = await filesApi.listBuckets();
                setBuckets(freshBuckets);
                
                // Reload files for this bucket directly
                const { files: freshFiles, total: totalFiles } = await filesApi.listFiles(
                  bucketId, '/', limit, 0
                );
                setFilesList(freshFiles);
                setTotal(totalFiles);
                setCurrentPath('/');
                setPage(0);
                
                // Re-select the bucket to update any repo metadata
                const updatedBucket = freshBuckets.find(b => b.id === bucketId);
                if (updatedBucket) {
                  setSelectedBucket(updatedBucket);
                }
                
                if (bucketRepo.sync_status === 'synced') {
                  showToast('Repository synced successfully', { type: 'success' });
                } else if (bucketRepo.sync_status === 'failed') {
                  showToast(`Sync failed: ${bucketRepo.sync_error || 'Unknown error'}`, { type: 'error' });
                }
              } catch (refreshErr) {
                console.error('Failed to refresh after repo sync:', refreshErr);
              }
              return;
            }
          }
          // Still syncing, poll again (every 1 second for progress updates)
          setTimeout(() => pollStatus(attempts + 1), 1000);
        } catch {
          // Error polling, try again
          setTimeout(() => pollStatus(attempts + 1), 2000);
        }
      };
      
      // Start polling after initial delay
      setTimeout(() => pollStatus(), 500);
    } catch (err: any) {
      setError(err.message || 'Failed to sync repository');
    }
  };

  // Create folder
  const handleCreateFolder = async () => {
    if (!selectedBucket || !newFolderName.trim()) return;
    
    try {
      await filesApi.createFolder(selectedBucket.id, newFolderName, currentPath);
      await loadFiles();
      setNewFolderName('');
      setShowNewFolderModal(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create folder');
    }
  };

  // Handle file upload with batching for large uploads
  const BATCH_SIZE = 50; // Files per batch
  
  const handleUpload = async (files: FileList) => {
    if (!selectedBucket) return;
    
    setIsUploading(true);
    setError(null);
    
    const fileArray = Array.from(files);
    const totalFiles = fileArray.length;
    const totalBatches = Math.ceil(totalFiles / BATCH_SIZE);
    
    try {
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const start = batchIndex * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, totalFiles);
        const batchFiles = fileArray.slice(start, end);
        
        // Update progress
        setUploadProgress({
          current: start,
          total: totalFiles,
          currentBatch: batchIndex + 1,
          totalBatches,
        });
        
        // Create a DataTransfer to convert array back to FileList
        const dt = new DataTransfer();
        batchFiles.forEach(file => dt.items.add(file));
        
        await filesApi.uploadFiles(selectedBucket.id, dt.files, currentPath);
      }
      
      setUploadProgress({ current: totalFiles, total: totalFiles, currentBatch: totalBatches, totalBatches });
      await loadFiles();
      await loadBuckets(); // Refresh storage usage
    } catch (err: any) {
      setError(err.message || 'Failed to upload files');
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  // Handle drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    // Check if items contain directories (need special handling)
    const items = e.dataTransfer.items;
    const hasDirectories = Array.from(items).some(item => {
      const entry = item.webkitGetAsEntry?.();
      return entry?.isDirectory;
    });
    
    if (hasDirectories) {
      // Handle folder drop - need to recursively read entries
      const allFiles: File[] = [];
      
      const readEntry = async (entry: FileSystemEntry, path: string): Promise<void> => {
        if (entry.isFile) {
          const fileEntry = entry as FileSystemFileEntry;
          return new Promise((resolve) => {
            fileEntry.file((file) => {
              // Create a new File with the relative path stored
              Object.defineProperty(file, 'webkitRelativePath', {
                value: path + file.name,
                writable: false,
              });
              allFiles.push(file);
              resolve();
            }, () => resolve());
          });
        } else if (entry.isDirectory) {
          const dirEntry = entry as FileSystemDirectoryEntry;
          const reader = dirEntry.createReader();
          
          return new Promise((resolve) => {
            const readEntries = () => {
              reader.readEntries(async (entries) => {
                if (entries.length === 0) {
                  resolve();
                  return;
                }
                
                for (const childEntry of entries) {
                  await readEntry(childEntry, path + entry.name + '/');
                }
                
                // Continue reading (readEntries may return partial results)
                readEntries();
              }, () => resolve());
            };
            readEntries();
          });
        }
      };
      
      // Process all dropped items
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      
      for (const entry of entries) {
        await readEntry(entry, '');
      }
      
      if (allFiles.length > 0) {
        // Create a DataTransfer to convert to FileList
        const dt = new DataTransfer();
        allFiles.forEach(file => dt.items.add(file));
        handleUpload(dt.files);
      }
    } else if (e.dataTransfer.files.length > 0) {
      // Regular file drop
      handleUpload(e.dataTransfer.files);
    }
  };

  // Navigate to folder
  const navigateToFolder = (file: FileItem) => {
    if (file.is_folder) {
      setCurrentPath(file.path);
      setPage(0);
    }
  };

  // Navigate up
  const navigateUp = () => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath(parts.length > 0 ? '/' + parts.join('/') : '/');
    setPage(0);
  };

  // Handle search
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchInput);
    setPage(0);
  };

  // Clear search
  const clearSearch = () => {
    setSearchInput('');
    setSearchQuery('');
    setPage(0);
  };

  // Handle jump to page
  const handleJumpToPage = (e: React.FormEvent) => {
    e.preventDefault();
    const pageNum = parseInt(jumpToPage) - 1; // Convert to 0-indexed
    const maxPage = Math.ceil(total / limit) - 1;
    if (pageNum >= 0 && pageNum <= maxPage) {
      setPage(pageNum);
    }
    setJumpToPage('');
  };

  // Total pages
  const totalPages = Math.ceil(total / limit);

  // Delete file/folder
  const handleDelete = async (file: FileItem) => {
    setModal({
      isOpen: true,
      title: `Delete ${file.is_folder ? 'Folder' : 'File'}`,
      message: `Delete ${file.is_folder ? 'folder' : 'file'} "${file.name}"?`,
      type: 'danger',
      onConfirm: async () => {
        try {
          await filesApi.deleteFile(file.id);
          await loadFiles();
          await loadBuckets(); // Refresh storage usage
        } catch (err: any) {
          setError(err.message || 'Failed to delete');
        }
      },
    });
  };

  // Delete bucket
  const handleDeleteBucket = (bucket: Bucket) => {
    const repoInfo = bucketRepos[bucket.id];
    setModal({
      isOpen: true,
      title: 'Delete Bucket',
      message: `Are you sure you want to delete bucket "${bucket.name}"?${repoInfo ? ' This will remove all synced files from the repository.' : ''} This action cannot be undone.`,
      type: 'danger',
      onConfirm: async () => {
        try {
          await filesApi.deleteBucket(bucket.id);
          // Remove from local state
          setBuckets(prev => prev.filter(b => b.id !== bucket.id));
          setBucketRepos(prev => {
            const { [bucket.id]: _, ...rest } = prev;
            return rest;
          });
          // Clear selection if this bucket was selected
          if (selectedBucket?.id === bucket.id) {
            setSelectedBucket(buckets.find(b => b.id !== bucket.id) || null);
            setCurrentPath('/');
            setFilesList([]);
          }
        } catch (err: any) {
          setError(err.message || 'Failed to delete bucket');
        }
      },
    });
  };

  // Download file
  const handleDownload = async (file: FileItem) => {
    try {
      const blob = await filesApi.downloadFile(file.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Failed to download');
    }
  };

  // Open file in editor (for repo buckets: check if sync needed, then sync)
  const handleOpenInEditor = async (file: FileItem) => {
    if (!selectedBucket) return;
    
    const bucketRepo = bucketRepos[selectedBucket.id];
    const filePath = file.path;
    const fileName = file.name;
    
    setIsEditorLoading(true);
    setEditorLoadingStatus('');
    setEditorLoadingProgress(null);
    setEditingFile(file);
    setEditorContent('');
    setOriginalContent('');
    setCommitMessage('');
    
    try {
      let fileIdToUse = file.id;
      
      // If repo-backed, check if sync is needed
      if (bucketRepo) {
        setError(null);
        setEditorLoadingStatus('Checking for updates...');
        
        // Check if remote has changed
        const syncStatus = await filesApi.checkSyncStatus(selectedBucket.id);
        
        if (syncStatus.needsSync) {
          console.log(`[Editor] Sync needed - remote: ${syncStatus.remoteCommit?.substring(0, 8)}, local: ${syncStatus.localCommit?.substring(0, 8) || 'none'}`);
          
          setEditorLoadingStatus('Repository has updates — syncing...');
          
          // Trigger sync
          await filesApi.syncBucketRepo(selectedBucket.id);
          
          // Poll for sync completion with progress updates
          // Large repos can take several minutes, so we use a longer timeout
          setEditorLoadingStatus('Downloading latest changes...');
          let attempts = 0;
          const maxAttempts = 300; // 5 minutes max (300 seconds)
          let lastProgressTime = Date.now();
          
          while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
            
            // Check bucket repo status
            const { bucketRepo: updatedRepo } = await filesApi.getBucketRepo(selectedBucket.id);
            
            if (updatedRepo?.sync_status === 'synced') {
              setEditorLoadingStatus('Sync complete, loading file...');
              setEditorLoadingProgress(100);
              break;
            } else if (updatedRepo?.sync_status === 'failed') {
              throw new Error(updatedRepo.sync_error || 'Sync failed');
            } else if (updatedRepo?.sync_progress) {
              // Reset timeout when we see progress
              lastProgressTime = Date.now();
              const progress = updatedRepo.sync_progress;
              
              // Calculate overall progress: downloading (0-33%), extracting (33-50%), uploading (50-100%)
              let overallProgress: number | null = null;
              
              if (progress.phase === 'downloading') {
                const mb = (progress.current / 1024 / 1024).toFixed(1);
                const totalMb = progress.total > 0 ? (progress.total / 1024 / 1024).toFixed(1) : null;
                setEditorLoadingStatus(
                  totalMb ? `Downloading... ${mb} / ${totalMb} MB` : `Downloading... ${mb} MB`
                );
                // Downloading is 0-33% of overall
                overallProgress = progress.total > 0 
                  ? Math.round((progress.current / progress.total) * 33) 
                  : null;
              } else if (progress.phase === 'extracting') {
                if (progress.total > 0) {
                  setEditorLoadingStatus(`Extracting files... ${progress.current}/${progress.total}`);
                  // Extracting is 33-50% of overall
                  overallProgress = 33 + Math.round((progress.current / progress.total) * 17);
                } else {
                  setEditorLoadingStatus('Extracting archive...');
                  overallProgress = 40; // Midpoint
                }
              } else if (progress.phase === 'uploading') {
                setEditorLoadingStatus(`Uploading files... ${progress.current}/${progress.total}`);
                // Uploading is 50-100% of overall
                overallProgress = progress.total > 0 
                  ? 50 + Math.round((progress.current / progress.total) * 50) 
                  : 50;
              } else {
                setEditorLoadingStatus(progress.message || 'Syncing...');
              }
              
              setEditorLoadingProgress(overallProgress);
            } else {
              // No progress info - check for stall (no progress for 60 seconds)
              if (Date.now() - lastProgressTime > 60000) {
                throw new Error('Sync appears to be stalled. Please try again.');
              }
            }
          }
          
          // Check if we timed out (loop exited without sync completing)
          const { bucketRepo: finalRepo } = await filesApi.getBucketRepo(selectedBucket.id);
          if (finalRepo?.sync_status !== 'synced') {
            throw new Error('Sync timed out. The repository may be too large or there may be a network issue. Please try again.');
          }
          
          // Refresh file list and find the file by path (IDs change after sync)
          const { files: refreshedFiles } = await filesApi.listFiles(
            selectedBucket.id,
            currentPath,
            100,
            0
          );
          setFilesList(refreshedFiles);
          
          const newFile = refreshedFiles.find(f => f.path === filePath || f.name === fileName);
          if (!newFile) {
            throw new Error(`File not found after sync: ${fileName}`);
          }
          fileIdToUse = newFile.id;
          setEditingFile(newFile);
        } else {
          console.log('[Editor] No sync needed - repo is up to date');
          setEditorLoadingStatus('Loading file...');
        }
      } else {
        setEditorLoadingStatus('Loading file...');
      }
      
      // Always use Monaco - load full content
      setEditorLoadingStatus('Loading file...');
      const { content } = await filesApi.getFileContent(fileIdToUse);
      setEditorContent(content);
      setOriginalContent(content);
    } catch (err: any) {
      setError(err.message || 'Failed to open file');
      setEditingFile(null);
    } finally {
      setIsEditorLoading(false);
      setEditorLoadingStatus('');
      setEditorLoadingProgress(null);
    }
  };

  // Save file content
  const handleSaveFile = async () => {
    if (!editingFile || !selectedBucket) return;
    
    setIsSaving(true);
    setError(null);
    
    try {
      // First save locally to R2
      await filesApi.updateFileContent(editingFile.id, editorContent);
      setOriginalContent(editorContent);
      
      // If repo-backed, commit and push
      const bucketRepo = bucketRepos[selectedBucket.id];
      if (bucketRepo) {
        const message = commitMessage.trim() || `Update ${editingFile.name}`;
        const result = await filesApi.commitAndPush(selectedBucket.id, {
          file_id: editingFile.id,
          content: editorContent,
          commit_message: message,
        });
        
        if (result.success) {
          setModal({
            isOpen: true,
            title: 'Saved & Pushed',
            message: `Changes pushed to ${bucketRepo.repo_branch}`,
            type: 'alert',
          });
        }
      } else {
        setModal({
          isOpen: true,
          title: 'Saved',
          message: 'File saved successfully',
          type: 'alert',
        });
      }
      
      // Refresh file list to update size
      await loadFiles();
    } catch (err: any) {
      setError(err.message || 'Failed to save file');
    } finally {
      setIsSaving(false);
    }
  };

  // Close editor (both Monaco and Streaming)
  const handleCloseEditor = () => {
    const hasChanges = editorContent !== originalContent;
    
    const resetEditorState = () => {
      setEditingFile(null);
      setEditorContent('');
      setOriginalContent('');
      setCommitMessage('');
    };
    
    if (hasChanges) {
      setModal({
        isOpen: true,
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Are you sure you want to close?',
        type: 'confirm',
        onConfirm: resetEditorState,
      });
    } else {
      resetEditorState();
    }
  };

  // Monaco editor mount handler
  const handleEditorMount = (editor: editor.IStandaloneCodeEditor, _monaco: Monaco) => {
    editorRef.current = editor;
    // Add Cmd/Ctrl+S save shortcut
    editor.addCommand(
      _monaco.KeyMod.CtrlCmd | _monaco.KeyCode.KeyS,
      () => {
        handleSaveFile();
      }
    );
  };

  // Check if file is text-editable
  const isTextFile = (file: FileItem) => {
    const textExtensions = [
      'txt', 'md', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'scss', 'less',
      'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp',
      'sh', 'bash', 'zsh', 'sql', 'graphql', 'dockerfile', 'makefile', 'gitignore',
      'env', 'lock', 'config', 'ini', 'cfg', 'properties', 'mjs', 'cjs', 'vue', 'svelte',
    ];
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const nameLC = file.name.toLowerCase();
    return textExtensions.includes(ext) || 
           nameLC === 'dockerfile' || 
           nameLC === 'makefile' ||
           nameLC.startsWith('.');
  };

  // Format file size (handle string/number from Postgres BIGINT)
  const formatSize = (bytes: number | string | null | undefined) => {
    const numBytes = Number(bytes) || 0;
    if (numBytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(numBytes) / Math.log(k));
    return parseFloat((numBytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Get breadcrumb parts
  const getBreadcrumbs = () => {
    if (currentPath === '/') return [{ name: 'Root', path: '/' }];
    const parts = currentPath.split('/').filter(Boolean);
    return [
      { name: 'Root', path: '/' },
      ...parts.map((part, i) => ({
        name: part,
        path: '/' + parts.slice(0, i + 1).join('/'),
      })),
    ];
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-slate-500 dark:text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-medium">Files</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Store documents and files for your agents to process
          </p>
        </div>
        <button
          onClick={() => setShowNewBucketModal(true)}
          className="px-4 py-2 bg-slate-800 dark:bg-blue-500 hover:bg-slate-900 dark:hover:bg-blue-600 text-white rounded text-sm font-medium"
        >
          + New Bucket
        </button>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-500/10 border border-red-500/50 text-red-400 rounded text-sm">
          {error}
          <button onClick={() => setError(null)} className="float-right">×</button>
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* Bucket sidebar */}
        <div className="col-span-3">
          <div className="border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800">
            <div className="p-3 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-sm font-medium text-slate-600 dark:text-slate-400">Buckets</h2>
            </div>
            <div className="p-2">
              {buckets.length === 0 ? (
                <p className="text-slate-500 dark:text-slate-400 text-sm p-2">No buckets yet</p>
              ) : (() => {
                // Separate agent buckets from user buckets
                const isAgentBucket = (name: string) => /(_skills|_input|_output)$/.test(name);
                const agentBuckets = buckets.filter(b => isAgentBucket(b.name));
                const userBuckets = buckets.filter(b => !isAgentBucket(b.name));

                const BucketItem = ({ bucket }: { bucket: Bucket }) => {
                  const repoInfo = bucketRepos[bucket.id];
                  return (
                    <div
                      key={bucket.id}
                      className={`p-2 rounded text-sm group/bucket ${
                        selectedBucket?.id === bucket.id
                          ? 'bg-blue-50 dark:bg-slate-700 text-slate-900 dark:text-white'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          onClick={() => {
                            setSelectedBucket(bucket);
                            setCurrentPath('/');
                            setPage(0);
                          }}
                          className="flex items-center gap-2 flex-1 cursor-pointer min-w-0"
                        >
                          {repoInfo ? (
                            <svg className="w-4 h-4 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                            </svg>
                          )}
                          <span className="truncate flex-1">{bucket.name}</span>
                        </div>
                        {/* Share bucket button - shows on hover or when selected */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openShareModal(bucket);
                          }}
                          className={`p-1 hover:bg-purple-500/20 rounded transition-opacity flex-shrink-0 z-10 ${
                            selectedBucket?.id === bucket.id ? 'opacity-100' : 'opacity-0 group-hover/bucket:opacity-100'
                          }`}
                          title="Share bucket"
                        >
                          <svg className="w-3 h-3 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                          </svg>
                        </button>
                        {/* Delete bucket button - shows on hover or when selected */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            console.log('Delete bucket clicked:', bucket.name);
                            handleDeleteBucket(bucket);
                          }}
                          className={`p-1 hover:bg-red-500/20 rounded transition-opacity flex-shrink-0 z-10 ${
                            selectedBucket?.id === bucket.id ? 'opacity-100' : 'opacity-0 group-hover/bucket:opacity-100'
                          }`}
                          title="Delete bucket"
                        >
                          <svg className="w-3 h-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                      <div 
                        onClick={() => {
                          setSelectedBucket(bucket);
                          setCurrentPath('/');
                          setPage(0);
                        }}
                        className="text-xs text-gray-500 mt-1 ml-6 cursor-pointer"
                      >
                        {formatSize(bucket.storage_used)} / {formatSize(bucket.storage_limit)}
                      </div>
                      
                      {/* Repo info and sync button */}
                      {repoInfo && (
                        <div className="mt-2 ml-6 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              repoInfo.sync_status === 'synced' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' :
                              repoInfo.sync_status === 'syncing' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400' :
                              repoInfo.sync_status === 'failed' ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400' :
                              'bg-gray-100 dark:bg-gray-500/20 text-gray-600 dark:text-gray-400'
                            }`}>
                              {repoInfo.sync_status === 'syncing' && (
                                <span className="inline-block w-2 h-2 mr-1 border border-current border-t-transparent rounded-full animate-spin" />
                              )}
                              {repoInfo.sync_status}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSyncRepo(bucket.id);
                              }}
                              disabled={repoInfo.sync_status === 'syncing'}
                              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
                              title="Sync from repository"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            </button>
                          </div>
                          
                          {/* Progress bar during sync */}
                          {repoInfo.sync_status === 'syncing' && repoInfo.sync_progress && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                                <span className="capitalize">{repoInfo.sync_progress.phase}</span>
                                <span>
                                  {repoInfo.sync_progress.phase === 'downloading' && repoInfo.sync_progress.total > 0
                                    ? `${(repoInfo.sync_progress.current / 1024 / 1024).toFixed(1)} / ${(repoInfo.sync_progress.total / 1024 / 1024).toFixed(1)} MB`
                                    : repoInfo.sync_progress.phase === 'uploading'
                                    ? `${repoInfo.sync_progress.current} files`
                                    : repoInfo.sync_progress.total > 0
                                    ? `${repoInfo.sync_progress.current} / ${repoInfo.sync_progress.total}`
                                    : ''
                                  }
                                </span>
                              </div>
                              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                                {repoInfo.sync_progress.total > 0 ? (
                                  <div 
                                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-300 ease-out"
                                    style={{ width: `${Math.min(100, (repoInfo.sync_progress.current / repoInfo.sync_progress.total) * 100)}%` }}
                                  />
                                ) : (
                                  <div 
                                    className="bg-blue-500 h-1.5 rounded-full animate-pulse"
                                    style={{ width: '100%' }}
                                  />
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                };

                return (
                  <>
                    {userBuckets.length > 0 && (
                      <div className="mb-4">
                        <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-500 uppercase px-2 py-1.5 mb-2">My Buckets</h3>
                        <div className="space-y-1">
                          {userBuckets.map(bucket => <BucketItem key={bucket.id} bucket={bucket} />)}
                        </div>
                      </div>
                    )}

                    {agentBuckets.length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-500 uppercase px-2 py-1.5 mb-2">Agent Buckets</h3>
                        <div className="space-y-1 opacity-75">
                          {agentBuckets.map(bucket => <BucketItem key={bucket.id} bucket={bucket} />)}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        {/* File browser */}
        <div className="col-span-9">
          {selectedBucket ? (
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800">
              {/* Toolbar */}
              <div className="p-3 border-b border-slate-200 dark:border-slate-700 space-y-3">
                {/* Top row: Breadcrumbs and actions */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {/* Breadcrumbs */}
                    {!searchQuery ? (
                      <nav className="flex items-center gap-1 text-sm">
                        {getBreadcrumbs().map((crumb, i, arr) => (
                          <span key={crumb.path} className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                setCurrentPath(crumb.path);
                                setPage(0);
                              }}
                              className={`hover:text-slate-900 dark:hover:text-white ${
                                i === arr.length - 1 ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {crumb.name}
                            </button>
                            {i < arr.length - 1 && <span className="text-gray-600">/</span>}
                          </span>
                        ))}
                      </nav>
                    ) : (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-slate-500 dark:text-slate-400">Search results for:</span>
                        <span className="text-slate-900 dark:text-white font-medium">"{searchQuery}"</span>
                        <button
                          onClick={clearSearch}
                          className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white ml-2"
                        >
                          ✕ Clear
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowNewFolderModal(true)}
                      className="px-3 py-1.5 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-white rounded text-sm hover:bg-slate-100 dark:hover:bg-slate-700"
                      disabled={!!searchQuery}
                    >
                      + Folder
                    </button>
                    <label className={`px-3 py-1.5 bg-slate-800 dark:bg-blue-600 text-white rounded text-sm font-medium hover:bg-slate-900 dark:hover:bg-blue-700 cursor-pointer ${searchQuery ? 'opacity-50 pointer-events-none' : ''}`}>
                      + Upload
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => e.target.files && handleUpload(e.target.files)}
                        disabled={!!searchQuery}
                      />
                    </label>
                    <label className={`px-3 py-1.5 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-white rounded text-sm hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer ${searchQuery ? 'opacity-50 pointer-events-none' : ''}`}>
                      + Upload Folder
                      <input
                        type="file"
                        multiple
                        // @ts-expect-error webkitdirectory is a non-standard attribute
                        webkitdirectory=""
                        className="hidden"
                        onChange={(e) => e.target.files && handleUpload(e.target.files)}
                        disabled={!!searchQuery}
                      />
                    </label>
                  </div>
                </div>
                
                {/* Search bar */}
                <form onSubmit={handleSearch} className="flex gap-2">
                  <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Search files by name..."
                      className="w-full pl-10 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded text-sm hover:bg-white/10"
                  >
                    Search
                  </button>
                </form>
              </div>

              {/* Drop zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`min-h-[400px] ${
                  isDragging ? 'bg-white/5 border-2 border-dashed border-white/30' : ''
                }`}
              >
                {isUploading ? (
                  <div className="flex items-center justify-center h-[400px]">
                    <div className="text-center">
                      <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-4"></div>
                      {uploadProgress ? (
                        <>
                          <p className="text-slate-900 dark:text-white font-medium mb-2">
                            Uploading {uploadProgress.current} of {uploadProgress.total} files
                          </p>
                          <p className="text-slate-500 dark:text-slate-400 text-sm mb-3">
                            Batch {uploadProgress.currentBatch} of {uploadProgress.totalBatches}
                          </p>
                          <div className="w-64 mx-auto bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div 
                              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                            />
                          </div>
                        </>
                      ) : (
                        <p className="text-slate-500 dark:text-slate-400">Preparing upload...</p>
                      )}
                    </div>
                  </div>
                ) : filesList.length === 0 ? (
                  <div className="flex items-center justify-center h-[400px]">
                    <div className="text-center text-slate-500 dark:text-slate-400">
                      <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <p className="text-sm">Drag and drop files here or click Upload</p>
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {/* Back button */}
                    {currentPath !== '/' && (
                      <button
                        onClick={navigateUp}
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 text-left"
                      >
                        <svg className="w-5 h-5 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
                        </svg>
                        <span className="text-slate-500 dark:text-slate-400">..</span>
                      </button>
                    )}
                    
                    {/* Files list */}
                    {filesList.map(file => (
                      <div
                        key={file.id}
                        className="px-4 py-3 flex items-center gap-3 hover:bg-white/5 group"
                      >
                        {/* Icon */}
                        {file.is_folder ? (
                          <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                          </svg>
                        )}
                        
                        {/* Name (clickable for folders) */}
                        {file.is_folder ? (
                          <button
                            onClick={() => navigateToFolder(file)}
                            className="flex-1 text-left text-slate-900 dark:text-white hover:underline"
                          >
                            {file.name}
                          </button>
                        ) : (
                          <span className="flex-1 text-slate-900 dark:text-white">{file.name}</span>
                        )}
                        
                        {/* Size */}
                        <span className="text-sm text-slate-500 dark:text-slate-400 w-20 text-right">
                          {file.is_folder ? '—' : formatSize(file.size)}
                        </span>
                        
                        {/* Actions */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {/* Edit button (for text files in repo buckets, max 25MB) */}
                          {!file.is_folder && isTextFile(file) && selectedBucket && bucketRepos[selectedBucket.id] && (
                            (Number(file.size) || 0) < 25 * 1024 * 1024 ? (
                              <button
                                onClick={() => handleOpenInEditor(file)}
                                className="p-1.5 hover:bg-blue-500/20 rounded"
                                title="Edit"
                              >
                                <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                            ) : (
                              <span 
                                className="p-1.5 cursor-not-allowed opacity-30" 
                                title="File too large to edit (max 25MB)"
                              >
                                <svg className="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </span>
                            )
                          )}
                          {!file.is_folder && (
                            <button
                              onClick={() => handleDownload(file)}
                              className="p-1.5 hover:bg-white/10 rounded"
                              title="Download"
                            >
                              <svg className="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(file)}
                            className="p-1.5 hover:bg-red-500/20 rounded"
                            title="Delete"
                          >
                            <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pagination */}
              {total > limit && (
                <div className="p-3 border-t border-border flex items-center justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">
                    Showing {page * limit + 1}-{Math.min((page + 1) * limit, total)} of {total.toLocaleString()} files
                  </span>
                  <div className="flex items-center gap-3">
                    {/* Jump to page */}
                    <form onSubmit={handleJumpToPage} className="flex items-center gap-2">
                      <span className="text-slate-500 dark:text-slate-400">Page</span>
                      <input
                        type="number"
                        min="1"
                        max={totalPages}
                        value={jumpToPage}
                        onChange={(e) => setJumpToPage(e.target.value)}
                        placeholder={String(page + 1)}
                        className="w-16 px-2 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-center text-slate-900 dark:text-white text-sm"
                      />
                      <span className="text-slate-500 dark:text-slate-400">of {totalPages.toLocaleString()}</span>
                      <button
                        type="submit"
                        className="px-2 py-1 border border-slate-200 dark:border-slate-700 rounded text-xs hover:bg-white/10"
                      >
                        Go
                      </button>
                    </form>
                    
                    <div className="h-4 w-px bg-border" />
                    
                    {/* Prev/Next */}
                    <div className="flex gap-1">
                      <button
                        onClick={() => setPage(0)}
                        disabled={page === 0}
                        className="px-2 py-1 border border-slate-200 dark:border-slate-700 rounded disabled:opacity-50 hover:bg-white/10"
                        title="First page"
                      >
                        ««
                      </button>
                      <button
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="px-3 py-1 border border-slate-200 dark:border-slate-700 rounded disabled:opacity-50 hover:bg-white/10"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => setPage(p => p + 1)}
                        disabled={(page + 1) * limit >= total}
                        className="px-3 py-1 border border-slate-200 dark:border-slate-700 rounded disabled:opacity-50 hover:bg-white/10"
                      >
                        Next
                      </button>
                      <button
                        onClick={() => setPage(totalPages - 1)}
                        disabled={page >= totalPages - 1}
                        className="px-2 py-1 border border-slate-200 dark:border-slate-700 rounded disabled:opacity-50 hover:bg-white/10"
                        title="Last page"
                      >
                        »»
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 p-8 text-center">
              <p className="text-slate-500 dark:text-slate-400">Select a bucket or create a new one to get started</p>
            </div>
          )}
        </div>
      </div>

      {/* New Bucket Modal - Simple modal for empty, slide-out for repo */}
      {showNewBucketModal && bucketMode === 'empty' && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4">Create New Bucket</h2>
            
            <input
              type="text"
              value={newBucketName}
              onChange={(e) => setNewBucketName(e.target.value)}
              placeholder="Bucket name"
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-slate-900 dark:text-white mb-4"
              autoFocus
            />
            
            <button
              onClick={() => setBucketMode('repo')}
              className="w-full mb-4 px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center justify-center gap-2 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              Import from repository
            </button>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowNewBucketModal(false);
                  setNewBucketName('');
                }}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBucket}
                disabled={!newBucketName.trim()}
                className="px-4 py-2 bg-slate-900 dark:bg-blue-600 text-white rounded font-medium hover:bg-slate-800 dark:hover:bg-blue-700 disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slide-out panel for importing from repository */}
      {showNewBucketModal && bucketMode === 'repo' && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/50 dark:bg-black/70"
            onClick={() => {
              if (!isCreatingFromRepo) {
                setShowNewBucketModal(false);
                setBucketMode('empty');
                setNewBucketName('');
                setSelectedRepoInfo(null);
              }
            }}
          />
          
          {/* Slide-out panel */}
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-xl bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    if (!isCreatingFromRepo) {
                      setBucketMode('empty');
                    }
                  }}
                  disabled={isCreatingFromRepo}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded disabled:opacity-50"
                >
                  <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h2 className="text-lg font-medium text-slate-900 dark:text-white">Import from Repository</h2>
              </div>
              <button
                onClick={() => {
                  setShowNewBucketModal(false);
                  setBucketMode('empty');
                  setNewBucketName('');
                  setRepoUrl('');
                  setRepoBranch('main');
                  setRepoToken('');
                  setSelectedRepoInfo(null);
                  setIsCreatingFromRepo(false);
                  setCloneProgress(null);
                }}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
              >
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Bucket name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Bucket Name
                </label>
                <input
                  type="text"
                  value={newBucketName}
                  onChange={(e) => setNewBucketName(e.target.value)}
                  placeholder="my-project"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-slate-900 dark:text-white"
                  disabled={isCreatingFromRepo}
                />
              </div>
              
              {/* Repository Picker - full size */}
              {!isCreatingFromRepo && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Select Repository
                  </label>
                  <RepoPicker 
                    onSelect={setSelectedRepoInfo}
                    initialProvider="github"
                  />
                </div>
              )}
              
              {/* Selected repo summary */}
              {selectedRepoInfo && !isCreatingFromRepo && (
                <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">{selectedRepoInfo.repo.full_name}</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Branch: {selectedRepoInfo.branch}</p>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Progress display during cloning */}
              {isCreatingFromRepo && (
                <div className="space-y-4">
                  {cloneProgress ? (
                    <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-blue-700 dark:text-blue-400 font-medium capitalize">{cloneProgress.phase}</span>
                        <span className="text-sm text-slate-600 dark:text-slate-400">
                          {cloneProgress.phase === 'downloading' && cloneProgress.total > 0
                            ? `${(cloneProgress.current / 1024 / 1024).toFixed(1)} / ${(cloneProgress.total / 1024 / 1024).toFixed(1)} MB`
                            : cloneProgress.phase === 'uploading'
                            ? `${cloneProgress.current} files`
                            : cloneProgress.total > 0
                            ? `${cloneProgress.current} / ${cloneProgress.total}`
                            : ''
                          }
                        </span>
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                        {cloneProgress.total > 0 ? (
                          <div 
                            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(100, (cloneProgress.current / cloneProgress.total) * 100)}%` }}
                          />
                        ) : (
                          <div className="bg-blue-500 h-2 rounded-full animate-pulse w-full" />
                        )}
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">{cloneProgress.message}</p>
                    </div>
                  ) : (
                    <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg p-4 flex items-center gap-3">
                      <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                      <span className="text-blue-700 dark:text-blue-400">Connecting to repository...</span>
                    </div>
                  )}
                  
                  <div className="bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg p-4 flex items-start gap-3">
                    <svg className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-sm text-slate-600 dark:text-slate-400">
                      <strong className="text-slate-700 dark:text-slate-300">Syncing in background</strong>
                      <p className="mt-1">You can close this panel. Progress will appear in the sidebar.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowNewBucketModal(false);
                  setBucketMode('empty');
                  setNewBucketName('');
                  setRepoUrl('');
                  setRepoBranch('main');
                  setRepoToken('');
                  setSelectedRepoInfo(null);
                  setIsCreatingFromRepo(false);
                  setCloneProgress(null);
                }}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                {isCreatingFromRepo ? 'Close' : 'Cancel'}
              </button>
              {!isCreatingFromRepo && (
                <button
                  onClick={handleCreateBucket}
                  disabled={!newBucketName.trim() || !selectedRepoInfo}
                  className="px-4 py-2 bg-slate-900 dark:bg-blue-600 text-white rounded font-medium hover:bg-slate-800 dark:hover:bg-blue-700 disabled:opacity-50"
                >
                  Import Repository
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-medium mb-4">Create New Folder</h2>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-slate-900 dark:text-white mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNewFolderModal(false)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded text-slate-900 dark:text-white hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                className="px-4 py-2 bg-white text-black rounded font-medium hover:bg-gray-200 disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Editor Modal - Monaco */}
      {editingFile && (
        <div className="fixed inset-0 bg-white dark:bg-slate-900 z-50 flex flex-col">
          {/* Editor Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background">
            <div className="flex items-center gap-4">
              <button
                onClick={handleCloseEditor}
                className="p-2 hover:bg-white/10 rounded"
                title="Close"
              >
                <svg className="w-5 h-5 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div>
                <h2 className="text-slate-900 dark:text-white font-medium">{editingFile.name}</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">{editingFile.path}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {/* Unsaved indicator */}
              {editorContent !== originalContent && (
                <span className="text-xs text-yellow-400">Unsaved changes</span>
              )}
              
              {/* Save button */}
              <button
                onClick={handleSaveFile}
                disabled={isSaving || editorContent === originalContent}
                className="px-4 py-2 bg-blue-600 text-slate-900 dark:text-white rounded font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSaving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Save & Push
                  </>
                )}
              </button>
            </div>
          </div>
          
          {/* Commit message (for repo buckets) */}
          {selectedBucket && bucketRepos[selectedBucket.id] && (
            <div className="px-4 py-2 border-b border-border bg-background/80 flex items-center gap-3">
              <span className="text-xs text-slate-500 dark:text-slate-400">Commit message:</span>
              <input
                type="text"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder={`Update ${editingFile.name}`}
                className="flex-1 px-3 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-slate-900 dark:text-white text-sm"
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Branch: <span className="text-blue-400">{bucketRepos[selectedBucket.id].repo_branch}</span>
              </span>
            </div>
          )}
          
          {/* Monaco Editor */}
          <div className="flex-1 relative">
            {isEditorLoading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-10 h-10 border-3 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                  <div className="text-center">
                    <p className="text-slate-900 dark:text-white font-medium">
                      {editorLoadingStatus?.includes('Downloading') || 
                       editorLoadingStatus?.includes('Extracting') || 
                       editorLoadingStatus?.includes('Uploading') ||
                       editorLoadingStatus?.includes('syncing')
                        ? 'Repository Out of Date' 
                        : 'Opening File'}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                      {editorLoadingStatus || 'Loading...'}
                    </p>
                  </div>
                  {/* Progress bar for sync */}
                  {(editorLoadingProgress !== null || 
                    editorLoadingStatus?.includes('Downloading') || 
                    editorLoadingStatus?.includes('Extracting') || 
                    editorLoadingStatus?.includes('Uploading') ||
                    editorLoadingStatus?.includes('syncing')) && (
                    <div className="w-64 mt-2">
                      <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                        {editorLoadingProgress !== null ? (
                          <div 
                            className="h-full bg-blue-500 rounded-full transition-all duration-300" 
                            style={{ width: `${editorLoadingProgress}%` }} 
                          />
                        ) : (
                          <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: '30%' }} />
                        )}
                      </div>
                      {editorLoadingProgress !== null && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 text-center mt-1">{editorLoadingProgress}%</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <Editor
                height="100%"
                language={getLanguageFromPath(editingFile.path)}
                value={editorContent}
                onChange={(value) => setEditorContent(value || '')}
                onMount={handleEditorMount}
                theme="vs-dark"
                options={{
                  fontSize: 14,
                  fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
                  minimap: { enabled: true },
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  automaticLayout: true,
                  padding: { top: 16, bottom: 16 },
                  lineNumbers: 'on',
                  renderWhitespace: 'selection',
                  bracketPairColorization: { enabled: true },
                  cursorBlinking: 'smooth',
                  smoothScrolling: true,
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <Modal
        isOpen={modal.isOpen}
        onClose={closeModal}
        title={modal.title}
        message={modal.message}
        type={modal.type}
        onConfirm={modal.onConfirm}
      />

      {/* Share Modal */}
      <ShareResourceModal
        isOpen={shareModal.isOpen}
        onClose={closeShareModal}
        resourceType="bucket"
        resourceId={shareModal.bucketId}
        resourceName={shareModal.bucketName}
      />
    </div>
  );
}
