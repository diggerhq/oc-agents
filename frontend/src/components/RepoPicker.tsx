/**
 * RepoPicker Component
 * 
 * Allows users to select a repository from their connected Git providers:
 * - GitHub App installations (granular repo access)
 * - GitLab OAuth (all accessible repos)
 */

import { useState, useEffect, useMemo } from 'react';
import { 
  githubApp, 
  gitlab, 
  Repository, 
  Branch,
  GitHubAppInstallation,
  GitHubAppRepository,
} from '@/lib/api';
import { useAuth } from '@/stores/auth';

export type GitProvider = 'github' | 'gitlab';

export interface SelectedRepo {
  provider: GitProvider;
  repo: Repository | GitHubAppRepository;
  installationId?: number; // Only for GitHub App repos
  branch: string;
}

interface RepoPickerProps {
  onSelect: (selection: SelectedRepo | null) => void;
  initialProvider?: GitProvider;
}

export function RepoPicker({ onSelect, initialProvider = 'github' }: RepoPickerProps) {
  const { user } = useAuth();
  const [provider, setProvider] = useState<GitProvider>(initialProvider);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // GitHub App state
  const [githubAppConfigured, setGithubAppConfigured] = useState(false);
  const [githubAppName, setGithubAppName] = useState('');
  const [installations, setInstallations] = useState<GitHubAppInstallation[]>([]);
  const [selectedInstallation, setSelectedInstallation] = useState<GitHubAppInstallation | null>(null);
  const [githubAppRepos, setGithubAppRepos] = useState<GitHubAppRepository[]>([]);
  
  // GitLab OAuth repos
  const [gitlabRepos, setGitlabRepos] = useState<Repository[]>([]);
  
  // Selected repo and branch
  const [selectedRepo, setSelectedRepo] = useState<Repository | GitHubAppRepository | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [loadingBranches, setLoadingBranches] = useState(false);
  
  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  // Check GitHub App status on mount
  useEffect(() => {
    async function checkGithubApp() {
      try {
        const status = await githubApp.getStatus();
        setGithubAppConfigured(status.configured);
        setGithubAppName(status.appName);
        
        if (status.configured) {
          // Load installations
          const { installations: installs } = await githubApp.listInstallations();
          setInstallations(installs);
          
          // Auto-select first installation if available
          if (installs.length > 0) {
            setSelectedInstallation(installs[0]);
          }
        }
      } catch (err) {
        console.error('Failed to check GitHub App status:', err);
        setGithubAppConfigured(false);
      }
    }
    
    checkGithubApp();
  }, []);

  // Load repos when provider or installation changes
  useEffect(() => {
    async function loadRepos() {
      setIsLoading(true);
      setError(null);
      setSelectedRepo(null);
      setBranches([]);
      setSelectedBranch('');
      
      try {
        if (provider === 'github') {
          if (githubAppConfigured && selectedInstallation) {
            // Use GitHub App repos
            const { repos } = await githubApp.listRepos(selectedInstallation.installation_id);
            setGithubAppRepos(repos);
          }
          // No fallback - GitHub App is required for GitHub repos
        } else if (provider === 'gitlab') {
          if (user?.gitlab_connected) {
            const { repos } = await gitlab.getRepos();
            setGitlabRepos(repos);
          }
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load repositories');
      } finally {
        setIsLoading(false);
      }
    }
    
    loadRepos();
  }, [provider, selectedInstallation, githubAppConfigured, user?.gitlab_connected]);

  // Get the current repo list based on provider and mode
  const currentRepos = useMemo(() => {
    if (provider === 'github') {
      return githubAppRepos;
    }
    return gitlabRepos;
  }, [provider, githubAppRepos, gitlabRepos]);

  // Filter repos by search query
  const filteredRepos = useMemo(() => {
    if (!searchQuery.trim()) return currentRepos;
    const query = searchQuery.toLowerCase();
    return currentRepos.filter(repo => 
      repo.name.toLowerCase().includes(query) || 
      repo.full_name.toLowerCase().includes(query) ||
      repo.description?.toLowerCase().includes(query)
    );
  }, [currentRepos, searchQuery]);

  // Load branches when repo is selected
  useEffect(() => {
    async function loadBranches() {
      if (!selectedRepo) {
        setBranches([]);
        setSelectedBranch('');
        return;
      }
      
      setLoadingBranches(true);
      try {
        let branchList: Branch[];
        
        if (provider === 'github') {
          const [owner, repo] = selectedRepo.full_name.split('/');
          if (githubAppConfigured && selectedInstallation) {
            const { branches: b } = await githubApp.getBranches(
              selectedInstallation.installation_id,
              owner,
              repo
            );
            branchList = b;
          } else {
            // No GitHub App configured, can't fetch branches
            branchList = [];
          }
        } else {
          const { branches: b } = await gitlab.getBranches(selectedRepo.id.toString());
          branchList = b;
        }
        
        setBranches(branchList);
        // Auto-select default branch
        setSelectedBranch(selectedRepo.default_branch || 'main');
      } catch (err: any) {
        console.error('Failed to load branches:', err);
        // Still set default branch even if we can't load the list
        setSelectedBranch(selectedRepo.default_branch || 'main');
      } finally {
        setLoadingBranches(false);
      }
    }
    
    loadBranches();
  }, [selectedRepo, provider, githubAppConfigured, selectedInstallation]);

  // Notify parent of selection changes
  useEffect(() => {
    if (selectedRepo && selectedBranch) {
      onSelect({
        provider,
        repo: selectedRepo,
        installationId: githubAppConfigured && selectedInstallation && 'installation_id' in selectedRepo 
          ? (selectedRepo as GitHubAppRepository).installation_id 
          : undefined,
        branch: selectedBranch,
      });
    } else {
      onSelect(null);
    }
  }, [selectedRepo, selectedBranch, provider, githubAppConfigured, selectedInstallation, onSelect]);

  // Handle GitHub App installation
  const handleInstallGitHubApp = async () => {
    try {
      const { url } = await githubApp.getInstallUrl();
      window.open(url, '_blank');
    } catch (err) {
      console.error('Failed to get install URL:', err);
    }
  };

  // Handle configuring GitHub App (add more repos)
  const handleConfigureGitHubApp = async () => {
    if (!selectedInstallation) return;
    try {
      const { url } = await githubApp.getConfigureUrl(selectedInstallation.installation_id);
      window.open(url, '_blank');
    } catch (err) {
      console.error('Failed to get configure URL:', err);
    }
  };

  const isGitHubConnected = githubAppConfigured && installations.length > 0;
  const isGitLabConnected = user?.gitlab_connected;

  return (
    <div className="space-y-3">
      {/* Provider Tabs - Compact */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-900 p-0.5 rounded-lg">
        <button
          type="button"
          onClick={() => setProvider('github')}
          className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
            provider === 'github'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          GitHub
          {isGitHubConnected && <span className="text-green-500">●</span>}
        </button>
        <button
          type="button"
          onClick={() => setProvider('gitlab')}
          className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
            provider === 'gitlab'
              ? 'bg-orange-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"/>
          </svg>
          GitLab
          {isGitLabConnected && <span className="text-green-500">●</span>}
        </button>
      </div>

      {/* GitHub: Installation Selector (if App is configured) - Compact */}
      {provider === 'github' && githubAppConfigured && (
        <div className="space-y-1.5">
          {installations.length > 0 ? (
            <div className="flex items-center gap-2">
              <select
                value={selectedInstallation?.installation_id || ''}
                onChange={(e) => {
                  const inst = installations.find(i => i.installation_id === Number(e.target.value));
                  setSelectedInstallation(inst || null);
                }}
                className="flex-1 px-2 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-slate-900 dark:text-white text-xs"
              >
                {installations.map(inst => (
                  <option key={inst.installation_id} value={inst.installation_id}>
                    {inst.account_login} ({inst.account_type})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleInstallGitHubApp}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
              >
                + Add
              </button>
            </div>
          ) : (
            <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded p-2 flex items-center justify-between">
              <span className="text-xs text-blue-700 dark:text-blue-400">
                Install {githubAppName} to access repos
              </span>
              <button
                type="button"
                onClick={handleInstallGitHubApp}
                className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded"
              >
                Install
              </button>
            </div>
          )}
        </div>
      )}

      {/* Not connected message - Compact */}
      {provider === 'github' && !isGitHubConnected && (
        <div className="bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/30 rounded p-2 flex items-center justify-between">
          <span className="text-xs text-yellow-700 dark:text-yellow-400">Connect GitHub to access repos</span>
          <a href="/settings?tab=git" className="px-2 py-1 bg-slate-800 hover:bg-slate-900 text-white text-xs font-medium rounded">
            Connect
          </a>
        </div>
      )}

      {provider === 'gitlab' && !isGitLabConnected && (
        <div className="bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/30 rounded p-2 flex items-center justify-between">
          <span className="text-xs text-yellow-700 dark:text-yellow-400">Connect GitLab to access repos</span>
          <a href="/settings?tab=git" className="px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white text-xs font-medium rounded">
            Connect
          </a>
        </div>
      )}

      {/* Search and Repo List - Compact */}
      {((provider === 'github' && isGitHubConnected) || (provider === 'gitlab' && isGitLabConnected)) && (
        <>
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search repositories..."
              className="w-full pl-8 pr-2 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-slate-900 dark:text-white text-xs"
            />
          </div>

          {/* Repo List */}
          <div className="border border-slate-200 dark:border-slate-700 rounded overflow-hidden max-h-60 overflow-y-auto">
            {isLoading ? (
              <div className="p-3 text-center text-slate-500 dark:text-slate-400 text-xs">
                <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin mx-auto mb-1" />
                Loading...
              </div>
            ) : error ? (
              <div className="p-2 text-center text-red-500 text-xs">{error}</div>
            ) : filteredRepos.length === 0 ? (
              <div className="p-2 text-center text-slate-500 dark:text-slate-400 text-xs">
                {searchQuery ? 'No matches' : 'No repositories'}
                {provider === 'github' && githubAppConfigured && selectedInstallation && (
                  <button type="button" onClick={handleConfigureGitHubApp} className="block mx-auto mt-1 text-blue-600 dark:text-blue-400 hover:underline">
                    Add repos
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-700">
                {filteredRepos.map(repo => (
                  <button
                    key={repo.id}
                    type="button"
                    onClick={() => setSelectedRepo(repo)}
                    className={`w-full px-2.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${
                      selectedRepo?.id === repo.id ? 'bg-blue-50 dark:bg-blue-500/10' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-900 dark:text-white text-xs truncate">
                        {repo.name}
                      </span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {repo.private && (
                          <span className="text-[10px] px-1 py-0.5 bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 rounded">
                            Private
                          </span>
                        )}
                        {selectedRepo?.id === repo.id && (
                          <svg className="w-3.5 h-3.5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Add more repos link (GitHub App only) - Inline with branch */}
          <div className="flex items-center gap-2">
            {/* Branch Selector - Inline */}
            {selectedRepo && (
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                disabled={loadingBranches}
                className="flex-1 px-2 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-slate-900 dark:text-white text-xs disabled:opacity-50"
              >
                {loadingBranches ? (
                  <option>Loading...</option>
                ) : branches.length > 0 ? (
                  branches.map(branch => (
                    <option key={branch.name} value={branch.name}>
                      {branch.name} {branch.protected && '🔒'}
                    </option>
                  ))
                ) : (
                  <option value={selectedRepo.default_branch || 'main'}>
                    {selectedRepo.default_branch || 'main'}
                  </option>
                )}
              </select>
            )}
            {provider === 'github' && githubAppConfigured && selectedInstallation && (
              <button
                type="button"
                onClick={handleConfigureGitHubApp}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
              >
                + Add repos
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
