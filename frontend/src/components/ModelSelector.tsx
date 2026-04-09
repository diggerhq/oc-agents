import { useState, useEffect, useMemo } from 'react';

interface ModelSelectorProps {
  value: string;
  onChange: (model: string) => void;
  providers: ProviderConfig[];
}

interface ProviderConfig {
  id: string;
  name: string;
  envKey: string;
  configured: boolean;
  prefix: string;
  popularModels: { id: string; name: string; description?: string }[];
  supportsSearch?: boolean;
  searchPlaceholder?: string;
}

// Provider configurations with popular models
const PROVIDERS: ProviderConfig[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    configured: true,
    prefix: 'anthropic/',
    popularModels: [
      { id: 'anthropic/claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', description: 'Best coding model' },
      { id: 'anthropic/claude-opus-4-5-20251101', name: 'Claude Opus 4.5', description: 'Most intelligent' },
      { id: 'anthropic/claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Previous gen' },
      { id: 'anthropic/claude-opus-4-20250514', name: 'Claude Opus 4', description: 'Highly capable' },
      { id: 'anthropic/claude-haiku-4-20250514', name: 'Claude Haiku 4', description: 'Fastest' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    configured: false,
    prefix: 'openai/',
    popularModels: [
      { id: 'openai/gpt-4o', name: 'GPT-4o', description: 'Latest multimodal' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast & cheap' },
      { id: 'openai/o1', name: 'o1', description: 'Advanced reasoning' },
      { id: 'openai/o3-mini', name: 'o3 Mini', description: 'Fast reasoning' },
    ],
  },
  {
    id: 'google',
    name: 'Google',
    envKey: 'GOOGLE_API_KEY',
    configured: false,
    prefix: 'google/',
    popularModels: [
      { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      { id: 'google/gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: '1M context' },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    envKey: 'GROQ_API_KEY',
    configured: false,
    prefix: 'groq/',
    popularModels: [
      { id: 'groq/llama-3.3-70b-versatile', name: 'Llama 3.3 70B', description: 'Super fast' },
      { id: 'groq/mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    configured: false,
    prefix: 'deepseek/',
    popularModels: [
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', description: 'Strong coder' },
      { id: 'deepseek/deepseek-reasoner', name: 'DeepSeek Reasoner' },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    envKey: 'MISTRAL_API_KEY',
    configured: false,
    prefix: 'mistral/',
    popularModels: [
      { id: 'mistral/mistral-large-latest', name: 'Mistral Large' },
      { id: 'mistral/codestral-latest', name: 'Codestral', description: 'For code' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    configured: false,
    prefix: 'openrouter/',
    supportsSearch: true,
    searchPlaceholder: 'Search 100+ models...',
    popularModels: [
      // Free models for testing
      { id: 'openrouter/google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash', description: '🆓 Free' },
      { id: 'openrouter/meta-llama/llama-3.2-3b-instruct:free', name: 'Llama 3.2 3B', description: '🆓 Free' },
      { id: 'openrouter/qwen/qwen-2.5-7b-instruct:free', name: 'Qwen 2.5 7B', description: '🆓 Free' },
      // Popular paid models
      { id: 'openrouter/anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Best balance' },
      { id: 'openrouter/openai/gpt-4o', name: 'GPT-4o', description: 'Latest GPT' },
      { id: 'openrouter/meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', description: 'Open-source' },
      { id: 'openrouter/deepseek/deepseek-chat', name: 'DeepSeek Chat', description: 'Strong coder' },
    ],
  },
  {
    id: 'together',
    name: 'Together',
    envKey: 'TOGETHER_API_KEY',
    configured: false,
    prefix: 'together/',
    supportsSearch: true,
    searchPlaceholder: 'Search models...',
    popularModels: [
      { id: 'together/meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo' },
      { id: 'together/Qwen/Qwen2.5-Coder-32B-Instruct', name: 'Qwen 2.5 Coder 32B' },
      { id: 'together/deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1' },
    ],
  },
  {
    id: 'xai',
    name: 'xAI',
    envKey: 'XAI_API_KEY',
    configured: false,
    prefix: 'xai/',
    popularModels: [
      { id: 'xai/grok-2', name: 'Grok 2' },
      { id: 'xai/grok-2-vision', name: 'Grok 2 Vision' },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    envKey: 'OLLAMA_HOST',
    configured: false,
    prefix: 'ollama/',
    supportsSearch: true,
    searchPlaceholder: 'Enter local model name...',
    popularModels: [
      { id: 'ollama/llama3.2', name: 'Llama 3.2' },
      { id: 'ollama/codellama', name: 'Code Llama' },
      { id: 'ollama/deepseek-coder-v2', name: 'DeepSeek Coder V2' },
      { id: 'ollama/qwen2.5-coder', name: 'Qwen 2.5 Coder' },
    ],
  },
];

export function ModelSelector({ value, onChange, providers: configuredProviders }: ModelSelectorProps) {
  const [selectedProvider, setSelectedProvider] = useState<string>('anthropic');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);

  // Merge configuration status from backend
  const providersWithConfig = useMemo(() => {
    return PROVIDERS.map(p => ({
      ...p,
      configured: configuredProviders.find(cp => cp.envKey === p.envKey)?.configured ?? false,
    }));
  }, [configuredProviders]);

  const currentProvider = providersWithConfig.find(p => p.id === selectedProvider);

  // Filter popular models based on search
  const filteredModels = useMemo(() => {
    if (!currentProvider) return [];
    if (!searchQuery) return currentProvider.popularModels;
    const query = searchQuery.toLowerCase();
    return currentProvider.popularModels.filter(
      m => m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query)
    );
  }, [currentProvider, searchQuery]);

  // Handle custom model input
  const handleCustomSubmit = () => {
    if (searchQuery && currentProvider) {
      // If query doesn't include prefix, add it
      const modelId = searchQuery.includes('/') 
        ? searchQuery 
        : `${currentProvider.prefix}${searchQuery}`;
      onChange(modelId);
      setIsCustomMode(false);
    }
  };

  // Extract provider from current value
  useEffect(() => {
    if (value) {
      const providerPrefix = value.split('/')[0];
      const provider = providersWithConfig.find(p => p.prefix.startsWith(providerPrefix));
      if (provider) {
        setSelectedProvider(provider.id);
      }
    }
  }, [value, providersWithConfig]);

  return (
    <div className="space-y-4">
      {/* Provider Tabs */}
      <div className="flex flex-wrap gap-2">
        {providersWithConfig.map(provider => (
          <button
            key={provider.id}
            type="button"
            onClick={() => {
              setSelectedProvider(provider.id);
              setSearchQuery('');
              setIsCustomMode(false);
            }}
            className={`px-3 py-1.5 text-xs rounded border transition-colors ${
              selectedProvider === provider.id
                ? 'border-slate-800 dark:border-blue-500 bg-slate-800 dark:bg-blue-500 text-white'
                : provider.configured
                ? 'border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 text-slate-700 dark:text-slate-300'
                : 'border-slate-200/50 dark:border-slate-700/50 text-slate-400 dark:text-slate-500 hover:border-slate-300 dark:hover:border-slate-600'
            }`}
          >
            {provider.name}
            {!provider.configured && <span className="ml-1 opacity-50">○</span>}
          </button>
        ))}
      </div>

      {currentProvider && (
        <>
          {/* Search / Custom Input */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsCustomMode(e.target.value.length > 0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchQuery) {
                  handleCustomSubmit();
                }
              }}
              placeholder={currentProvider.searchPlaceholder || `Search ${currentProvider.name} models or enter custom...`}
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-slate-900 dark:text-white text-sm focus:ring-1 focus:ring-slate-400/50 focus:border-slate-400 dark:focus:border-slate-500 placeholder:text-slate-400 dark:placeholder:text-slate-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={handleCustomSubmit}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs bg-slate-800 dark:bg-blue-500 text-white rounded hover:bg-slate-900 dark:hover:bg-blue-600"
              >
                Use "{searchQuery.includes('/') ? searchQuery : `${currentProvider.prefix}${searchQuery}`}"
              </button>
            )}
          </div>

          {/* Popular Models */}
          {!isCustomMode && (
            <div className="grid grid-cols-2 gap-2">
              {filteredModels.map(model => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => onChange(model.id)}
                  className={`p-3 rounded border text-left transition-colors ${
                    value === model.id
                      ? 'border-slate-800 dark:border-blue-500 bg-slate-100 dark:bg-slate-800'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500'
                  } ${!currentProvider.configured ? 'opacity-60' : ''}`}
                >
                  <div className="font-medium text-sm text-slate-900 dark:text-white">{model.name}</div>
                  {model.description && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{model.description}</div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Selected Model Display */}
          {value && (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Selected: <code className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{value}</code>
            </div>
          )}

          {/* Configuration Warning */}
          {!currentProvider.configured && (
            <p className="text-xs text-yellow-500/80">
              ⚠️ {currentProvider.envKey} not configured. Add it to backend/.env to use {currentProvider.name} models.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default ModelSelector;

