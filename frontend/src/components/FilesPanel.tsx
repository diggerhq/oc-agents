import { useState, useEffect } from 'react';

interface FileItem {
  id: string;
  name: string;
  path: string;
  is_folder: boolean;
  mime_type: string | null;
  size: number;
  created_at: string;
}

interface Bucket {
  id: string;
  name: string;
  access_type: string;
  storage_used: number;
}

interface FilesPanelProps {
  agentId: string;
  sessionId: string;
  apiUrl: string;
  onFileSelect: (file: FileItem, bucket: Bucket) => void;
  onFileDownload: (fileId: string, fileName: string) => void;
  themeColor?: string;
  refreshTrigger?: number; // Increment this to trigger a refresh
}

export function FilesPanel({ 
  agentId, 
  sessionId, 
  apiUrl, 
  onFileSelect, 
  onFileDownload,
  themeColor = '#6366f1',
  refreshTrigger = 0
}: FilesPanelProps) {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [selectedBucket, setSelectedBucket] = useState<Bucket | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load buckets on mount
  useEffect(() => {
    loadBuckets();
  }, [agentId, sessionId]);

  // Load files when bucket or path changes
  useEffect(() => {
    if (selectedBucket) {
      loadFiles(selectedBucket.id, currentPath);
    }
  }, [selectedBucket, currentPath]);
  
  // Refresh when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger > 0 && selectedBucket) {
      loadFiles(selectedBucket.id, currentPath);
    }
  }, [refreshTrigger]);

  const loadBuckets = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch(`${apiUrl}/api/portal/${agentId}/sessions/${sessionId}/buckets`);
      if (!res.ok) throw new Error('Failed to load buckets');
      const data = await res.json();
      setBuckets(data.buckets || []);
      
      // Auto-select first bucket if available
      if (data.buckets?.length > 0) {
        setSelectedBucket(data.buckets[0]);
      }
    } catch (err) {
      console.error('Failed to load buckets:', err);
      setError('Failed to load file buckets');
    } finally {
      setIsLoading(false);
    }
  };

  const loadFiles = async (bucketId: string, path: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch(
        `${apiUrl}/api/portal/${agentId}/sessions/${sessionId}/buckets/${bucketId}/files?path=${encodeURIComponent(path)}`
      );
      if (!res.ok) throw new Error('Failed to load files');
      const data = await res.json();
      setFiles(data.files || []);
    } catch (err) {
      console.error('Failed to load files:', err);
      setError('Failed to load files');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileClick = (file: FileItem) => {
    if (file.is_folder) {
      setCurrentPath(file.path);
    } else {
      if (selectedBucket) {
        onFileSelect(file, selectedBucket);
      }
    }
  };

  const handleBackClick = () => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath(parts.length === 0 ? '/' : '/' + parts.join('/'));
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const getFileIcon = (file: FileItem): string => {
    if (file.is_folder) return '📁';
    
    const ext = file.name.split('.').pop()?.toLowerCase();
    const mimeType = file.mime_type?.toLowerCase() || '';
    
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎥';
    if (mimeType.startsWith('audio/')) return '🎵';
    
    switch (ext) {
      case 'pdf': return '📄';
      case 'doc':
      case 'docx': return '📝';
      case 'xls':
      case 'xlsx': return '📊';
      case 'ppt':
      case 'pptx': return '📊';
      case 'zip':
      case 'rar':
      case 'tar':
      case 'gz': return '📦';
      case 'js':
      case 'ts':
      case 'jsx':
      case 'tsx': return '📜';
      case 'py': return '🐍';
      case 'java': return '☕';
      case 'html':
      case 'css': return '🌐';
      case 'json': return '{}';
      case 'md': return '📋';
      case 'txt': return '📄';
      default: return '📄';
    }
  };

  if (buckets.length === 0 && !isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-4 text-center">
        <div className="text-gray-400 text-sm">
          <div className="text-2xl mb-2">📂</div>
          <p>No file buckets available</p>
          <p className="text-xs mt-1 opacity-70">Files created by the agent will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Bucket header - simplified to show just the first bucket */}
      {selectedBucket && (
        <div className="p-3 border-b border-white/10">
          <div className="flex items-center gap-2 text-sm text-gray-300">
            <span>📁</span>
            <span className="font-medium">{selectedBucket.name}</span>
          </div>
        </div>
      )}

      {/* Path breadcrumb */}
      {currentPath !== '/' && (
        <div className="p-3 border-b border-white/10 flex items-center gap-2">
          <button
            onClick={handleBackClick}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            title="Go back"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-xs opacity-70 truncate">{currentPath}</span>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="p-3 bg-red-500/10 border-b border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Files list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin w-6 h-6 border-2 border-white/20 border-t-white rounded-full" />
          </div>
        ) : files.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            <div className="text-center">
              <div className="text-2xl mb-2">📭</div>
              <p>No files in this folder</p>
            </div>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {files.map(file => (
              <div
                key={file.id}
                className="group flex items-center gap-3 px-3 py-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors"
                onClick={() => handleFileClick(file)}
              >
                <span className="text-xl flex-shrink-0">{getFileIcon(file)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{file.name}</div>
                  {!file.is_folder && (
                    <div className="text-xs opacity-60">{formatFileSize(file.size)}</div>
                  )}
                </div>
                {!file.is_folder && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onFileDownload(file.id, file.name);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-white/10 rounded transition-all"
                    title="Download"
                    style={{ color: themeColor }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
