import { useEffect, useState } from 'react';
import { agentConfig, AgentConfigType, apiKeys, files, Bucket } from '@/lib/api';
import { Modal } from '@/components/Modal';

interface AgentConfigProps {
  sessionId: string;
  model?: string; // Agent's model - used to hide extended thinking for models that don't support it
  agentType?: 'code' | 'task' | 'portal' | 'portal-sandbox';
}

const E2B_TEMPLATES = [
  { id: '', label: 'Default (auto-detect)' },
  { id: 'claude-code-agent', label: 'Claude Code' },
  { id: 'aider-agent', label: 'Aider' },
  { id: 'opencode-agent', label: 'OpenCode' },
];

const PORTAL_MODELS = [
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', description: 'Recommended' },
  { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', description: 'Most intelligent' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Previous gen' },
  { id: 'claude-haiku-4-20250514', name: 'Claude Haiku 4', description: 'Fastest' },
];

export function AgentConfig({ sessionId, model, agentType }: AgentConfigProps) {
  const [_config, setConfig] = useState<AgentConfigType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [activeSection, setActiveSection] = useState<'general' | 'secrets' | 'api' | 'files'>('general');
  const [manualTaskId, setManualTaskId] = useState(''); // Used in API section
  
  // API Playground state
  const [testPrompt, setTestPrompt] = useState('');
  const [testApiKey, setTestApiKey] = useState('');
  const [testTaskId, setTestTaskId] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'polling' | 'completed' | 'failed'>('idle');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [apiKeysList, setApiKeysList] = useState<{ id: string; key_prefix: string; name: string }[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  
  // Form state
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [secrets, setSecrets] = useState<{ key: string; value: string }[]>([]);
  const [e2bTemplate, setE2bTemplate] = useState('');
  const [enableExtendedThinking, setEnableExtendedThinking] = useState(true); // Default to ON
  const [thinkingBudgetTokens, setThinkingBudgetTokens] = useState(100000);
  
  // Check if model is Haiku (doesn't support extended thinking)
  const isHaikuModel = model?.toLowerCase().includes('haiku') ?? false;
  const [apiEnabled, setApiEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [chainToAgentId, setChainToAgentId] = useState('');
  const [chainCondition, setChainCondition] = useState<'on_success' | 'on_failure' | 'always'>('on_success');
  const [outputSchema, setOutputSchema] = useState('');

  // Portal agent state (only model is user-configurable)
  const [portalAgentModel, setPortalAgentModel] = useState('claude-sonnet-4-5-20250929');

  // Files/Buckets state
  const [availableBuckets, setAvailableBuckets] = useState<Bucket[]>([]);
  const [attachedBuckets, setAttachedBuckets] = useState<Array<{
    id: string;
    bucket_id: string;
    bucket_name: string;
    mount_path: string;
    read_only: boolean;
  }>>([]);
  const [isLoadingBuckets, setIsLoadingBuckets] = useState(false);
  const [selectedBucketToAttach, setSelectedBucketToAttach] = useState('');
  const [newMountPath, setNewMountPath] = useState('/home/user/workspace/files');
  const [newReadOnly, setNewReadOnly] = useState(false);
  
  // Modal state
  const [modal, setModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'alert' | 'confirm' | 'danger';
    onConfirm?: () => void;
  }>({ isOpen: false, title: '', message: '', type: 'alert' });
  const closeModal = () => setModal(prev => ({ ...prev, isOpen: false }));

  useEffect(() => {
    loadConfig();
    loadApiKeys();
    loadBuckets();
  }, [sessionId]);

  const loadApiKeys = async () => {
    try {
      const { keys } = await apiKeys.list();
      setApiKeysList(keys.map(k => ({ id: k.id, key_prefix: k.key_prefix, name: k.name })));
      // Check localStorage for a saved API key and always set if available
      const savedKey = localStorage.getItem('api_key');
      if (savedKey) {
        setTestApiKey(savedKey);
      }
    } catch {
      // Ignore - user might not have any keys
    }
  };

  const loadBuckets = async () => {
    setIsLoadingBuckets(true);
    try {
      // Load all user's buckets
      const { buckets } = await files.listBuckets();
      setAvailableBuckets(buckets);
      
      // Load buckets attached to this agent
      const { buckets: attached } = await files.getAgentBuckets(sessionId);
      setAttachedBuckets(attached);
    } catch (err) {
      console.error('Failed to load buckets:', err);
    } finally {
      setIsLoadingBuckets(false);
    }
  };

  const handleAttachBucket = async () => {
    if (!selectedBucketToAttach) return;
    
    try {
      await files.addAgentBucket(sessionId, selectedBucketToAttach, newMountPath, newReadOnly);
      setMessage('Bucket attached successfully!');
      setSelectedBucketToAttach('');
      setNewMountPath('/home/user/workspace/files');
      setNewReadOnly(false);
      await loadBuckets();
    } catch (err: any) {
      setMessage(`Error: ${err.message || 'Failed to attach bucket'}`);
    }
  };

  const handleDetachBucket = async (bucketId: string) => {
    setModal({
      isOpen: true,
      title: 'Remove Bucket',
      message: 'Remove this bucket from the agent?',
      type: 'confirm',
      onConfirm: async () => {
        try {
          await files.removeAgentBucket(sessionId, bucketId);
          setMessage('Bucket removed from agent.');
          await loadBuckets();
        } catch (err: any) {
          setMessage(`Error: ${err.message || 'Failed to remove bucket'}`);
        }
      },
    });
  };


  // Commented out - Runs section is hidden
  // const loadRuns = async () => {
  //   setIsLoadingRuns(true);
  //   try {
  //     const { runs: list, total } = await runs.list(sessionId);
  //     setRunsList(list);
  //     setRunsTotal(total);
  //   } catch (err) {
  //     console.error('Failed to load runs:', err);
  //   } finally {
  //     setIsLoadingRuns(false);
  //   }
  // };

  // const loadSingleRun = async (runId: string) => {
  //   try {
  //     const { run } = await runs.get(sessionId, runId);
  //     console.log('Selected run:', run); // Debug log
  //     setSelectedRun(run);
  //   } catch (err) {
  //     console.error('Failed to load run:', err);
  //   }
  // };

  // Commented out - Runs section is hidden
  // Helper function to safely parse debug logs
  // const parseDebugLog = React.useCallback((debugLogJson: string | undefined | null): DebugLogEntry[] => {
  //   if (!debugLogJson || typeof debugLogJson !== 'string' || debugLogJson.trim() === '') {
  //     return [];
  //   }
  //   try {
  //     const parsed = JSON.parse(debugLogJson);
  //     return Array.isArray(parsed) ? parsed : [];
  //   } catch (error) {
  //     console.warn('Failed to parse debug log:', error);
  //     return [];
  //   }
  // }, []);

  // Commented out - Actions section is hidden
  // const formatTimestamp = (ts: number) => {
  //   return new Date(ts).toLocaleTimeString();
  // };

  // const loadTemplates = async () => {
  //   try {
  //     const { templates: list } = await templates.list(sessionId);
  //     setTemplatesList(list);
  //   } catch (err) {
  //     console.error('Failed to load templates:', err);
  //   }
  // };

  // const loadWorkflow = async () => {
  //   try {
  //     const { steps } = await workflows.get(sessionId);
  //     setWorkflowSteps(steps);
  //   } catch (err) {
  //     console.error('Failed to load workflow:', err);
  //   }
  // };

  // const handleCreateTemplate = async () => {
  //   if (!newTemplateName.trim() || !newTemplateContent.trim()) return;
    
  //   try {
  //     const vars = newTemplateVars.split(',').map(v => v.trim()).filter(Boolean);
  //     await templates.create(sessionId, {
  //       name: newTemplateName,
  //       template: newTemplateContent,
  //       variables: vars.length > 0 ? vars : undefined,
  //     });
  //     setNewTemplateName('');
  //     setNewTemplateContent('');
  //     setNewTemplateVars('');
  //     await loadTemplates();
  //     setMessage('Template created!');
  //     setTimeout(() => setMessage(''), 3000);
  //   } catch (err) {
  //     setMessage('Failed to create template');
  //   }
  // };

  // const handleDeleteTemplate = async (templateId: string) => {
  //   try {
  //     await templates.delete(sessionId, templateId);
  //     await loadTemplates();
  //   } catch (err) {
  //     setMessage('Failed to delete template');
  //   }
  // };

  // const addWorkflowStep = (actionType: WorkflowStep['action_type']) => {
  //   const newStep: WorkflowStep = {
  //     id: `temp-${Date.now()}`,
  //     agent_id: sessionId,
  //     step_order: workflowSteps.length,
  //     action_type: actionType,
  //     config: {},
  //     created_at: new Date().toISOString(),
  //   };
  //   setWorkflowSteps([...workflowSteps, newStep]);
  // };

  // const updateWorkflowStep = (index: number, config: Record<string, unknown>) => {
  //   setWorkflowSteps(prev => prev.map((step, i) => 
  //     i === index ? { ...step, config } : step
  //   ));
  // };

  // const removeWorkflowStep = (index: number) => {
  //   setWorkflowSteps(prev => prev.filter((_, i) => i !== index));
  // };

  // const handleSaveWorkflow = async () => {
  //   setIsSaving(true);
  //   try {
  //     await workflows.save(sessionId, workflowSteps.map(s => ({
  //       action_type: s.action_type,
  //       config: s.config,
  //     })));
  //     await loadWorkflow();
  //     setMessage('Workflow saved!');
  //     setTimeout(() => setMessage(''), 3000);
  //   } catch (err) {
  //     setMessage('Failed to save workflow');
  //   } finally {
  //     setIsSaving(false);
  //   }
  // };

  // API Playground functions
  const handleTestApi = async () => {
    if (!testPrompt.trim() || !testApiKey.trim()) {
      setTestError('Prompt and API key are required');
      return;
    }

    setTestStatus('sending');
    setTestResult(null);
    setTestError(null);
    setTestTaskId('');

    try {
      // Submit task
      const response = await fetch(`/api/v1/agents/${sessionId}/tasks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: testPrompt }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit task');
      }

      setTestTaskId(data.id);
      setTestStatus('polling');

      // Poll for result
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/v1/agents/${sessionId}/tasks/${data.id}`, {
            headers: { 'Authorization': `Bearer ${testApiKey}` },
          });
          const statusData = await statusRes.json();

          if (statusData.status === 'completed') {
            clearInterval(pollInterval);
            setTestStatus('completed');
            setTestResult(statusData.result);
          } else if (statusData.status === 'failed') {
            clearInterval(pollInterval);
            setTestStatus('failed');
            setTestError(statusData.error || 'Task failed');
          }
          // Keep polling if still pending/processing
        } catch (pollErr) {
          clearInterval(pollInterval);
          setTestStatus('failed');
          setTestError('Failed to poll task status');
        }
      }, 2000);

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        if (testStatus === 'polling') {
          setTestStatus('failed');
          setTestError('Task timed out');
        }
      }, 300000);

    } catch (err) {
      setTestStatus('failed');
      setTestError(err instanceof Error ? err.message : 'Failed to submit task');
    }
  };

  // Get the base URL for API calls - use current domain in production
  const getBaseUrl = () => {
    if (typeof window === 'undefined') return 'http://localhost:3000';
    const { protocol, hostname, port } = window.location;
    // In development with Vite proxy, API is on port 3000
    if (hostname === 'localhost' && port === '5173') {
      return 'http://localhost:3000';
    }
    // In production, use the current origin
    return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
  };

  const getCurlCommand = () => {
    const baseUrl = getBaseUrl();
    return `curl -X POST ${baseUrl}/api/v1/agents/${sessionId}/tasks \\
  -H "Authorization: Bearer ${testApiKey || 'YOUR_API_KEY'}" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "${testPrompt.replace(/'/g, "\\'") || 'Your prompt here'}"}'`;
  };

  const getStatusCurlCommand = () => {
    const baseUrl = getBaseUrl();
    const taskIdToUse = manualTaskId || testTaskId || 'TASK_ID';
    return `curl ${baseUrl}/api/v1/agents/${sessionId}/tasks/${taskIdToUse} \\
  -H "Authorization: Bearer ${testApiKey || 'YOUR_API_KEY'}"`;
  };

  const handleCheckStatus = async () => {
    const taskIdToCheck = manualTaskId || testTaskId;
    if (!taskIdToCheck || !testApiKey) {
      setTestError('Task ID and API key are required');
      return;
    }

    setTestStatus('polling');
    setTestResult(null);
    setTestError(null);

    try {
      const response = await fetch(`/api/v1/agents/${sessionId}/tasks/${taskIdToCheck}`, {
        headers: { 'Authorization': `Bearer ${testApiKey}` },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get task status');
      }

      if (data.status === 'completed') {
        setTestStatus('completed');
        setTestResult(data.result);
      } else if (data.status === 'failed') {
        setTestStatus('failed');
        setTestError(data.error || 'Task failed');
      } else {
        setTestStatus('idle');
        setTestResult(`Status: ${data.status}`);
      }
    } catch (err) {
      setTestStatus('failed');
      setTestError(err instanceof Error ? err.message : 'Failed to check status');
    }
  };

  const loadConfig = async () => {
    try {
      const { config: loadedConfig } = await agentConfig.get(sessionId);
      setConfig(loadedConfig);
      setName(loadedConfig.name || '');
      setSystemPrompt(loadedConfig.system_prompt || '');
      setE2bTemplate(loadedConfig.e2b_template || '');
      // Default to true unless explicitly false (null/undefined = true)
      setEnableExtendedThinking(loadedConfig.enable_extended_thinking !== false);
      setThinkingBudgetTokens(loadedConfig.thinking_budget_tokens || 100000);
      setApiEnabled(Boolean(loadedConfig.api_enabled));
      setWebhookUrl(loadedConfig.webhook_url || '');
      setChainToAgentId(loadedConfig.chain_to_agent_id || '');
      setChainCondition(loadedConfig.chain_condition || 'on_success');
      setOutputSchema(loadedConfig.output_schema || '');
      
      // Portal agent config
      setPortalAgentModel(loadedConfig.portal_agent_model || 'claude-sonnet-4-5-20250929');
      
      // Parse allowed tools
      if (loadedConfig.allowed_tools) {
        try {
          setAllowedTools(JSON.parse(loadedConfig.allowed_tools));
        } catch {
          setAllowedTools([]);
        }
      }
      
      // Parse secrets
      if (loadedConfig.secrets) {
        try {
          const secretsObj = JSON.parse(loadedConfig.secrets);
          setSecrets(Object.entries(secretsObj).map(([key, value]) => ({ key, value: value as string })));
        } catch {
          setSecrets([]);
        }
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage('');
    
    try {
      // Convert secrets array to object
      const secretsObj: Record<string, string> = {};
      secrets.forEach(s => {
        if (s.key.trim()) {
          secretsObj[s.key.trim()] = s.value;
        }
      });
      
      const updatePayload: Partial<AgentConfigType> = {
        name: name || undefined,
        system_prompt: systemPrompt || undefined,
        allowed_tools: allowedTools.length > 0 ? JSON.stringify(allowedTools) : undefined,
        secrets: Object.keys(secretsObj).length > 0 ? JSON.stringify(secretsObj) : undefined,
        e2b_template: e2bTemplate || undefined,
        enable_extended_thinking: enableExtendedThinking,
        thinking_budget_tokens: thinkingBudgetTokens,
        api_enabled: apiEnabled ? 1 : 0,
        webhook_url: webhookUrl || undefined,
        chain_to_agent_id: chainToAgentId || undefined,
        chain_condition: chainCondition,
        output_schema: outputSchema || undefined,
      };

      // Add portal agent fields (only model is user-configurable; rest are locked to max)
      if (agentType === 'portal') {
        updatePayload.portal_agent_model = portalAgentModel;
        updatePayload.portal_agent_thinking_budget = 128000;
        updatePayload.portal_agent_max_tokens = 128000;
        updatePayload.portal_agent_sandbox_enabled = true;
      }

      await agentConfig.update(sessionId, updatePayload);
      setMessage('Configuration saved!');
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      setMessage('Failed to save configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const addSecret = () => {
    setSecrets(prev => [...prev, { key: '', value: '' }]);
  };

  const removeSecret = (index: number) => {
    setSecrets(prev => prev.filter((_, i) => i !== index));
  };

  const updateSecret = (index: number, field: 'key' | 'value', value: string) => {
    setSecrets(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  };

  if (isLoading) {
    return <div className="text-slate-500 dark:text-slate-400 text-sm">Loading configuration...</div>;
  }

  return (
    <div className="space-y-6">
      {message && (
        <div className={`px-4 py-2 rounded text-sm ${
          message.includes('Failed') 
            ? 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/50 text-red-700 dark:text-red-400'
            : 'bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/50 text-green-700 dark:text-green-400'
        }`}>
          {message}
        </div>
      )}

      {/* Section Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {(['general', 'files', 'secrets', 'api'] as const).map((section) => (
          <button
            key={section}
            onClick={() => setActiveSection(section)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeSection === section
                ? 'border-slate-800 dark:border-blue-500 text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
            } ${section === 'api' ? 'uppercase' : 'capitalize'}`}
          >
            {section}
          </button>
        ))}
      </div>

      {/* General Section */}
      {activeSection === 'general' && (
        <div className="space-y-6">
          {/* Portal Agent Model Settings */}
          {agentType === 'portal' && (
            <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4 space-y-4">
              <h4 className="text-sm font-medium text-purple-800 dark:text-purple-300">Portal Agent Settings</h4>
              
              <div>
                <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">Model</label>
                <select
                  value={portalAgentModel}
                  onChange={(e) => setPortalAgentModel(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white"
                >
                  {PORTAL_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.name} - {m.description}</option>
                  ))}
                </select>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Extended thinking and all tools are enabled by default. Output is set to maximum.
              </p>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Agent Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., DevOps Agent, Frontend Builder"
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-slate-400 dark:focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-400/50"
            />
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-sm font-medium mb-2">
              System Prompt
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a DevOps specialist. Focus on infrastructure, CI/CD, and deployment..."
              rows={6}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-slate-400 dark:focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-400/50 font-mono"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Custom instructions that define this agent's personality and expertise.
            </p>
          </div>

          {/* E2B Template */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Sandbox Template
            </label>
            <select
              value={e2bTemplate}
              onChange={(e) => setE2bTemplate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white focus:border-slate-400 dark:focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-400/50"
            >
              {E2B_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Pre-configured environment for this agent.
            </p>
          </div>

          {/* Extended Thinking - Hidden for Haiku which doesn't support it */}
          {!isHaikuModel && (
            <div className="bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/30 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <label className="text-sm font-medium text-purple-900 dark:text-purple-300">
                    Extended Thinking
                  </label>
                  <p className="text-xs text-purple-700 dark:text-purple-400 mt-0.5">
                    Show Claude's reasoning process in the portal
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEnableExtendedThinking(!enableExtendedThinking)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    enableExtendedThinking ? 'bg-purple-600' : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      enableExtendedThinking ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              
              {enableExtendedThinking && (
                <div className="mt-3 pt-3 border-t border-purple-200 dark:border-purple-500/30">
                  <label className="block text-xs font-medium text-purple-800 dark:text-purple-300 mb-1">
                    Thinking Budget (tokens)
                  </label>
                  <input
                    type="number"
                    value={thinkingBudgetTokens}
                    onChange={(e) => setThinkingBudgetTokens(Math.max(1000, parseInt(e.target.value) || 100000))}
                    min={1000}
                    max={100000}
                    step={1000}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-500/50 rounded text-sm text-slate-900 dark:text-white focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                  />
                  <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                    Maximum tokens for Claude's internal reasoning. Higher = more detailed thinking traces. (1,000 - 100,000)
                  </p>
                </div>
              )}
            </div>
          )}
          
          {/* Haiku notice */}
          {isHaikuModel && (
            <div className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                <span className="font-medium">Extended Thinking</span> is not available for Haiku models.
              </p>
            </div>
          )}

          {/* Output Schema */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Structured Output Schema
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-2">(SDK Feature)</span>
            </label>
            <textarea
              value={outputSchema}
              onChange={(e) => setOutputSchema(e.target.value)}
              placeholder={`{
  "type": "object",
  "properties": {
    "summary": {
      "type": "string",
      "description": "Brief summary of the task"
    },
    "status": {
      "type": "string",
      "enum": ["success", "error", "warning"]
    },
    "data": {
      "type": "object",
      "description": "Any additional data"
    }
  },
  "required": ["summary", "status"]
}`}
              rows={8}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-slate-400 dark:focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-400/50 font-mono"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              JSON Schema for structured output. When defined, the agent will return both raw text and parsed JSON matching this schema.
              <br />
              <span className="font-medium">SDK Usage:</span> <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded text-xs">result.output</code> contains the parsed object, <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded text-xs">result.result</code> contains raw text.
            </p>
          </div>

        </div>
      )}

      {/* Files Section */}
      {activeSection === 'files' && (
        <div className="space-y-6">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Attach file buckets to this agent. Files will be mounted in the sandbox when the agent runs.
          </p>

          {/* Attached Buckets */}
          <div>
            <h3 className="text-sm font-medium mb-3">Attached Buckets</h3>
            {isLoadingBuckets ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
            ) : attachedBuckets.length === 0 ? (
              <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-100 dark:bg-slate-800/30 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">No buckets attached to this agent.</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Attach a bucket below to give the agent access to your files.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {attachedBuckets.map((bucket) => (
                  <div
                    key={bucket.id}
                    className="flex items-center justify-between p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-100 dark:bg-slate-800/30"
                  >
                    <div>
                      <div className="font-medium text-sm">{bucket.bucket_name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Mount: <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">{bucket.mount_path}</code>
                        {bucket.read_only && (
                          <span className="ml-2 text-yellow-400">(read-only)</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDetachBucket(bucket.bucket_id)}
                      className="text-red-400 text-sm hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Attach New Bucket */}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
            <h3 className="text-sm font-medium mb-3">Attach a Bucket</h3>
            
            {availableBuckets.length === 0 ? (
              <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-100 dark:bg-slate-800/30 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">You don't have any buckets yet.</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Go to <a href="/files" className="text-slate-900 dark:text-white hover:underline">Files</a> to create a bucket first.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Select Bucket</label>
                  <select
                    value={selectedBucketToAttach}
                    onChange={(e) => setSelectedBucketToAttach(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white focus:border-slate-400 dark:focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-400/50"
                  >
                    <option value="">Choose a bucket...</option>
                    {availableBuckets
                      .filter(b => !attachedBuckets.some(ab => ab.bucket_id === b.id))
                      .map((bucket) => (
                        <option key={bucket.id} value={bucket.id}>
                          {bucket.name} ({(bucket.storage_used / 1024 / 1024).toFixed(1)} MB used)
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Mount Path</label>
                  <input
                    type="text"
                    value={newMountPath}
                    onChange={(e) => setNewMountPath(e.target.value)}
                    placeholder="/home/user/workspace/files"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-slate-400 dark:focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-400/50 font-mono"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Where the bucket files will appear in the sandbox.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="read-only"
                    checked={newReadOnly}
                    onChange={(e) => setNewReadOnly(e.target.checked)}
                    className="rounded border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                  <label htmlFor="read-only" className="text-sm">
                    Read-only (agent cannot modify files)
                  </label>
                </div>

                <button
                  onClick={handleAttachBucket}
                  disabled={!selectedBucketToAttach}
                  className="px-4 py-2 bg-slate-800 dark:bg-blue-500 text-white rounded text-sm font-medium hover:bg-slate-900 dark:hover:bg-blue-600 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:text-slate-500 dark:disabled:text-slate-400"
                >
                  Attach Bucket
                </button>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              💡 Files in attached buckets are synced to the sandbox when the agent starts.
              Any changes the agent makes will be synced back (unless read-only).
            </p>
          </div>
        </div>
      )}

      {/* Secrets Section */}
      {activeSection === 'secrets' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Per-agent environment variables and credentials. These will be available in the sandbox.
          </p>
          
          {secrets.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">No secrets configured.</p>
          ) : (
            <div className="space-y-3">
              {secrets.map((secret, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={secret.key}
                    onChange={(e) => updateSecret(index, 'key', e.target.value)}
                    placeholder="KEY_NAME"
                    className="w-1/3 px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-slate-400 dark:focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-400/50 font-mono"
                  />
                  <input
                    type="password"
                    value={secret.value}
                    onChange={(e) => updateSecret(index, 'value', e.target.value)}
                    placeholder="secret value"
                    className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-slate-400 dark:focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-400/50 font-mono"
                  />
                  <button
                    onClick={() => removeSecret(index)}
                    className="px-3 text-red-400 hover:text-red-300"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          
          <button
            onClick={addSecret}
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
          >
            + Add Secret
          </button>
        </div>
      )}

      {/* API Section */}
      {activeSection === 'api' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
            <div>
              <h3 className="font-medium">API Access</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Allow this agent to receive tasks via the API
              </p>
            </div>
            <button
              onClick={() => setApiEnabled(!apiEnabled)}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                apiEnabled ? 'bg-green-500' : 'bg-gray-600'
              }`}
            >
              <span
                className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  apiEnabled ? 'left-7' : 'left-1'
                }`}
              />
            </button>
          </div>

          {apiEnabled && (
            <>
              <div className="p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded">
                <span className="text-sm text-slate-500 dark:text-slate-400">Agent ID: </span>
                <code className="text-sm font-mono">{sessionId}</code>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">
                  Webhook URL
                  <span className="text-slate-500 dark:text-slate-400 font-normal ml-2">(optional)</span>
                </label>
                <input
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://your-server.com/webhook"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-slate-400 dark:focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-400/50"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  We'll POST to this URL when API tasks complete.
                </p>
              </div>

              {/* API Playground */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-4">
                <h3 className="font-medium">API Playground</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Test your agent via the API.{' '}
                  {apiKeysList.length === 0 ? (
                    <>Create an API key in <a href="/settings" className="text-blue-400 hover:underline">Settings</a> first.</>
                  ) : testApiKey ? (
                    <>Using saved API key.</>
                  ) : (
                    <>Paste your API key from <a href="/settings" className="text-blue-400 hover:underline">Settings</a>.</>
                  )}
                </p>

                {/* API Key Input */}
                <div>
                  <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">
                    API Key
                    {apiKeysList.length > 0 && !testApiKey && (
                      <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                        ({apiKeysList.length} key{apiKeysList.length > 1 ? 's' : ''} available: {apiKeysList.map(k => k.key_prefix).join(', ')})
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={testApiKey}
                    onChange={(e) => {
                      setTestApiKey(e.target.value);
                      // Save to localStorage when user enters a key
                      if (e.target.value) {
                        localStorage.setItem('api_key', e.target.value);
                      }
                    }}
                    placeholder={apiKeysList.length > 0 ? apiKeysList[0].key_prefix + '...' : 'flt_xxxxxxxxxxxxxxxx'}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-slate-400 dark:focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-400/50 font-mono"
                  />
                </div>

                {/* Task ID for Status Check */}
                <div>
                  <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Task ID (for status check)</label>
                  <input
                    type="text"
                    value={manualTaskId || testTaskId}
                    onChange={(e) => setManualTaskId(e.target.value)}
                    placeholder="Paste a task ID to check status"
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-slate-400 dark:focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-400/50 font-mono"
                  />
                </div>

                {/* Prompt Input */}
                <div>
                  <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Prompt</label>
                  <textarea
                    value={testPrompt}
                    onChange={(e) => setTestPrompt(e.target.value)}
                    placeholder="Enter your test prompt..."
                    rows={3}
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-slate-400 dark:focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-400/50"
                  />
                </div>

                {/* Curl Previews */}
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-sm text-slate-500 dark:text-slate-400">1. Submit Task</label>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(getCurlCommand());
                          setCopied('submit');
                          setTimeout(() => setCopied(null), 2000);
                        }}
                        className={`text-xs px-2 py-0.5 rounded transition-colors ${
                          copied === 'submit'
                            ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        {copied === 'submit' ? '✓ Copied!' : 'Copy'}
                      </button>
                    </div>
                    <pre className="bg-slate-100 dark:bg-slate-800 p-3 rounded text-xs font-mono overflow-x-auto text-slate-500 dark:text-slate-400">
                      {getCurlCommand()}
                    </pre>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-sm text-slate-500 dark:text-slate-400">2. Check Status</label>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(getStatusCurlCommand());
                          setCopied('status');
                          setTimeout(() => setCopied(null), 2000);
                        }}
                        className={`text-xs px-2 py-0.5 rounded transition-colors ${
                          copied === 'status'
                            ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        {copied === 'status' ? '✓ Copied!' : 'Copy'}
                      </button>
                    </div>
                    <pre className="bg-slate-100 dark:bg-slate-800 p-3 rounded text-xs font-mono overflow-x-auto text-slate-500 dark:text-slate-400">
                      {getStatusCurlCommand()}
                    </pre>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={handleTestApi}
                    disabled={testStatus === 'sending' || testStatus === 'polling' || !testPrompt.trim() || !testApiKey.trim()}
                    className="flex-1 px-4 py-2 bg-slate-800 dark:bg-blue-500 text-white rounded text-sm font-medium hover:bg-slate-900 dark:hover:bg-blue-600 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:text-slate-500 dark:disabled:text-slate-400"
                  >
                    {testStatus === 'sending' ? 'Sending...' : 
                     testStatus === 'polling' ? 'Waiting...' : 
                     'Submit Task'}
                  </button>
                  <button
                    onClick={handleCheckStatus}
                    disabled={testStatus === 'polling' || !testApiKey.trim() || !(manualTaskId || testTaskId)}
                    className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-700 disabled:border-slate-300 dark:border-slate-600 disabled:text-slate-500 dark:text-slate-400"
                  >
                    Check Status
                  </button>
                </div>

                {/* Status */}
                {testTaskId && (
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Task ID: <code className="font-mono">{testTaskId}</code>
                    <span className={`ml-2 ${
                      testStatus === 'completed' ? 'text-green-600 dark:text-green-400' :
                      testStatus === 'failed' ? 'text-red-600 dark:text-red-400' :
                      'text-yellow-600 dark:text-yellow-400'
                    }`}>
                      ({testStatus})
                    </span>
                  </div>
                )}

                {/* Result */}
                {testResult && (
                  <div className="border border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10 rounded p-3">
                    <label className="block text-sm text-green-600 dark:text-green-400 mb-1">Response</label>
                    <pre className="text-sm text-slate-900 dark:text-white whitespace-pre-wrap font-mono">
                      {testResult}
                    </pre>
                  </div>
                )}

                {/* Error */}
                {testError && (
                  <div className="border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 rounded p-3">
                    <label className="block text-sm text-red-600 dark:text-red-400 mb-1">Error</label>
                    <pre className="text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap font-mono">
                      {testError}
                    </pre>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Save Button */}
      {(
        <div className="flex justify-end pt-4 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2 bg-slate-800 dark:bg-blue-500 text-white rounded text-sm font-medium hover:bg-slate-900 dark:hover:bg-blue-600 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:text-slate-500 dark:disabled:text-slate-400"
          >
            {isSaving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      )}

      {/* Modal */}
      <Modal
        isOpen={modal.isOpen}
        onClose={closeModal}
        title={modal.title}
        message={modal.message}
        type={modal.type}
        onConfirm={modal.onConfirm}
      />
    </div>
  );
}
