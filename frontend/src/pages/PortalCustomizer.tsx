import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';

interface ThemeOption {
  id: string;
  name: string;
  description: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  borderRadius: string;
  customCSS: string;
  previewImage?: string;
  aiScore?: number;
  aiNotes?: string;
}

interface Stage {
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'complete' | 'error';
  message: string;
}

const ANALYZE_STAGES: { id: string; label: string }[] = [
  { id: 'capture', label: 'Capturing Website' },
  { id: 'analyze', label: 'Analyzing Design' },
  { id: 'preview', label: 'Creating Previews' },
  { id: 'review', label: 'AI Review & Refinement' },
  { id: 'complete', label: 'Complete' },
];

const REFINE_STAGES: { id: string; label: string }[] = [
  { id: 'feedback', label: 'Processing Feedback' },
  { id: 'preview', label: 'Creating Previews' },
  { id: 'complete', label: 'Complete' },
];

export default function PortalCustomizer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  
  const [url, setUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [stages, setStages] = useState<Stage[]>(
    ANALYZE_STAGES.map(s => ({ ...s, status: 'pending', message: '' }))
  );
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [selectedTheme, setSelectedTheme] = useState<ThemeOption | null>(null);
  const [brandAnalysis, setBrandAnalysis] = useState('');
  const [refinementNotes, setRefinementNotes] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [isApplying, setIsApplying] = useState(false);

  const handleAnalyze = async () => {
    if (!url) {
      setError('Please enter a website URL');
      return;
    }

    setIsAnalyzing(true);
    setError('');
    setThemes([]);
    setSelectedTheme(null);
    setBrandAnalysis('');
    setRefinementNotes('');
    setFeedback('');
    setStages(ANALYZE_STAGES.map(s => ({ ...s, status: 'pending', message: '' })));

    try {
      // Use fetch with streaming for POST request (EventSource only supports GET)
      const response = await fetch('/api/portal-customizer/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, sessionId }),
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        // Process complete SSE messages
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              handleSSEMessage(data);
            } catch (e) {
              console.warn('Failed to parse SSE message:', line);
            }
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to analyze website');
      console.error('Analysis error:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSSEMessage = (data: any, isRefine = false) => {
    console.log('SSE message:', data);
    
    if (data.type === 'stage') {
      setStages(prev => prev.map(stage => 
        stage.id === data.stage 
          ? { ...stage, status: data.status, message: data.message }
          : stage
      ));
    } else if (data.type === 'result') {
      setThemes(data.themes || []);
      if (isRefine) {
        setRefinementNotes(data.refinementNotes || '');
      } else {
        setBrandAnalysis(data.brandAnalysis || '');
      }
      // Auto-select the top-rated theme
      if (data.themes?.length > 0) {
        setSelectedTheme(data.themes[0]);
      }
      // Clear feedback after successful refinement
      if (isRefine) {
        setFeedback('');
      }
    } else if (data.type === 'error') {
      setError(data.error || 'An error occurred');
    }
  };

  const handleRefine = async () => {
    if (!feedback.trim()) {
      setError('Please enter feedback to refine the themes');
      return;
    }

    setIsRefining(true);
    setError('');
    setSelectedTheme(null);
    setRefinementNotes('');
    setStages(REFINE_STAGES.map(s => ({ ...s, status: 'pending', message: '' })));

    try {
      const response = await fetch('/api/portal-customizer/refine', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          sessionId, 
          // Strip out large base64 images - we only need the theme properties
          themes: themes.map(t => ({
            id: t.id,
            name: t.name,
            description: t.description,
            primaryColor: t.primaryColor,
            accentColor: t.accentColor,
            backgroundColor: t.backgroundColor,
            textColor: t.textColor,
            fontFamily: t.fontFamily,
            borderRadius: t.borderRadius,
            aiScore: t.aiScore,
            aiNotes: t.aiNotes,
          })),
          feedback: feedback.trim(),
          websiteUrl: url,
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              handleSSEMessage(data, true);
            } catch (e) {
              console.warn('Failed to parse SSE message:', line);
            }
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to refine themes');
      console.error('Refine error:', err);
    } finally {
      setIsRefining(false);
    }
  };

  const handleApply = async () => {
    if (!selectedTheme) {
      setError('Please select a theme');
      return;
    }
    
    setIsApplying(true);
    setError('');

    try {
      await api.post('/portal-customizer/apply', {
        sessionId,
        theme: selectedTheme,
        customCSS: selectedTheme.customCSS,
      });

      alert(`Theme "${selectedTheme.name}" applied successfully!`);
      navigate(`/agents/${sessionId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to apply styling');
      console.error('Apply error:', err);
    } finally {
      setIsApplying(false);
    }
  };

  const getStageIcon = (status: string) => {
    switch (status) {
      case 'complete':
        return (
          <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'in_progress':
        return (
          <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400 animate-spin" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        );
      case 'error':
        return (
          <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      default:
        return (
          <div className="w-5 h-5 rounded-full border-2 border-slate-300 dark:border-slate-600" />
        );
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900 py-8">
      <div className="max-w-7xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate(`/agents/${sessionId}`)}
            className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 mb-4 flex items-center gap-2"
          >
            ← Back to Agent
          </button>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Portal Style Customizer</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2">
            Enter a website URL and we'll automatically generate matching portal themes
          </p>
        </div>

        {/* URL Input */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg p-6 mb-6">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Website URL
          </label>
          <div className="flex gap-3">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="flex-1 px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder-slate-400 dark:placeholder-slate-500"
              disabled={isAnalyzing}
              onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
            />
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !url}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed font-medium transition-colors"
            >
              {isAnalyzing ? 'Analyzing...' : 'Analyze Website'}
            </button>
          </div>
          {error && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        {/* Progress Stages */}
        {(isAnalyzing || isRefining) && (
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
              {isRefining ? 'Refining Themes' : 'Analysis Progress'}
            </h2>
            <div className="space-y-3">
              {stages.map((stage) => (
                <div key={stage.id} className="flex items-center gap-3">
                  {getStageIcon(stage.status)}
                  <div className="flex-1">
                    <div className={`font-medium ${
                      stage.status === 'complete' ? 'text-green-600 dark:text-green-400' :
                      stage.status === 'in_progress' ? 'text-indigo-600 dark:text-indigo-400' :
                      stage.status === 'error' ? 'text-red-600 dark:text-red-400' :
                      'text-slate-400 dark:text-slate-500'
                    }`}>
                      {stage.label}
                    </div>
                    {stage.message && (
                      <div className="text-sm text-slate-500 dark:text-slate-400">{stage.message}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Theme Options */}
        {themes.length > 0 && (
          <>
            {/* Brand Analysis */}
            {brandAnalysis && (
              <div className="bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-1">Brand Analysis</h3>
                <p className="text-sm text-indigo-600 dark:text-indigo-200">{brandAnalysis}</p>
              </div>
            )}

            {/* Refinement Notes (shown after refine) */}
            {refinementNotes && (
              <div className="bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-medium text-purple-700 dark:text-purple-300 mb-1">Refinement Notes</h3>
                <p className="text-sm text-purple-600 dark:text-purple-200">{refinementNotes}</p>
              </div>
            )}

            {/* Feedback Section */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 mb-6">
              <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Not happy with these options? Tell the AI what you'd like changed:
              </h3>
              <div className="flex gap-3">
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="e.g., 'Make the colors more vibrant', 'I want a lighter theme', 'The purple doesn't match our brand - try blue instead', 'Make it look more professional'..."
                  className="flex-1 px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 placeholder-slate-400 dark:placeholder-slate-500 resize-none"
                  rows={2}
                  disabled={isRefining}
                />
                <button
                  onClick={handleRefine}
                  disabled={isRefining || !feedback.trim()}
                  className="px-5 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed font-medium transition-colors self-end"
                >
                  {isRefining ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Refining...
                    </span>
                  ) : (
                    'Refine Themes'
                  )}
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                The AI will regenerate all 3 themes based on your feedback
              </p>
            </div>

            <div className="mb-6">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">Choose a Theme</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {themes.map((theme) => (
                  <button
                    type="button"
                    key={theme.id}
                    onClick={() => setSelectedTheme(theme)}
                    className={`bg-white dark:bg-slate-800 border-2 rounded-lg overflow-hidden cursor-pointer transition-all text-left ${
                      selectedTheme?.id === theme.id
                        ? 'border-indigo-500 ring-2 ring-indigo-500/50'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    {/* Preview Image */}
                    {theme.previewImage && (
                      <div className="relative">
                        <img
                          src={`data:image/png;base64,${theme.previewImage}`}
                          alt={theme.name}
                          className="w-full h-48 object-cover object-top"
                        />
                        {theme.aiScore && (
                          <div className="absolute top-2 right-2 bg-white/90 dark:bg-slate-900/90 px-2 py-1 rounded-full text-sm font-medium">
                            <span className={
                              theme.aiScore >= 8 ? 'text-green-600 dark:text-green-400' :
                              theme.aiScore >= 6 ? 'text-yellow-600 dark:text-yellow-400' :
                              'text-red-600 dark:text-red-400'
                            }>
                              {theme.aiScore}/10
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Theme Info */}
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold text-slate-900 dark:text-white">{theme.name}</h3>
                        {selectedTheme?.id === theme.id && (
                          <span className="text-xs bg-indigo-500 text-white px-2 py-0.5 rounded">
                            Selected
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">{theme.description}</p>
                      
                      {/* Color Swatches */}
                      <div className="flex gap-2 mb-3">
                        <div
                          className="w-8 h-8 rounded border border-slate-300 dark:border-slate-600"
                          style={{ backgroundColor: theme.primaryColor }}
                          title={`Primary: ${theme.primaryColor}`}
                        />
                        <div
                          className="w-8 h-8 rounded border border-slate-300 dark:border-slate-600"
                          style={{ backgroundColor: theme.accentColor }}
                          title={`Accent: ${theme.accentColor}`}
                        />
                        <div
                          className="w-8 h-8 rounded border border-slate-300 dark:border-slate-600"
                          style={{ backgroundColor: theme.backgroundColor }}
                          title={`Background: ${theme.backgroundColor}`}
                        />
                        <div
                          className="w-8 h-8 rounded border border-slate-300 dark:border-slate-600"
                          style={{ backgroundColor: theme.textColor }}
                          title={`Text: ${theme.textColor}`}
                        />
                      </div>
                      
                      {/* AI Notes */}
                      {theme.aiNotes && (
                        <p className="text-xs text-slate-500 italic">{theme.aiNotes}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Selected Theme Details & Apply */}
            {selectedTheme && (
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                      Selected: {selectedTheme.name}
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400">{selectedTheme.description}</p>
                  </div>
                  <div className="flex gap-3">
                    <a
                      href={`/chat/${sessionId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-white rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 font-medium transition-colors"
                    >
                      Preview Portal
                    </a>
                    <button
                      onClick={handleApply}
                      disabled={isApplying}
                      className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed font-medium transition-colors"
                    >
                      {isApplying ? 'Applying...' : 'Apply Theme'}
                    </button>
                  </div>
                </div>
                
                {/* Color Details */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400">Primary</label>
                    <div className="flex items-center gap-2 mt-1">
                      <div
                        className="w-6 h-6 rounded border border-slate-300 dark:border-slate-600"
                        style={{ backgroundColor: selectedTheme.primaryColor }}
                      />
                      <span className="font-mono text-sm text-slate-600 dark:text-slate-300">{selectedTheme.primaryColor}</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400">Accent</label>
                    <div className="flex items-center gap-2 mt-1">
                      <div
                        className="w-6 h-6 rounded border border-slate-300 dark:border-slate-600"
                        style={{ backgroundColor: selectedTheme.accentColor }}
                      />
                      <span className="font-mono text-sm text-slate-600 dark:text-slate-300">{selectedTheme.accentColor}</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400">Background</label>
                    <div className="flex items-center gap-2 mt-1">
                      <div
                        className="w-6 h-6 rounded border border-slate-300 dark:border-slate-600"
                        style={{ backgroundColor: selectedTheme.backgroundColor }}
                      />
                      <span className="font-mono text-sm text-slate-600 dark:text-slate-300">{selectedTheme.backgroundColor}</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400">Text</label>
                    <div className="flex items-center gap-2 mt-1">
                      <div
                        className="w-6 h-6 rounded border border-slate-300 dark:border-slate-600"
                        style={{ backgroundColor: selectedTheme.textColor }}
                      />
                      <span className="font-mono text-sm text-slate-600 dark:text-slate-300">{selectedTheme.textColor}</span>
                    </div>
                  </div>
                </div>
                
                {/* CSS Preview (collapsible) */}
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
                    View Generated CSS
                  </summary>
                  <pre className="mt-2 p-4 bg-slate-100 dark:bg-slate-900 rounded-lg text-xs text-slate-600 dark:text-slate-400 overflow-x-auto max-h-64">
                    {selectedTheme.customCSS}
                  </pre>
                </details>
              </div>
            )}
          </>
        )}

        {/* Instructions */}
        {!themes.length && !isAnalyzing && (
          <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-indigo-700 dark:text-indigo-300 mb-2">How it works</h3>
            <ol className="list-decimal list-inside space-y-2 text-indigo-600 dark:text-indigo-200">
              <li>Enter the URL of a website you want to match</li>
              <li>Our AI will analyze the website's design system</li>
              <li>We'll generate 3 theme options with live previews</li>
              <li>AI reviews and improves each theme for quality</li>
              <li>Choose your favorite and apply it to your portal</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
