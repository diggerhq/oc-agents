import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { gitlab, githubApp, GitHubAppInstallation, apiKeys, ApiKeyInfo, files, StorageConfig, StorageInfo, api } from '@/lib/api';
import { Modal } from '@/components/Modal';

// Types for integrations
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
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
    </svg>
  ),
  discord: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
    </svg>
  ),
  teams: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.5 4.5h-5.25V3a.75.75 0 0 0-.75-.75h-3A.75.75 0 0 0 9.75 3v1.5H4.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5h15a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5zM11.25 3.75h1.5v.75h-1.5v-.75zM18 18H6v-3h12v3zm0-4.5H6V12h12v1.5zm0-3H6V9h12v1.5z"/>
    </svg>
  ),
  linear: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3.138 10.862a9 9 0 0 0 10 10l-10-10zm-.794 2.31a9.003 9.003 0 0 0 8.484 8.484L2.344 13.172zM12 3a9 9 0 0 0-7.656 4.258l10.398 10.398A9 9 0 0 0 12 3z"/>
    </svg>
  ),
  jira: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
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

type SettingsTab = 'account' | 'git' | 'api' | 'storage' | 'integrations';

export function Settings() {
  const { user, checkAuth } = useAuth();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<SettingsTab>('account');
  const [message, setMessage] = useState('');
  const [isDisconnectingGitLab, setIsDisconnectingGitLab] = useState(false);
  const [gitlabConfigured, setGitlabConfigured] = useState<boolean | null>(null);
  
  // GitHub App state
  const [githubAppConfigured, setGithubAppConfigured] = useState<boolean | null>(null);
  const [githubAppName, setGithubAppName] = useState<string>('');
  const [githubAppInstallations, setGithubAppInstallations] = useState<GitHubAppInstallation[]>([]);
  const [isLoadingGitHubApp, setIsLoadingGitHubApp] = useState(true);
  
  // API Keys state
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [isLoadingKeys, setIsLoadingKeys] = useState(true);

  // Storage state
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [storageConfig, setStorageConfig] = useState<StorageConfig | null>(null);
  const [isLoadingStorage, setIsLoadingStorage] = useState(true);
  const [isSavingStorage, setIsSavingStorage] = useState(false);
  const [isTestingStorage, setIsTestingStorage] = useState(false);
  const [storageForm, setStorageForm] = useState({
    provider: 's3' as 's3' | 'r2' | 's3-compatible',
    bucket_name: '',
    region: '',
    endpoint: '',
    access_key_id: '',
    secret_access_key: '',
  });
  const [showStorageForm, setShowStorageForm] = useState(false);

  // Integrations state
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(true);
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

  // Load data on mount
  useEffect(() => {
    loadKeys();
    loadStorageConfig();
    loadIntegrations();
    checkGitLabConfigured();
    loadGitHubAppStatus();
  }, []);

  const checkGitLabConfigured = async () => {
    try {
      const result = await gitlab.getStatus();
      setGitlabConfigured(result.configured);
    } catch {
      setGitlabConfigured(false);
    }
  };

  const loadGitHubAppStatus = async () => {
    setIsLoadingGitHubApp(true);
    try {
      const status = await githubApp.getStatus();
      setGithubAppConfigured(status.configured);
      setGithubAppName(status.appName || '');
      
      if (status.configured) {
        const { installations } = await githubApp.listInstallations();
        setGithubAppInstallations(installations);
      }
    } catch (err) {
      console.error('Failed to load GitHub App status:', err);
      setGithubAppConfigured(false);
    } finally {
      setIsLoadingGitHubApp(false);
    }
  };

  const handleInstallGitHubApp = async () => {
    try {
      const { url } = await githubApp.getInstallUrl();
      // Open in new tab so we don't lose our session context
      // GitHub's Setup URL may not point to localhost, so the redirect won't work locally
      // Instead, we open in a new tab and poll for new installations when user returns
      window.open(url, '_blank');

      // Poll for new installations when user returns to this tab
      const handleVisibilityChange = async () => {
        if (document.visibilityState === 'visible') {
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          // Small delay to allow any callback/webhook to complete
          await new Promise(resolve => setTimeout(resolve, 1500));
          // Try sync first, then reload status
          try {
            await githubApp.syncInstallations();
          } catch {
            // Sync may fail if no github_id - that's ok, callback may have worked
          }
          await loadGitHubAppStatus();
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
    } catch (err) {
      setMessage('Error: Failed to get GitHub App install URL');
    }
  };

  const handleConfigureGitHubApp = async (installationId: number) => {
    try {
      const { url } = await githubApp.getConfigureUrl(installationId);
      window.open(url, '_blank');
    } catch (err) {
      setMessage('Error: Failed to get GitHub App configure URL');
    }
  };

  // Handle URL params (GitHub App/GitLab callback, tab selection)
  useEffect(() => {
    const githubAppStatus = searchParams.get('github_app');
    const gitlabStatus = searchParams.get('gitlab');
    const error = searchParams.get('error');
    const tab = searchParams.get('tab') as SettingsTab | null;

    if (tab && ['account', 'git', 'api', 'storage', 'integrations'].includes(tab)) {
      setActiveTab(tab);
    }

    if (githubAppStatus === 'installed') {
      setMessage('GitHub App installed successfully!');
      setActiveTab('git');
      loadGitHubAppStatus();
    } else if (gitlabStatus === 'connected') {
      setMessage('GitLab connected successfully!');
      setActiveTab('git');
      checkAuth();
    } else if (error) {
      const errorMessages: Record<string, string> = {
        'gitlab_already_linked': 'This GitLab account is already linked to another user',
        'github_app_error': 'Failed to complete GitHub App installation. Please try again.',
        'invalid_state': 'Invalid authentication state. Please try again.',
        'token_error': 'Failed to authenticate. Please try again.',
        'callback_error': 'Authentication failed. Please try again.',
        'gitlab_not_configured': 'GitLab OAuth is not configured on the server',
      };
      setMessage(`Error: ${errorMessages[error] || error}`);
    }
  }, [searchParams, checkAuth]);

  // ==================== API Keys ====================
  const loadKeys = async () => {
    try {
      const { keys: loadedKeys } = await apiKeys.list();
      setKeys(loadedKeys);
    } catch (err) {
      console.error('Failed to load API keys:', err);
    } finally {
      setIsLoadingKeys(false);
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    
    setIsCreatingKey(true);
    try {
      const result = await apiKeys.create(newKeyName);
      setNewlyCreatedKey(result.key);
      localStorage.setItem('api_key', result.key);
      setNewKeyName('');
      await loadKeys();
    } catch (err) {
      setMessage('Failed to create API key');
    } finally {
      setIsCreatingKey(false);
    }
  };

  const handleDeleteKey = async (id: string) => {
    setModal({
      isOpen: true,
      title: 'Revoke API Key',
      message: 'Are you sure you want to revoke this API key? This cannot be undone.',
      type: 'danger',
      onConfirm: async () => {
    try {
      await apiKeys.delete(id);
      await loadKeys();
    } catch (err) {
      setMessage('Failed to delete API key');
    }
      },
    });
  };

  // ==================== Storage ====================
  const loadStorageConfig = async () => {
    try {
      const [infoResult, configResult] = await Promise.all([
        files.getStorageInfo(),
        files.getStorageConfig(),
      ]);
      setStorageInfo(infoResult);
      setStorageConfig(configResult.config);
      if (configResult.config) {
        setStorageForm({
          provider: configResult.config.provider,
          bucket_name: configResult.config.bucket_name,
          region: configResult.config.region || '',
          endpoint: configResult.config.endpoint || '',
          access_key_id: '',
          secret_access_key: '',
        });
      }
    } catch (err) {
      console.error('Failed to load storage config:', err);
    } finally {
      setIsLoadingStorage(false);
    }
  };

  const handleSaveStorageConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storageForm.bucket_name || !storageForm.access_key_id || !storageForm.secret_access_key) {
      setMessage('Please fill in all required fields');
      return;
    }

    setIsSavingStorage(true);
    try {
      const result = await files.saveStorageConfig({
        provider: storageForm.provider,
        bucket_name: storageForm.bucket_name,
        region: storageForm.region || undefined,
        endpoint: storageForm.endpoint || undefined,
        access_key_id: storageForm.access_key_id,
        secret_access_key: storageForm.secret_access_key,
      });
      setStorageConfig(result.config);
      setMessage('Storage configuration saved! Click "Test Connection" to verify.');
      setShowStorageForm(false);
      setStorageForm(prev => ({ ...prev, access_key_id: '', secret_access_key: '' }));
      await loadStorageConfig();
    } catch (err: any) {
      setMessage(`Error: ${err.message || 'Failed to save storage config'}`);
    } finally {
      setIsSavingStorage(false);
    }
  };

  const handleTestStorageConfig = async () => {
    setIsTestingStorage(true);
    try {
      const result = await files.testStorageConfig();
      if (result.success) {
        setMessage('Connection successful! Your bucket is ready to use.');
      } else {
        setMessage(`Error: Connection failed - ${result.error}`);
      }
      await loadStorageConfig();
    } catch (err: any) {
      setMessage(`Error: ${err.message || 'Test failed'}`);
    } finally {
      setIsTestingStorage(false);
    }
  };

  const handleDeleteStorageConfig = async () => {
    setModal({
      isOpen: true,
      title: 'Remove Storage Configuration',
      message: 'Are you sure you want to remove your storage configuration?',
      type: 'danger',
      onConfirm: async () => {
        try {
          await files.deleteStorageConfig();
          setStorageConfig(null);
          setStorageForm({
            provider: 's3',
            bucket_name: '',
            region: '',
            endpoint: '',
            access_key_id: '',
            secret_access_key: '',
          });
          setMessage('Storage configuration removed.');
          await loadStorageConfig();
        } catch (err: any) {
          setMessage(`Error: ${err.message || 'Failed to remove config'}`);
        }
      },
    });
  };

  // ==================== Integrations ====================
  const loadIntegrations = async () => {
    try {
      const [integrationsRes, agentsRes] = await Promise.all([
        api.get('/integrations'),
        api.get('/sessions'),
      ]);
      setIntegrations(integrationsRes.integrations || []);
      setAgents(agentsRes.sessions || []);
    } catch (err) {
      console.error('Failed to load integrations:', err);
    } finally {
      setIsLoadingIntegrations(false);
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

  const handleCreateIntegration = async () => {
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
      await loadIntegrations();
    } catch (err: any) {
      setMessage(`Error: ${err.message || 'Failed to create integration'}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteIntegration = async (id: string) => {
    setModal({
      isOpen: true,
      title: 'Delete Integration',
      message: 'Are you sure you want to delete this integration?',
      type: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/integrations/${id}`);
          setMessage('Integration deleted');
          await loadIntegrations();
        } catch (err) {
          setMessage('Failed to delete integration');
        }
      },
    });
  };

  const handleToggleIntegration = async (id: string, currentStatus: number) => {
    try {
      await api.patch(`/integrations/${id}`, { is_active: currentStatus ? 0 : 1 });
      await loadIntegrations();
    } catch (err) {
      setMessage('Failed to update integration');
    }
  };

  // ==================== GitLab ====================
  const handleConnectGitLab = () => {
    window.location.href = '/api/auth/gitlab/connect';
  };

  const handleDisconnectGitLab = async () => {
    setIsDisconnectingGitLab(true);
    try {
      await gitlab.disconnect();
      await checkAuth();
      setMessage('GitLab disconnected');
    } catch {
      setMessage('Failed to disconnect GitLab');
    } finally {
      setIsDisconnectingGitLab(false);
    }
  };

  // ==================== GitHub App ====================
  const handleRemoveGitHubAppInstallation = async (installationId: number, accountLogin: string) => {
    if (!confirm(`Remove GitHub App installation for @${accountLogin}? This will prevent agents from accessing repositories from this account.`)) {
      return;
    }

    try {
      await githubApp.removeInstallation(installationId);
      setMessage(`Removed GitHub App installation for @${accountLogin}`);
      loadGitHubAppStatus(); // Reload the list
    } catch (err) {
      setMessage(`Failed to remove installation for @${accountLogin}`);
    }
  };

  // ==================== Helpers ====================
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setMessage('Copied to clipboard!');
    setTimeout(() => setMessage(''), 2000);
  };

  const platforms = ['slack', 'discord', 'teams', 'linear', 'jira'] as const;

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'account', label: 'Account' },
    { id: 'git', label: 'Git Providers' },
    { id: 'api', label: 'API Keys' },
    { id: 'storage', label: 'Storage' },
    { id: 'integrations', label: 'Integrations' },
  ];

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Manage your account and integrations</p>
      </div>

      {message && (
        <div
          className={`mb-6 px-4 py-3 rounded-lg text-sm ${
            message.startsWith('Error') || message.includes('failed')
              ? 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400'
              : 'bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-400'
          }`}
        >
          {message}
          <button onClick={() => setMessage('')} className="float-right text-current hover:opacity-70">×</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-slate-800 dark:border-blue-500 text-slate-900 dark:text-blue-500'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
            {tab.id === 'integrations' && integrations.length > 0 && (
              <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">({integrations.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Account Tab */}
      {activeTab === 'account' && (
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Account</h2>
          <div className="text-sm">
            <span className="text-gray-500 dark:text-gray-400">Email:</span>{' '}
            <span className="text-gray-900 dark:text-white font-medium">{user?.email}</span>
          </div>
        </div>
      )}

      {/* Git Providers Tab */}
      {activeTab === 'git' && (
        <div className="space-y-6">
          {/* GitHub App */}
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <svg className="w-6 h-6 text-gray-900 dark:text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              <h2 className="font-semibold text-gray-900 dark:text-white">GitHub</h2>
              {githubAppConfigured && (
                <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded-full font-medium">
                  App Integration
                </span>
              )}
            </div>
            
            {isLoadingGitHubApp ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
            ) : !githubAppConfigured ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  GitHub App is not configured on this server. Contact your administrator to enable it.
                </p>
              </div>
            ) : githubAppInstallations.length > 0 ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  The {githubAppName} GitHub App is installed on the following accounts. Agents can access repositories from these installations.
                </p>
                
                <div className="space-y-3">
                  {githubAppInstallations.map((installation) => (
                    <div
                      key={installation.installation_id}
                      className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-slate-700 flex items-center justify-center text-gray-600 dark:text-gray-300 text-sm font-medium">
                          {installation.account_login.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            @{installation.account_login}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                            {installation.account_type}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleConfigureGitHubApp(installation.installation_id)}
                          className="text-sm text-slate-700 dark:text-blue-400 hover:text-slate-900 dark:hover:text-blue-300 font-medium"
                        >
                          Configure
                        </button>
                        <button
                          onClick={() => handleRemoveGitHubAppInstallation(installation.installation_id, installation.account_login)}
                          className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium"
                          title="Remove this installation"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className="flex items-center gap-4">
                  <button
                    onClick={handleInstallGitHubApp}
                    className="text-sm text-slate-700 dark:text-blue-400 hover:text-slate-900 dark:hover:text-blue-300 font-medium"
                  >
                    + Install on another account
                  </button>
                  <button
                    onClick={loadGitHubAppStatus}
                    className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    title="Refresh installations"
                  >
                    ↻ Refresh
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Install the {githubAppName || 'GitHub App'} to allow agents to access your repositories with granular permissions.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleInstallGitHubApp}
                    className="bg-slate-800 hover:bg-slate-900 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                    Install GitHub App
                  </button>
                  <button
                    onClick={loadGitHubAppStatus}
                    className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    title="Already installed? Click to refresh"
                  >
                    ↻ Refresh
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* GitLab */}
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <svg className="w-6 h-6 text-orange-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"/>
              </svg>
              <h2 className="font-semibold text-gray-900 dark:text-white">GitLab</h2>
            </div>
            {gitlabConfigured === false ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                GitLab OAuth is not configured on this server. Contact your administrator to enable it.
              </p>
            ) : user?.gitlab_connected ? (
              <div className="space-y-4">
                <p className="text-sm">
                  <span className="text-green-600 dark:text-green-400 font-medium">Connected</span>
                  <span className="text-gray-500 dark:text-gray-400"> as </span>
                  <span className="text-gray-900 dark:text-white font-medium">@{user.gitlab_username}</span>
                </p>
                <button
                  onClick={handleDisconnectGitLab}
                  disabled={isDisconnectingGitLab}
                  className="border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                >
                  {isDisconnectingGitLab ? 'Disconnecting...' : 'Disconnect GitLab'}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Connect your GitLab account to create repo-backed buckets and let agents access your GitLab repositories.
                </p>
                <button
                  onClick={handleConnectGitLab}
                  className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"/>
                  </svg>
                  Connect GitLab
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* API Keys Tab */}
      {activeTab === 'api' && (
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4">API Keys</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Create API keys to access your agents programmatically via the API.
          </p>

          <form onSubmit={handleCreateKey} className="flex gap-3 mb-6">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g., Production, CI/CD)"
              className="flex-1 px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={isCreatingKey || !newKeyName.trim()}
              className="px-4 py-2.5 bg-slate-800 dark:bg-blue-500 hover:bg-slate-900 dark:hover:bg-blue-600 text-white rounded-lg text-sm font-medium disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 transition-colors"
            >
              {isCreatingKey ? 'Creating...' : 'Create Key'}
            </button>
          </form>

          {newlyCreatedKey && (
            <div className="mb-6 p-4 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-lg">
              <p className="text-sm text-green-700 dark:text-green-400 mb-2 font-medium">
                API key created! Copy it now - you won't be able to see it again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-900 text-green-400 px-3 py-2 rounded-lg text-sm font-mono break-all">
                  {newlyCreatedKey}
                </code>
                <button
                  onClick={() => copyToClipboard(newlyCreatedKey)}
                  className="px-3 py-2 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-900 dark:text-white rounded-lg text-sm transition-colors"
                >
                  Copy
                </button>
                <button
                  onClick={() => setNewlyCreatedKey(null)}
                  className="px-3 py-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {isLoadingKeys ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading keys...</p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No API keys yet. Create one above.</p>
          ) : (
            <div className="space-y-3">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between p-4 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg"
                >
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white">{key.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                      {key.key_prefix}
                      {key.last_used_at && (
                        <span className="ml-3">
                          Last used: {new Date(key.last_used_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteKey(key.id)}
                    className="text-red-600 dark:text-red-400 text-sm font-medium hover:text-red-700 dark:hover:text-red-300"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">API Usage</h3>
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs font-mono overflow-x-auto">
{`# Submit a task to an agent
curl -X POST ${window.location.origin}/api/v1/agents/{agentId}/tasks \\
  -H "Authorization: Bearer flt_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "What files are in this repo?"}'

# Check task status
curl ${window.location.origin}/api/v1/agents/{agentId}/tasks/{taskId} \\
  -H "Authorization: Bearer flt_xxx"`}
            </pre>
          </div>
        </div>
      )}

      {/* Storage Tab */}
      {activeTab === 'storage' && (
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4">File Storage</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Configure your own S3-compatible storage for file uploads.
          </p>

          {isLoadingStorage ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading storage configuration...</p>
          ) : (
            <>
              <div className="mb-6 p-4 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">Current Storage</span>
                  {storageInfo?.isUserOwned ? (
                    <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 rounded-full font-medium">Your Bucket</span>
                  ) : storageInfo?.configured ? (
                    <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded-full font-medium">System Storage</span>
                  ) : (
                    <span className="text-xs px-2 py-1 bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 rounded-full font-medium">Database Only</span>
                  )}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {storageInfo?.isUserOwned ? (
                    <>
                      <p>Provider: <span className="text-gray-900 dark:text-white font-medium">{storageInfo.backend}</span></p>
                      <p>Bucket: <span className="text-gray-900 dark:text-white font-medium">{storageInfo.bucket}</span></p>
                      {storageConfig?.test_status && (
                        <p>
                          Status:{' '}
                          <span className={storageConfig.test_status === 'success' ? 'text-green-600 dark:text-green-400 font-medium' : storageConfig.test_status === 'failed' ? 'text-red-600 dark:text-red-400 font-medium' : 'text-yellow-600 dark:text-yellow-400 font-medium'}>
                            {storageConfig.test_status === 'success' ? '✓ Connected' : storageConfig.test_status === 'failed' ? '✗ Failed' : '○ Untested'}
                          </span>
                        </p>
                      )}
                    </>
                  ) : storageInfo?.configured ? (
                    <p>Using shared storage provided by the platform.</p>
                  ) : (
                    <p>Files are stored in the database. Configure your own bucket for better performance.</p>
                  )}
                </div>
              </div>

              {storageConfig && !showStorageForm ? (
                <div className="flex gap-3">
                  <button
                    onClick={handleTestStorageConfig}
                    disabled={isTestingStorage}
                    className="px-4 py-2 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-900 dark:text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    {isTestingStorage ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button
                    onClick={() => setShowStorageForm(true)}
                    className="px-4 py-2 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-900 dark:text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Update Config
                  </button>
                  <button
                    onClick={handleDeleteStorageConfig}
                    className="px-4 py-2 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 rounded-lg text-sm font-medium hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ) : !showStorageForm ? (
                <button
                  onClick={() => setShowStorageForm(true)}
                  className="px-4 py-2.5 bg-slate-800 dark:bg-blue-500 hover:bg-slate-900 dark:hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Configure Your Own Bucket
                </button>
              ) : null}

              {showStorageForm && (
                <form onSubmit={handleSaveStorageConfig} className="space-y-4 mt-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Provider</label>
                    <select
                      value={storageForm.provider}
                      onChange={(e) => setStorageForm({ ...storageForm, provider: e.target.value as any })}
                      className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="s3">AWS S3</option>
                      <option value="r2">Cloudflare R2</option>
                      <option value="s3-compatible">S3-Compatible</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bucket Name *</label>
                    <input
                      type="text"
                      value={storageForm.bucket_name}
                      onChange={(e) => setStorageForm({ ...storageForm, bucket_name: e.target.value })}
                      placeholder="my-bucket"
                      className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>

                  {storageForm.provider === 's3' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Region</label>
                      <input
                        type="text"
                        value={storageForm.region}
                        onChange={(e) => setStorageForm({ ...storageForm, region: e.target.value })}
                        placeholder="us-east-1"
                        className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  )}

                  {(storageForm.provider === 'r2' || storageForm.provider === 's3-compatible') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Endpoint *</label>
                      <input
                        type="text"
                        value={storageForm.endpoint}
                        onChange={(e) => setStorageForm({ ...storageForm, endpoint: e.target.value })}
                        placeholder={storageForm.provider === 'r2' ? 'https://<account_id>.r2.cloudflarestorage.com' : 'https://s3.example.com'}
                        className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Access Key ID *</label>
                    <input
                      type="text"
                      value={storageForm.access_key_id}
                      onChange={(e) => setStorageForm({ ...storageForm, access_key_id: e.target.value })}
                      placeholder={storageConfig ? '••••••••••••' : 'AKIAIOSFODNN7EXAMPLE'}
                      className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Secret Access Key *</label>
                    <input
                      type="password"
                      value={storageForm.secret_access_key}
                      onChange={(e) => setStorageForm({ ...storageForm, secret_access_key: e.target.value })}
                      placeholder={storageConfig ? '••••••••••••••••••••••••••••••••' : ''}
                      className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="submit"
                      disabled={isSavingStorage}
                      className="px-4 py-2.5 bg-slate-800 dark:bg-blue-500 hover:bg-slate-900 dark:hover:bg-blue-600 text-white rounded-lg text-sm font-medium disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 transition-colors"
                    >
                      {isSavingStorage ? 'Saving...' : 'Save Configuration'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowStorageForm(false)}
                      className="px-4 py-2.5 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-900 dark:text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === 'integrations' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">Connect external services to trigger your agents</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2.5 bg-slate-800 dark:bg-blue-500 hover:bg-slate-900 dark:hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              + Add Integration
            </button>
          </div>

          {isLoadingIntegrations ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading integrations...</p>
          ) : integrations.length === 0 ? (
            <div className="border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-xl p-12 text-center">
              <p className="text-gray-500 dark:text-gray-400 mb-4">No integrations configured yet</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="text-slate-700 dark:text-blue-400 hover:text-slate-900 dark:hover:text-blue-300 text-sm font-medium"
              >
                Add your first integration →
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {integrations.map((integration) => (
                <div
                  key={integration.id}
                  className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden"
                >
                  <div className="p-4 flex items-center gap-4">
                    <div className={`${PLATFORM_COLORS[integration.platform]}`}>
                      {PLATFORM_ICONS[integration.platform]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-gray-900 dark:text-white truncate">{integration.name}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          integration.is_active
                            ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400'
                            : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400'
                        }`}>
                          {integration.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{integration.platform}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpandedId(expandedId === integration.id ? null : integration.id)}
                        className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-900 dark:text-white rounded-lg transition-colors"
                      >
                        {expandedId === integration.id ? 'Hide' : 'Details'}
                      </button>
                      <button
                        onClick={() => handleToggleIntegration(integration.id, integration.is_active)}
                        className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-900 dark:text-white rounded-lg transition-colors"
                      >
                        {integration.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => handleDeleteIntegration(integration.id)}
                        className="px-3 py-1.5 text-sm border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  
                  {expandedId === integration.id && (
                    <div className="px-4 pb-4 border-t border-gray-100 dark:border-slate-700 pt-4 space-y-3">
                      <div>
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Webhook URL</label>
                        <div className="flex items-center gap-2 mt-1">
                          <code className="flex-1 bg-gray-900 text-gray-100 px-3 py-2 rounded-lg text-xs font-mono truncate">
                            {integration.webhook_url}
                          </code>
                          <button
                            onClick={() => copyToClipboard(integration.webhook_url)}
                            className="px-3 py-2 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-900 dark:text-white rounded-lg text-xs transition-colors"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add Integration Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 dark:text-white">
                {selectedPlatform ? `Configure ${selectedPlatform}` : 'Add Integration'}
              </h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setSelectedPlatform(null);
                  setPlatformSetup(null);
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                ✕
              </button>
            </div>

            <div className="p-4">
              {!selectedPlatform ? (
                <div className="grid grid-cols-2 gap-3">
                  {platforms.map((platform) => (
                    <button
                      key={platform}
                      onClick={() => loadPlatformSetup(platform)}
                      className="flex items-center gap-3 p-4 border border-gray-200 dark:border-slate-700 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-700 text-left transition-colors"
                    >
                      <div className={PLATFORM_COLORS[platform]}>
                        {PLATFORM_ICONS[platform]}
                      </div>
                      <span className="capitalize font-medium text-gray-900 dark:text-white">{platform}</span>
                    </button>
                  ))}
                </div>
              ) : platformSetup ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Integration Name *</label>
                    <input
                      type="text"
                      value={newIntegration.name}
                      onChange={(e) => setNewIntegration({ ...newIntegration, name: e.target.value })}
                      placeholder={`My ${selectedPlatform} Integration`}
                      className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Default Agent</label>
                    <select
                      value={newIntegration.default_agent_id}
                      onChange={(e) => setNewIntegration({ ...newIntegration, default_agent_id: e.target.value })}
                      className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">Select an agent...</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.display_name || agent.config_name || agent.repo_name || agent.id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {platformSetup.config_fields.map((field) => (
                    <div key={field.key}>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {field.label} {field.required && '*'}
                      </label>
                      {field.type === 'select' && field.options ? (
                        <select
                          value={newIntegration.config[field.key] || field.default || ''}
                          onChange={(e) => setNewIntegration({
                            ...newIntegration,
                            config: { ...newIntegration.config, [field.key]: e.target.value }
                          })}
                          className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          {field.options.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={field.type}
                          value={newIntegration.config[field.key] || ''}
                          onChange={(e) => setNewIntegration({
                            ...newIntegration,
                            config: { ...newIntegration.config, [field.key]: e.target.value }
                          })}
                          className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      )}
                    </div>
                  ))}

                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={handleCreateIntegration}
                      disabled={isCreating || !newIntegration.name}
                      className="flex-1 px-4 py-2.5 bg-slate-800 dark:bg-blue-500 hover:bg-slate-900 dark:hover:bg-blue-600 text-white rounded-lg text-sm font-medium disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 transition-colors"
                    >
                      {isCreating ? 'Creating...' : 'Create Integration'}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedPlatform(null);
                        setPlatformSetup(null);
                      }}
                      className="px-4 py-2.5 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-900 dark:text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Back
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-sm">Loading setup...</p>
              )}
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
