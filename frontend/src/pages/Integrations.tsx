import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';

interface Integration {
  id: string;
  platform: 'slack' | 'discord' | 'teams' | 'linear' | 'jira';
  name: string;
  config: Record<string, any>;
  webhook_url: string;
  webhook_secret: string;
  is_active: number;
  default_agent_id: string | null;
  last_used_at: string | null;
  created_at: string;
}

interface Agent {
  id: string;
  repo_name?: string;
  config_name?: string;
  display_name?: string;
  agent_type: 'code' | 'task';
  status: string;
}

interface PlatformSetup {
  name: string;
  icon: string;
  description: string;
  steps: string[];
  features: string[];
  config_fields: Array<{
    key: string;
    label: string;
    type: string;
    required?: boolean;
    default?: any;
    options?: string[];
  }>;
  webhook_base_url: string;
}

const PLATFORM_ICONS: Record<string, JSX.Element> = {
  slack: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
    </svg>
  ),
  discord: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
    </svg>
  ),
  teams: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.5 4.5h-5.25V3a.75.75 0 0 0-.75-.75h-3A.75.75 0 0 0 9.75 3v1.5H4.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5h15a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5zM11.25 3.75h1.5v.75h-1.5v-.75zM18 18H6v-3h12v3zm0-4.5H6V12h12v1.5zm0-3H6V9h12v1.5z"/>
    </svg>
  ),
  linear: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3.138 10.862a9 9 0 0 0 10 10l-10-10zm-.794 2.31a9.003 9.003 0 0 0 8.484 8.484L2.344 13.172zM12 3a9 9 0 0 0-7.656 4.258l10.398 10.398A9 9 0 0 0 12 3z"/>
    </svg>
  ),
  jira: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.005 1.005 0 0 0 23.013 0z"/>
    </svg>
  ),
};

const PLATFORM_COLORS: Record<string, string> = {
  slack: 'text-[#E01E5A]',
  discord: 'text-[#5865F2]',
  teams: 'text-[#6264A7]',
  linear: 'text-[#5E6AD2]',
  jira: 'text-[#0052CC]',
};

export function Integrations() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [platformSetup, setPlatformSetup] = useState<PlatformSetup | null>(null);
  const [newIntegration, setNewIntegration] = useState({ name: '', config: {} as Record<string, any>, default_agent_id: '' });
  const [isCreating, setIsCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  
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
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [integrationsRes, agentsRes] = await Promise.all([
        api.get('/integrations'),
        api.get('/sessions'),
      ]);
      setIntegrations(integrationsRes.integrations || []);
      setAgents(agentsRes.sessions || []);
    } catch (err) {
      console.error('Failed to load data:', err);
      setMessage('Failed to load integrations');
    } finally {
      setIsLoading(false);
    }
  };

  const loadPlatformSetup = async (platform: string) => {
    try {
      const setup = await api.get(`/integrations/setup/${platform}`);
      setPlatformSetup(setup);
      setSelectedPlatform(platform);
    } catch (err) {
      console.error('Failed to load setup:', err);
    }
  };

  const handleCreate = async () => {
    if (!selectedPlatform || !newIntegration.name) return;
    
    setIsCreating(true);
    try {
      await api.post('/integrations', {
        platform: selectedPlatform,
        name: newIntegration.name,
        config: newIntegration.config,
        default_agent_id: newIntegration.default_agent_id || null,
      });
      setMessage('Integration created successfully!');
      setShowAddModal(false);
      setSelectedPlatform(null);
      setPlatformSetup(null);
      setNewIntegration({ name: '', config: {}, default_agent_id: '' });
      await loadData();
    } catch (err: any) {
      setMessage(`Error: ${err.message || 'Failed to create integration'}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setModal({
      isOpen: true,
      title: 'Delete Integration',
      message: 'Are you sure you want to delete this integration?',
      type: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/integrations/${id}`);
          setMessage('Integration deleted');
          await loadData();
        } catch (err) {
          setMessage('Failed to delete integration');
        }
      },
    });
  };

  const handleToggle = async (id: string, currentStatus: number) => {
    try {
      await api.patch(`/integrations/${id}`, { is_active: currentStatus ? 0 : 1 });
      await loadData();
    } catch (err) {
      setMessage('Failed to update integration');
    }
  };

  const handleTest = async (id: string) => {
    try {
      const result = await api.post(`/integrations/${id}/test`);
      setMessage(`Test task created: ${result.task_id}`);
    } catch (err: any) {
      setMessage(`Test failed: ${err.message || 'Unknown error'}`);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setMessage('Copied to clipboard!');
    setTimeout(() => setMessage(''), 2000);
  };

  const platforms = ['slack', 'discord', 'teams', 'linear', 'jira'] as const;

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-12">
        <p className="text-slate-500 dark:text-slate-400">Loading integrations...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-medium">Integrations</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Connect external services to trigger your agents</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-white text-black rounded text-sm font-medium hover:bg-gray-200"
        >
          + Add Integration
        </button>
      </div>

      {message && (
        <div className={`mb-6 px-4 py-3 rounded text-sm ${
          message.startsWith('Error') || message.startsWith('Test failed')
            ? 'bg-red-500/10 border border-red-500/50 text-red-400'
            : 'bg-green-500/10 border border-green-500/50 text-green-400'
        }`}>
          {message}
        </div>
      )}

      {/* Active Integrations */}
      {integrations.length === 0 ? (
        <div className="border border-dashed border-slate-200 dark:border-slate-700 rounded-lg p-12 text-center">
          <p className="text-slate-500 dark:text-slate-400 mb-4">No integrations configured yet</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="text-slate-900 dark:text-white hover:underline text-sm"
          >
            Add your first integration →
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {integrations.map((integration) => (
            <div
              key={integration.id}
              className="border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 overflow-hidden"
            >
              <div className="p-4 flex items-center gap-4">
                <div className={`${PLATFORM_COLORS[integration.platform]}`}>
                  {PLATFORM_ICONS[integration.platform]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium truncate">{integration.name}</h3>
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      integration.is_active
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {integration.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 capitalize">{integration.platform}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTest(integration.id)}
                    className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded text-xs hover:bg-white/5"
                  >
                    Test
                  </button>
                  <button
                    onClick={() => handleToggle(integration.id, integration.is_active)}
                    className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded text-xs hover:bg-white/5"
                  >
                    {integration.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => setExpandedId(expandedId === integration.id ? null : integration.id)}
                    className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded text-xs hover:bg-white/5"
                  >
                    {expandedId === integration.id ? 'Hide' : 'Details'}
                  </button>
                  <button
                    onClick={() => handleDelete(integration.id)}
                    className="px-3 py-1.5 border border-red-500/30 text-red-400 rounded text-xs hover:bg-red-500/10"
                  >
                    Delete
                  </button>
                </div>
              </div>
              
              {expandedId === integration.id && (
                <div className="border-t border-slate-200 dark:border-slate-700 p-4 bg-black/20 space-y-4">
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Webhook URL</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-black px-3 py-2 rounded text-xs font-mono break-all">
                        {integration.webhook_url}
                      </code>
                      <button
                        onClick={() => copyToClipboard(integration.webhook_url)}
                        className="px-3 py-2 border border-slate-200 dark:border-slate-700 rounded text-xs hover:bg-white/5 shrink-0"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  {integration.last_used_at && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Last used: {new Date(integration.last_used_at).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Integration Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-lg font-medium">
                {selectedPlatform ? `Setup ${platformSetup?.name}` : 'Add Integration'}
              </h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setSelectedPlatform(null);
                  setPlatformSetup(null);
                  setNewIntegration({ name: '', config: {}, default_agent_id: '' });
                }}
                className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
              >
                ✕
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
              {!selectedPlatform ? (
                // Platform selection
                <div className="grid grid-cols-2 gap-4">
                  {platforms.map((platform) => (
                    <button
                      key={platform}
                      onClick={() => loadPlatformSetup(platform)}
                      className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg hover:border-white/30 text-left transition-colors"
                    >
                      <div className={`mb-3 ${PLATFORM_COLORS[platform]}`}>
                        {PLATFORM_ICONS[platform]}
                      </div>
                      <h3 className="font-medium capitalize">{platform}</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {platform === 'slack' && 'Slash commands & @mentions'}
                        {platform === 'discord' && 'Bot commands'}
                        {platform === 'teams' && 'Outgoing webhooks'}
                        {platform === 'linear' && 'Issue automation'}
                        {platform === 'jira' && 'Issue automation'}
                      </p>
                    </button>
                  ))}
                </div>
              ) : platformSetup ? (
                // Platform configuration
                <div className="space-y-6">
                  <div className="bg-black/30 rounded-lg p-4">
                    <h3 className="font-medium mb-2 flex items-center gap-2">
                      <span className={PLATFORM_COLORS[selectedPlatform]}>
                        {PLATFORM_ICONS[selectedPlatform]}
                      </span>
                      {platformSetup.name}
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{platformSetup.description}</p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {platformSetup.features.map((feature) => (
                        <span key={feature} className="px-2 py-1 bg-white/5 rounded text-xs">
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Integration Name *</label>
                    <input
                      type="text"
                      value={newIntegration.name}
                      onChange={(e) => setNewIntegration({ ...newIntegration, name: e.target.value })}
                      placeholder={`My ${platformSetup.name} Integration`}
                      className="w-full px-3 py-2 bg-black border border-slate-200 dark:border-slate-700 rounded text-sm focus:border-white/30 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Default Agent</label>
                    <select
                      value={newIntegration.default_agent_id}
                      onChange={(e) => setNewIntegration({ ...newIntegration, default_agent_id: e.target.value })}
                      className="w-full px-3 py-2 bg-black border border-slate-200 dark:border-slate-700 rounded text-sm focus:border-white/30 focus:outline-none"
                    >
                      <option value="">Select an agent...</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.display_name || agent.config_name || agent.repo_name || `Agent ${agent.id.slice(0, 8)}`}
                          {agent.agent_type === 'task' ? ' (Task)' : ' (Code)'}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Tasks from this integration will be sent to this agent</p>
                  </div>

                  {/* Dynamic config fields */}
                  {platformSetup.config_fields.filter(f => f.type !== 'agent_select').map((field) => (
                    <div key={field.key}>
                      <label className="block text-sm font-medium mb-2">
                        {field.label} {field.required && '*'}
                      </label>
                      {field.type === 'textarea' ? (
                        <textarea
                          value={newIntegration.config[field.key] || field.default || ''}
                          onChange={(e) => setNewIntegration({
                            ...newIntegration,
                            config: { ...newIntegration.config, [field.key]: e.target.value }
                          })}
                          rows={4}
                          className="w-full px-3 py-2 bg-black border border-slate-200 dark:border-slate-700 rounded text-sm font-mono focus:border-white/30 focus:outline-none"
                        />
                      ) : field.type === 'boolean' ? (
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={newIntegration.config[field.key] ?? field.default ?? false}
                            onChange={(e) => setNewIntegration({
                              ...newIntegration,
                              config: { ...newIntegration.config, [field.key]: e.target.checked }
                            })}
                            className="rounded"
                          />
                          <span className="text-sm text-slate-500 dark:text-slate-400">Enable</span>
                        </label>
                      ) : field.type === 'multi_select' ? (
                        <div className="flex flex-wrap gap-2">
                          {field.options?.map((option) => (
                            <label key={option} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={(newIntegration.config[field.key] || field.default || []).includes(option)}
                                onChange={(e) => {
                                  const current = newIntegration.config[field.key] || field.default || [];
                                  const updated = e.target.checked
                                    ? [...current, option]
                                    : current.filter((o: string) => o !== option);
                                  setNewIntegration({
                                    ...newIntegration,
                                    config: { ...newIntegration.config, [field.key]: updated }
                                  });
                                }}
                                className="rounded"
                              />
                              <span className="text-sm">{option}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={newIntegration.config[field.key] || ''}
                          onChange={(e) => setNewIntegration({
                            ...newIntegration,
                            config: { ...newIntegration.config, [field.key]: e.target.value }
                          })}
                          className="w-full px-3 py-2 bg-black border border-slate-200 dark:border-slate-700 rounded text-sm focus:border-white/30 focus:outline-none"
                        />
                      )}
                    </div>
                  ))}

                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                    <h4 className="font-medium text-amber-400 mb-2">Setup Instructions</h4>
                    <ol className="text-sm text-slate-500 dark:text-slate-400 space-y-2 list-decimal list-inside">
                      {platformSetup.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </div>
                </div>
              ) : (
                <p className="text-slate-500 dark:text-slate-400">Loading...</p>
              )}
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-between">
              {selectedPlatform && (
                <button
                  onClick={() => {
                    setSelectedPlatform(null);
                    setPlatformSetup(null);
                  }}
                  className="px-4 py-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white text-sm"
                >
                  ← Back
                </button>
              )}
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setSelectedPlatform(null);
                    setPlatformSetup(null);
                    setNewIntegration({ name: '', config: {}, default_agent_id: '' });
                  }}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded text-sm hover:bg-white/5"
                >
                  Cancel
                </button>
                {selectedPlatform && (
                  <button
                    onClick={handleCreate}
                    disabled={isCreating || !newIntegration.name}
                    className="px-4 py-2 bg-white text-black rounded text-sm font-medium hover:bg-gray-200 disabled:bg-gray-600 disabled:text-gray-400"
                  >
                    {isCreating ? 'Creating...' : 'Create Integration'}
                  </button>
                )}
              </div>
            </div>
          </div>
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
