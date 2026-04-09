import { useState } from 'react';

interface ShareThreadModalProps {
  agentId: string;
  sessionId: string;
  threadId: string;
  threadTitle: string;
  apiUrl: string;
  onClose: () => void;
  themeColor: string;
}

export function ShareThreadModal({
  agentId,
  sessionId,
  threadId,
  threadTitle,
  apiUrl,
  onClose,
  themeColor,
}: ShareThreadModalProps) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateShareLink = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/portal/${agentId}/sessions/${sessionId}/threads/${threadId}/share`,
        { method: 'POST' }
      );
      
      if (!res.ok) {
        throw new Error('Failed to generate share link');
      }
      
      const data = await res.json();
      setShareUrl(data.shareUrl);
    } catch (err) {
      console.error('Failed to generate share link:', err);
      setError('Failed to generate share link. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" 
      onClick={onClose}
    >
      <div 
        className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 border border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Share Thread</h3>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-gray-400 mb-4">
          Share "<span className="text-white">{threadTitle}</span>" with your team
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {!shareUrl ? (
          <button
            onClick={generateShareLink}
            disabled={isLoading}
            className="w-full py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 text-white"
            style={{ backgroundColor: themeColor }}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Generating...
              </span>
            ) : (
              'Generate Share Link'
            )}
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 bg-slate-900 rounded-lg p-3 border border-white/10">
              <input
                type="text"
                value={shareUrl}
                readOnly
                className="flex-1 bg-transparent text-sm outline-none text-white"
              />
              <button
                onClick={copyToClipboard}
                className="px-3 py-1 rounded text-sm font-medium transition-colors text-white"
                style={{ backgroundColor: copied ? '#10b981' : themeColor }}
              >
                {copied ? (
                  <span className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </span>
                ) : (
                  'Copy'
                )}
              </button>
            </div>
            
            <p className="text-xs text-gray-500">
              Anyone with this link can view this conversation and continue it in their own session.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
