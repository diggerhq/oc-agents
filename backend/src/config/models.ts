// Model configuration for OpenCode
// OpenCode supports 75+ providers: https://opencode.ai/docs/models

export interface ModelOption {
  id: string;           // e.g., "anthropic/claude-sonnet-4-20250514"
  name: string;         // Display name
  provider: string;     // Provider name
  envKey: string;       // Environment variable for API key
  description?: string;
}

export interface ProviderGroup {
  name: string;
  envKey: string;
  models: ModelOption[];
}

// Curated list of popular models grouped by provider
export const OPENCODE_PROVIDERS: ProviderGroup[] = [
  {
    name: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'anthropic/claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', provider: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', description: 'Best coding model, great for agents' },
      { id: 'anthropic/claude-opus-4-5-20251101', name: 'Claude Opus 4.5', provider: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', description: 'Most intelligent, complex specialized tasks' },
      { id: 'anthropic/claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', description: 'Previous gen, still excellent' },
      { id: 'anthropic/claude-opus-4-20250514', name: 'Claude Opus 4', provider: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', description: 'Previous gen, highly capable' },
      { id: 'anthropic/claude-haiku-4-20250514', name: 'Claude Haiku 4', provider: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', description: 'Fastest, best for simple tasks' },
    ],
  },
  {
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    models: [
      { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI', envKey: 'OPENAI_API_KEY', description: 'Latest multimodal model' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', envKey: 'OPENAI_API_KEY', description: 'Fast and affordable' },
      { id: 'openai/o1', name: 'o1', provider: 'OpenAI', envKey: 'OPENAI_API_KEY', description: 'Advanced reasoning' },
      { id: 'openai/o1-mini', name: 'o1 Mini', provider: 'OpenAI', envKey: 'OPENAI_API_KEY', description: 'Fast reasoning' },
    ],
  },
  {
    name: 'Google',
    envKey: 'GOOGLE_API_KEY',
    models: [
      { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'Google', envKey: 'GOOGLE_API_KEY', description: 'Fast multimodal' },
      { id: 'google/gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'Google', envKey: 'GOOGLE_API_KEY', description: 'Long context window' },
    ],
  },
  {
    name: 'Groq',
    envKey: 'GROQ_API_KEY',
    models: [
      { id: 'groq/llama-3.3-70b-versatile', name: 'Llama 3.3 70B', provider: 'Groq', envKey: 'GROQ_API_KEY', description: 'Fast open-source model' },
      { id: 'groq/mixtral-8x7b-32768', name: 'Mixtral 8x7B', provider: 'Groq', envKey: 'GROQ_API_KEY', description: 'Fast MoE model' },
    ],
  },
  {
    name: 'Mistral',
    envKey: 'MISTRAL_API_KEY',
    models: [
      { id: 'mistral/mistral-large-latest', name: 'Mistral Large', provider: 'Mistral', envKey: 'MISTRAL_API_KEY', description: 'Most capable Mistral model' },
      { id: 'mistral/codestral-latest', name: 'Codestral', provider: 'Mistral', envKey: 'MISTRAL_API_KEY', description: 'Optimized for code' },
    ],
  },
  {
    name: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    models: [
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', provider: 'DeepSeek', envKey: 'DEEPSEEK_API_KEY', description: 'Strong coding capabilities' },
      { id: 'deepseek/deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'DeepSeek', envKey: 'DEEPSEEK_API_KEY', description: 'Advanced reasoning' },
    ],
  },
  {
    name: 'Together AI',
    envKey: 'TOGETHER_API_KEY',
    models: [
      { id: 'together/meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo', provider: 'Together', envKey: 'TOGETHER_API_KEY', description: 'Fast Llama inference' },
      { id: 'together/Qwen/Qwen2.5-Coder-32B-Instruct', name: 'Qwen 2.5 Coder 32B', provider: 'Together', envKey: 'TOGETHER_API_KEY', description: 'Strong code model' },
    ],
  },
  {
    name: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    models: [
      // Free models for testing
      { id: 'openrouter/google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Free)', provider: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', description: '🆓 Free tier' },
      { id: 'openrouter/meta-llama/llama-3.2-3b-instruct:free', name: 'Llama 3.2 3B (Free)', provider: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', description: '🆓 Free tier' },
      { id: 'openrouter/qwen/qwen-2.5-7b-instruct:free', name: 'Qwen 2.5 7B (Free)', provider: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', description: '🆓 Free tier' },
      // Popular paid models
      { id: 'openrouter/anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', description: 'Best balance' },
      { id: 'openrouter/openai/gpt-4o', name: 'GPT-4o', provider: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', description: 'Latest GPT' },
      { id: 'openrouter/meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', provider: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', description: 'Open-source leader' },
      { id: 'openrouter/qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', provider: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', description: 'Multilingual' },
      { id: 'openrouter/deepseek/deepseek-chat', name: 'DeepSeek Chat', provider: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', description: 'Strong coder' },
      { id: 'openrouter/google/gemini-pro-1.5', name: 'Gemini Pro 1.5', provider: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', description: 'Long context' },
    ],
  },
  {
    name: 'xAI',
    envKey: 'XAI_API_KEY',
    models: [
      { id: 'xai/grok-2', name: 'Grok 2', provider: 'xAI', envKey: 'XAI_API_KEY', description: 'Latest Grok model' },
    ],
  },
  {
    name: 'Ollama (Local)',
    envKey: 'OLLAMA_HOST',
    models: [
      { id: 'ollama/llama3.2', name: 'Llama 3.2 (Local)', provider: 'Ollama', envKey: 'OLLAMA_HOST', description: 'Run locally with Ollama' },
      { id: 'ollama/codellama', name: 'Code Llama (Local)', provider: 'Ollama', envKey: 'OLLAMA_HOST', description: 'Local code model' },
      { id: 'ollama/deepseek-coder-v2', name: 'DeepSeek Coder V2 (Local)', provider: 'Ollama', envKey: 'OLLAMA_HOST', description: 'Local coding assistant' },
    ],
  },
];

// Flat list of all models for easy lookup
export const ALL_OPENCODE_MODELS: ModelOption[] = OPENCODE_PROVIDERS.flatMap(p => p.models);

// Get model by ID
export function getModelById(modelId: string): ModelOption | undefined {
  return ALL_OPENCODE_MODELS.find(m => m.id === modelId);
}

// Get default model
export const DEFAULT_OPENCODE_MODEL = 'anthropic/claude-sonnet-4-5-20250929';

