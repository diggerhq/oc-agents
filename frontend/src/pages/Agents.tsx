import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { sessions, githubApp, gitlab, agent, Session, Repository, Branch, ModelProviderGroup, GitHubAppInstallation } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { ModelSelector } from '@/components/ModelSelector';
import { Modal } from '@/components/Modal';
import { ShareResourceModal } from '@/components/ShareResourceModal';

type AgentProvider = 'claude-code' | 'aider' | 'opencode';
type AgentType = 'code' | 'task' | 'portal' | 'portal-sandbox';
type RepoSource = 'existing' | 'create-new' | 'local';
type GitProvider = 'github' | 'gitlab';

const PROVIDERS: { id: AgentProvider; name: string; description: string }[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: "Anthropic's agentic coding CLI",
  },
  // {
  //   id: 'aider',
  //   name: 'Aider',
  //   description: 'AI pair programming (OpenAI)',
  // },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: '75 providers, 100k+ models',
  },
];

const SYSTEM_PROMPT_TEMPLATES = [
  {
    id: 'support',
    name: 'Support Agent',
    prompt: 'You are a helpful customer support agent. Be friendly, concise, and accurate. If you don\'t know the answer, say so honestly rather than guessing.',
  },
  {
    id: 'research',
    name: 'Research Agent',
    prompt: 'You are a research agent. Thoroughly investigate topics, cite sources, and provide well-structured analysis. Present findings clearly with key takeaways.',
  },
  {
    id: 'analyst',
    name: 'Data Analyst',
    prompt: 'You are a data analyst agent. Analyze data, identify patterns and trends, and provide clear insights. Use precise language and support conclusions with evidence.',
  },
  {
    id: 'sre',
    name: 'AI SRE',
    prompt: 'You are an AI Site Reliability Engineer. Monitor system health, diagnose incidents, recommend infrastructure improvements, and help maintain high availability. Focus on reliability, scalability, and operational excellence.',
  },
  {
    id: 'sdr',
    name: 'AI SDR',
    prompt: 'You are an AI Sales Development Representative. Qualify leads, craft personalized outreach, research prospects, and help build pipeline. Be professional, persuasive, and focused on understanding customer needs.',
  },
];

const CLAUDE_CODE_MODELS: { id: string; name: string; description: string }[] = [
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', description: 'Best coding model, great for agents (default)' },
  { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', description: 'Most intelligent, complex specialized tasks' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Previous gen, still excellent' },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', description: 'Previous gen, highly capable' },
  { id: 'claude-haiku-4-20250514', name: 'Claude Haiku 4', description: 'Fastest, best for simple tasks' },
];

// Only task agents for now — code and portal types commented out
const AGENT_TYPES: { id: AgentType; name: string; description: string }[] = [
  // {
  //   id: 'code',
  //   name: 'Code Agent',
  //   description: 'Works with a repository, makes code changes',
  // },
  {
    id: 'task',
    name: 'Task Agent',
    description: 'Runs prompts/workflows, no repo required',
  },
  // {
  //   id: 'portal-sandbox',
  //   name: 'Portal Agent',
  //   description: 'Streamlined portal with setup wizard, skills & knowledge',
  // },
];

export function Agents() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [agentList, setAgentList] = useState<Session[]>([]);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // New agent form
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [agentType, setAgentType] = useState<AgentType>('task');
  const [agentName, setAgentName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [gitProvider, setGitProvider] = useState<GitProvider>('github');
  const [repoSource, setRepoSource] = useState<RepoSource>('existing');
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoPrivate, setNewRepoPrivate] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [createNewBranch, setCreateNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<AgentProvider>('claude-code');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedClaudeModel, setSelectedClaudeModel] = useState('claude-sonnet-4-5-20250929');
  const [modelProviders, setModelProviders] = useState<ModelProviderGroup[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  
  // GitHub App state
  const [githubAppInstallations, setGithubAppInstallations] = useState<GitHubAppInstallation[]>([]);
  const [selectedInstallation, setSelectedInstallation] = useState<GitHubAppInstallation | null>(null);
  const [isGitHubAppConfigured, setIsGitHubAppConfigured] = useState(false);
  
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
    agentId: string;
    agentName: string;
  }>({ isOpen: false, agentId: '', agentName: '' });

  const openShareModal = (agentSession: Session) => {
    setShareModal({
      isOpen: true,
      agentId: agentSession.id,
      agentName: agentSession.repo_name || 'Unnamed Agent',
    });
  };

  const closeShareModal = () => {
    setShareModal({ isOpen: false, agentId: '', agentName: '' });
  };

  useEffect(() => {
    loadAgents();
    loadOpencodeModels();
    loadGitHubAppStatus();
  }, []);

  // Load GitHub App installations
  const loadGitHubAppStatus = async () => {
    try {
      const status = await githubApp.getStatus();
      setIsGitHubAppConfigured(status.configured);
      
      if (status.configured) {
        const { installations } = await githubApp.listInstallations();
        setGithubAppInstallations(installations);
        if (installations.length > 0) {
          setSelectedInstallation(installations[0]);
        }
      }
    } catch (err) {
      console.error('Failed to load GitHub App status:', err);
      setIsGitHubAppConfigured(false);
    }
  };

  // Check if GitHub is connected (via App)
  const isGitHubConnected = isGitHubAppConfigured && githubAppInstallations.length > 0;

  useEffect(() => {
    // Load repos when git provider changes or connection status changes
    if ((gitProvider === 'github' && isGitHubConnected && selectedInstallation) || 
        (gitProvider === 'gitlab' && user?.gitlab_connected)) {
      setIsLoadingRepos(true);
      loadRepos().finally(() => setIsLoadingRepos(false));
    } else {
      setRepos([]);
      setSelectedRepo(null);
      setIsLoadingRepos(false);
    }
  }, [gitProvider, isGitHubConnected, selectedInstallation, user?.gitlab_connected]);

  useEffect(() => {
    if (selectedRepo) {
      loadBranches(selectedRepo.full_name);
    }
  }, [selectedRepo]);

  useEffect(() => {
    if (selectedProvider === 'opencode') {
      setSelectedModel(defaultModel || 'anthropic/claude-sonnet-4-5-20250929');
    } else {
      setSelectedModel('');
    }
  }, [selectedProvider, defaultModel]);

  const loadAgents = async () => {
    try {
      const { sessions: list } = await sessions.list();
      setAgentList(list);
    } catch {
      setError('Failed to load agents');
    } finally {
      setIsLoading(false);
    }
  };

  const loadRepos = async () => {
    try {
      let list: Repository[];
      if (gitProvider === 'github') {
        if (selectedInstallation) {
          const { repos } = await githubApp.listRepos(selectedInstallation.installation_id);
          list = repos;
        } else {
          list = [];
        }
      } else {
        const { repos } = await gitlab.getRepos();
        list = repos;
      }
      setRepos(list);
    } catch {
      // Git provider not connected or error
      setRepos([]);
    }
  };

  const loadBranches = async (fullName: string) => {
    try {
      if (gitProvider === 'github') {
        const [owner, repo] = fullName.split('/');
        if (selectedInstallation) {
          const { branches: list } = await githubApp.getBranches(selectedInstallation.installation_id, owner, repo);
          setBranches(list);
          if (list.length > 0 && selectedRepo) {
            setSelectedBranch(
              list.find((b) => b.name === selectedRepo.default_branch)?.name || list[0].name
            );
          }
        }
      } else {
        // GitLab uses project ID
        const projectId = selectedRepo?.id.toString() || fullName;
        const { branches: list } = await gitlab.getBranches(projectId);
        setBranches(list);
        if (list.length > 0 && selectedRepo) {
          setSelectedBranch(
            list.find((b) => b.name === selectedRepo.default_branch)?.name || list[0].name
          );
        }
      }
    } catch {
      setBranches([]);
    }
  };

  const loadOpencodeModels = async () => {
    try {
      const { providers, defaultModel: defModel } = await agent.getOpencodeModels();
      setModelProviders(providers);
      setDefaultModel(defModel);
    } catch {
      // Ignore errors
    }
  };

  const handleCreateAgent = async () => {
    // Validate based on agent type
    if (agentType === 'code') {
      if (repoSource === 'existing' && !selectedRepo) {
        setError('Please select a repository');
        return;
      }
      if (repoSource === 'existing' && createNewBranch && !newBranchName.trim()) {
        setError('Please enter a name for the new branch');
        return;
      }
      if (repoSource === 'create-new' && !newRepoName) {
        setError('Please enter a repository name');
        return;
      }
    } else {
      if (!agentName.trim()) {
        setError('Please enter an agent name');
        return;
      }
    }

    setIsCreating(true);
    setError('');
    
    try {
      // Portal sandbox agents: create with minimal config, redirect to wizard
      if (agentType === 'portal-sandbox') {
        const { session } = await sessions.create({
          agent_type: 'portal-sandbox',
          name: agentName,
          repo_name: agentName || 'Portal Agent',
          agent_provider: 'claude-code', // locked to Claude Code
          agent_model: selectedClaudeModel, // pass the selected model
        });
        // Navigate to the agent detail page where wizard will show
        navigate(`/agents/${session.id}?tab=config`);
        return;
      }

      let repoUrl = '';
      let repoName = '';
      let branch = 'main';

      if (agentType === 'code') {
        if (repoSource === 'existing' && selectedRepo) {
          repoUrl = selectedRepo.clone_url;
          repoName = selectedRepo.full_name;
          
          // Create new branch if requested
          if (createNewBranch && newBranchName) {
            try {
              if (gitProvider === 'github') {
                const [owner, repo] = selectedRepo.full_name.split('/');
                if (selectedInstallation) {
                  await githubApp.createBranch(selectedInstallation.installation_id, owner, repo, newBranchName, selectedBranch);
                }
              } else {
                const projectId = selectedRepo.id.toString();
                await gitlab.createBranch(projectId, newBranchName, selectedBranch);
              }
              branch = newBranchName;
            } catch (err: any) {
              // If branch already exists, use it
              if (err.message?.includes('already exists')) {
                branch = newBranchName;
              } else {
                throw new Error(`Failed to create branch: ${err.message}`);
              }
            }
          } else {
            branch = selectedBranch;
          }
        } else if (repoSource === 'create-new') {
          // Create new repo on selected provider
          const response = await fetch('/api/repos/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              name: newRepoName,
              isPrivate: newRepoPrivate,
              provider: gitProvider,
            }),
          });
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.error || 'Failed to create repository');
          }
          repoUrl = data.repo.clone_url;
          repoName = data.repo.full_name;
          branch = data.repo.default_branch || 'main';
        } else if (repoSource === 'local') {
          repoName = newRepoName || 'workspace';
        }
      }

      const { session } = await sessions.create({
        agent_type: agentType,
        name: agentType !== 'code' ? agentName : undefined,
        repo_url: repoUrl || undefined,
        repo_name: repoName || agentName || 'Task Agent',
        branch,
        agent_provider: selectedProvider,
        agent_model: selectedProvider === 'opencode' ? selectedModel : selectedProvider === 'claude-code' ? selectedClaudeModel : undefined,
        system_prompt: systemPrompt || undefined,
      });
      
      navigate(`/agents/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteAgent = async (id: string) => {
    setModal({
      isOpen: true,
      title: 'Delete Agent',
      message: 'Delete this agent? This cannot be undone.',
      type: 'danger',
      onConfirm: async () => {
    try {
      await sessions.delete(id);
      setAgentList((prev) => prev.filter((s) => s.id !== id));
    } catch {
      setError('Failed to delete agent');
    }
      },
    });
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <p className="text-slate-500 dark:text-slate-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Agents</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Manage your AI agents</p>
        </div>
        <button
          onClick={() => setShowNewAgent(!showNewAgent)}
          className="bg-slate-800 dark:bg-blue-500 hover:bg-slate-900 dark:hover:bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Agent
        </button>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/50 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* GitHub/GitLab connect banner hidden — only task agents for now */}

      {showNewAgent && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 mb-8 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-6">Create New Agent</h2>

          <div className="space-y-6">
            {/* Agent Type — hidden since only task agents for now */}

            {/* Task Agent: Name + System Prompt */}
            {agentType === 'task' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">Agent Name</label>
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="e.g., URL Summarizer, DevOps Bot"
                    className="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-slate-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">System Prompt</label>
                  <div className="flex gap-2 mb-3">
                    {SYSTEM_PROMPT_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => setSystemPrompt(tpl.prompt)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          systemPrompt === tpl.prompt
                            ? 'bg-blue-500 text-white'
                            : 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-blue-500/50'
                        }`}
                      >
                        {tpl.name}
                      </button>
                    ))}
                    {systemPrompt && (
                      <button
                        type="button"
                        onClick={() => setSystemPrompt('')}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="Enter a system prompt to define this agent's behavior..."
                    rows={4}
                    className="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-slate-400 resize-vertical"
                  />
                </div>
              </div>
            )}

            {/* Portal-Sandbox Agent: Name + Model */}
            {agentType === 'portal-sandbox' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">Agent Name</label>
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="e.g., Customer Support Agent, Knowledge Assistant"
                    className="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-slate-400"
                  />
                </div>

                {/* Model Selection (Claude Code only, no Haiku) */}
                <div>
                  <label className="block text-sm font-medium text-slate-900 dark:text-white mb-3">Model</label>
                  <div className="space-y-2">
                    {CLAUDE_CODE_MODELS.filter(m => !m.id.includes('haiku')).map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => setSelectedClaudeModel(model.id)}
                        className={`w-full p-3 rounded-lg border text-left transition-colors ${
                          selectedClaudeModel === model.id
                            ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500'
                            : 'border-slate-200 dark:border-slate-600 hover:border-blue-500/50 bg-white dark:bg-slate-700'
                        }`}
                      >
                        <div className={`font-medium text-sm ${selectedClaudeModel === model.id ? 'text-blue-500' : 'text-slate-900 dark:text-white'}`}>
                          {model.name}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{model.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Setup Wizard</p>
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                        After creating this agent, you'll be guided through a setup wizard to configure skills, files, knowledge bases, and portal settings.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Portal Agent: Name + Info */}
            {agentType === 'portal' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">Agent Name</label>
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="e.g., Customer Support Agent, Knowledge Assistant"
                    className="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-slate-400"
                  />
                </div>
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Setup Wizard</p>
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                        After creating this agent, you'll be guided through a setup wizard to configure skills, files, knowledge bases, and portal settings.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Code Agent: Repository Source */}
            {agentType === 'code' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-900 dark:text-white mb-3">Repository</label>
                  <div className="flex gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setRepoSource('existing')}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        repoSource === 'existing'
                          ? 'bg-blue-500 text-white'
                          : 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white hover:border-blue-500/50'
                      }`}
                    >
                      Existing
                    </button>
                    <button
                      type="button"
                      onClick={() => setRepoSource('create-new')}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        repoSource === 'create-new'
                          ? 'bg-blue-500 text-white'
                          : 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white hover:border-blue-500/50'
                      }`}
                    >
                      New Repo
                    </button>
                    <button
                      type="button"
                      onClick={() => setRepoSource('local')}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        repoSource === 'local'
                          ? 'bg-blue-500 text-white'
                          : 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white hover:border-blue-500/50'
                      }`}
                    >
                      Local Only
                    </button>
                  </div>

                  {repoSource === 'existing' && (
                    <div className="space-y-3">
                      {/* Git Provider Selector */}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setGitProvider('github')}
                          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                            gitProvider === 'github'
                              ? 'bg-slate-800 dark:bg-blue-500 text-white'
                              : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600'
                          }`}
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                          </svg>
                          GitHub
                          {isGitHubConnected && <span className="text-xs opacity-75">✓</span>}
                        </button>
                        <button
                          type="button"
                          onClick={() => setGitProvider('gitlab')}
                          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                            gitProvider === 'gitlab'
                              ? 'bg-orange-600 text-white'
                              : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600'
                          }`}
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"/>
                          </svg>
                          GitLab
                          {user?.gitlab_connected && <span className="text-xs opacity-75">✓</span>}
                        </button>
                      </div>

                      {/* GitHub Installation Selector */}
                      {gitProvider === 'github' && githubAppInstallations.length > 1 && (
                        <select
                          value={selectedInstallation?.installation_id || ''}
                          onChange={(e) => {
                            const inst = githubAppInstallations.find(i => i.installation_id === Number(e.target.value));
                            setSelectedInstallation(inst || null);
                          }}
                          className="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        >
                          {githubAppInstallations.map((inst) => (
                            <option key={inst.installation_id} value={inst.installation_id}>
                              @{inst.account_login} ({inst.account_type})
                            </option>
                          ))}
                        </select>
                      )}

                      {/* Repository Selector */}
                      {isLoadingRepos ? (
                        <div className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Loading repositories...
                        </div>
                      ) : (gitProvider === 'github' && isGitHubConnected) || (gitProvider === 'gitlab' && user?.gitlab_connected) ? (
                        repos.length > 0 ? (
                          <select
                            value={selectedRepo?.id || ''}
                            onChange={(e) => {
                              const repo = repos.find((r) => r.id === parseInt(e.target.value));
                              setSelectedRepo(repo || null);
                            }}
                            disabled={isLoadingRepos}
                            className="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <option value="">Select a repository</option>
                            {repos.map((repo) => (
                              <option key={repo.id} value={repo.id}>
                                {repo.full_name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-center">
                            <p className="text-sm text-slate-600 dark:text-slate-400">No repositories found</p>
                          </div>
                        )
                      ) : (
                        <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-center">
                          <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                            {gitProvider === 'github' ? 'GitHub App' : 'GitLab'} not connected
                          </p>
                          <Link
                            to="/settings?tab=git"
                            className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
                          >
                            {gitProvider === 'github' ? 'Install GitHub App' : 'Connect GitLab'} →
                          </Link>
                        </div>
                      )}
                    </div>
                  )}

                  {repoSource === 'create-new' && (
                    <div className="space-y-3">
                      {/* Git Provider Selector */}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setGitProvider('github')}
                          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                            gitProvider === 'github'
                              ? 'bg-slate-800 dark:bg-blue-500 text-white'
                              : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600'
                          }`}
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                          </svg>
                          GitHub
                          {isGitHubConnected && <span className="text-xs opacity-75">✓</span>}
                        </button>
                        <button
                          type="button"
                          onClick={() => setGitProvider('gitlab')}
                          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                            gitProvider === 'gitlab'
                              ? 'bg-orange-600 text-white'
                              : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600'
                          }`}
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"/>
                          </svg>
                          GitLab
                          {user?.gitlab_connected && <span className="text-xs opacity-75">✓</span>}
                        </button>
                      </div>

                      {((gitProvider === 'github' && isGitHubConnected) || 
                        (gitProvider === 'gitlab' && user?.gitlab_connected)) ? (
                        <>
                          <input
                            type="text"
                            value={newRepoName}
                            onChange={(e) => setNewRepoName(e.target.value)}
                            placeholder="repository-name"
                            className="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                          />
                          <label className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                            <input
                              type="checkbox"
                              checked={newRepoPrivate}
                              onChange={(e) => setNewRepoPrivate(e.target.checked)}
                              className="rounded border-slate-300 dark:border-slate-600"
                            />
                            Private repository
                          </label>
                        </>
                      ) : (
                        <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-center">
                          <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                            {gitProvider === 'github' ? 'GitHub App' : 'GitLab'} not connected
                          </p>
                          <Link
                            to="/settings?tab=git"
                            className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
                          >
                            {gitProvider === 'github' ? 'Install GitHub App' : 'Connect GitLab'} →
                          </Link>
                        </div>
                      )}
                    </div>
                  )}

                  {repoSource === 'local' && (
                    <div>
                      <input
                        type="text"
                        value={newRepoName}
                        onChange={(e) => setNewRepoName(e.target.value)}
                        placeholder="workspace (optional)"
                        className="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                        Starts with an empty workspace. Push to GitHub later.
                      </p>
                    </div>
                  )}
                </div>

                {repoSource === 'existing' && selectedRepo && (
                  <div className="space-y-4">
                  <div>
                      <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
                        {createNewBranch ? 'Base Branch' : 'Branch'}
                      </label>
                    <select
                      value={selectedBranch}
                      onChange={(e) => setSelectedBranch(e.target.value)}
                      className="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    >
                      {branches.map((branch) => (
                        <option key={branch.name} value={branch.name}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                    </div>

                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={createNewBranch}
                        onChange={(e) => setCreateNewBranch(e.target.checked)}
                        className="rounded border-slate-300 dark:border-slate-600"
                      />
                      <span className="text-sm text-slate-600 dark:text-slate-400">Create a new branch for this agent</span>
                    </label>

                    {createNewBranch && (
                      <div>
                        <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">New Branch Name</label>
                        <input
                          type="text"
                          value={newBranchName}
                          onChange={(e) => setNewBranchName(e.target.value)}
                          placeholder="e.g., feature/agent-work"
                          className="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-slate-400"
                        />
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          Branch will be created from {selectedBranch || 'the selected base branch'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {agentType !== 'portal' && agentType !== 'portal-sandbox' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-900 dark:text-white mb-3">AI Agent</label>
                  <div className="grid grid-cols-3 gap-3">
                    {PROVIDERS.map((provider) => (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() => setSelectedProvider(provider.id)}
                        className={`p-4 rounded-lg border text-left transition-colors ${
                          selectedProvider === provider.id
                            ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500'
                            : 'border-slate-200 dark:border-slate-600 hover:border-blue-500/50 bg-white dark:bg-slate-700'
                        }`}
                      >
                        <div className={`font-medium text-sm ${selectedProvider === provider.id ? 'text-blue-500' : 'text-slate-900 dark:text-white'}`}>{provider.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{provider.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {selectedProvider === 'claude-code' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-900 dark:text-white mb-3">Model</label>
                    <div className="space-y-2">
                      {CLAUDE_CODE_MODELS.map((model) => (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => setSelectedClaudeModel(model.id)}
                          className={`w-full p-3 rounded-lg border text-left transition-colors ${
                            selectedClaudeModel === model.id
                              ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500'
                              : 'border-slate-200 dark:border-slate-600 hover:border-blue-500/50 bg-white dark:bg-slate-700'
                          }`}
                        >
                          <div className={`font-medium text-sm ${selectedClaudeModel === model.id ? 'text-blue-500' : 'text-slate-900 dark:text-white'}`}>
                            {model.name}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{model.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedProvider === 'opencode' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-900 dark:text-white mb-3">
                      Model <span className="text-slate-500 dark:text-slate-400 font-normal">(75+ providers, 100k+ models)</span>
                    </label>
                    <ModelSelector
                      value={selectedModel}
                      onChange={setSelectedModel}
                      providers={modelProviders.map((p) => ({
                        id: p.name.toLowerCase(),
                        name: p.name,
                        envKey: p.envKey,
                        configured: p.configured,
                        prefix: `${p.name.toLowerCase()}/`,
                        popularModels: p.models.map((m) => ({
                          id: m.id,
                          name: m.name,
                          description: m.description,
                        })),
                      }))}
                    />
                  </div>
                )}
              </>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleCreateAgent}
                disabled={isCreating}
                className="bg-blue-500 hover:bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-600 dark:disabled:text-slate-400"
              >
                {isCreating ? 'Creating...' : 'Create Agent'}
              </button>
              <button
                onClick={() => {
                  setShowNewAgent(false);
                  setAgentType('task');
                  setAgentName('');
                  setSystemPrompt('');
                  setRepoSource('existing');
                  setNewRepoName('');
                  setSelectedRepo(null);
                }}
                className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:border-blue-500/50 text-slate-900 dark:text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {agentList.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-slate-500 dark:text-slate-400">No agents yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
          {agentList.map((agentSession) => (
            <div
              key={agentSession.id}
              onClick={() => navigate(`/agents/${agentSession.id}`)}
              className="p-4 flex justify-between items-center hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-100 dark:bg-slate-700 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900 dark:text-white">
                      {agentSession.repo_name || 'Unnamed Agent'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    {agentSession.agent_type === 'code' && agentSession.branch && (
                      <>{agentSession.branch} · </>
                    )}
                    {(() => {
                      // Format model name nicely
                      const getModelName = (modelId: string | undefined) => {
                        if (!modelId) return '';
                        const model = CLAUDE_CODE_MODELS.find(m => m.id === modelId);
                        if (model) return model.name;
                        // Fallback for other models
                        if (modelId.includes('sonnet')) return 'Claude Sonnet';
                        if (modelId.includes('opus')) return 'Claude Opus';
                        if (modelId.includes('haiku')) return 'Claude Haiku';
                        return modelId.split('/').pop() || modelId;
                      };

                      if (agentSession.agent_type === 'portal' || agentSession.agent_type === 'portal-sandbox') {
                        return getModelName(agentSession.agent_model);
                      }

                      const provider = agentSession.agent_provider === 'aider'
                        ? 'Aider'
                        : agentSession.agent_provider === 'opencode'
                        ? 'OpenCode'
                        : 'Claude Code';

                      const modelName = getModelName(agentSession.agent_model);
                      return modelName ? `${provider} (${modelName})` : provider;
                    })()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); openShareModal(agentSession); }}
                  className="text-slate-400 hover:text-purple-500 p-2 hover:bg-purple-500/10 rounded-lg transition-colors"
                  title="Share settings"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteAgent(agentSession.id); }}
                  className="text-slate-400 hover:text-red-500 p-2 hover:bg-red-500/10 rounded-lg transition-colors"
                  title="Delete agent"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
          </div>
        )}
      </div>

      {/* Modal */}
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
        resourceType="session"
        resourceId={shareModal.agentId}
        resourceName={shareModal.agentName}
      />
    </div>
  );
}

