const API_BASE = '/api';

export interface ApiError extends Error {
  code?: string;
  field?: string;
  statusCode?: number;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
    const error = new Error(errorData.error || 'Request failed') as ApiError;
    error.code = errorData.code;
    error.field = errorData.field;
    error.statusCode = response.status;
    throw error;
  }

  return response.json();
}

// Generic API helper for simple REST operations
export const api = {
  get: <T = any>(endpoint: string) => request<T>(endpoint),
  post: <T = any>(endpoint: string, body?: any) => request<T>(endpoint, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T = any>(endpoint: string, body?: any) => request<T>(endpoint, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  put: <T = any>(endpoint: string, body?: any) => request<T>(endpoint, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T = any>(endpoint: string) => request<T>(endpoint, { method: 'DELETE' }),
};

// Organization types
export type OrgRole = 'owner' | 'admin' | 'member';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  is_personal: boolean;
  owner_id: string;
  role?: OrgRole;
  member_count?: number;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  email: string;
  role: OrgRole;
  created_at: string;
}

export interface OrganizationInvitation {
  id: string;
  organization_id: string;
  organization_name?: string;
  email: string;
  role: 'admin' | 'member';
  token: string;
  invited_by: string;
  invited_by_email?: string;
  expires_at: string;
  invite_url?: string;
  created_at: string;
}

export interface PendingInvitation {
  id: string;
  organization_id: string;
  organization_name: string;
  email: string;
  role: 'admin' | 'member';
  invited_by: string;
  invited_by_email: string;
  expires_at: string;
  created_at: string;
}

// Auth API
export const auth = {
  login: (email: string, password: string) =>
    request<{ success: boolean; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (email: string, password: string) =>
    request<{ success: boolean; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () =>
    request<{ success: boolean }>('/auth/logout', { method: 'POST' }),

  me: () =>
    request<{ 
      user: User; 
      organizations?: Organization[]; 
      current_organization_id?: string;
    }>('/auth/me'),
};

// Organizations API
export const organizations = {
  list: () =>
    request<Organization[]>('/organizations'),

  get: (id: string) =>
    request<Organization>(`/organizations/${id}`),

  create: (name: string) =>
    request<Organization>('/organizations', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  update: (id: string, data: { name?: string; slug?: string }) =>
    request<Organization>(`/organizations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<{ message: string }>(`/organizations/${id}`, { method: 'DELETE' }),

  switchTo: (id: string) =>
    request<{ message: string; organization_id: string }>(`/organizations/${id}/switch`, {
      method: 'POST',
    }),

  // Members
  listMembers: (orgId: string) =>
    request<OrganizationMember[]>(`/organizations/${orgId}/members`),

  updateMemberRole: (orgId: string, userId: string, role: OrgRole) =>
    request<{ message: string; user_id: string; role: OrgRole }>(
      `/organizations/${orgId}/members/${userId}`,
      { method: 'PATCH', body: JSON.stringify({ role }) }
    ),

  removeMember: (orgId: string, userId: string) =>
    request<{ message: string }>(`/organizations/${orgId}/members/${userId}`, {
      method: 'DELETE',
    }),

  transferOwnership: (orgId: string, newOwnerId: string) =>
    request<{ message: string; new_owner_id: string }>(
      `/organizations/${orgId}/transfer-ownership`,
      { method: 'POST', body: JSON.stringify({ new_owner_id: newOwnerId }) }
    ),

  // Invitations
  listInvitations: (orgId: string) =>
    request<OrganizationInvitation[]>(`/organizations/${orgId}/invitations`),

  sendInvitation: (orgId: string, email: string, role: 'admin' | 'member') =>
    request<OrganizationInvitation>(`/organizations/${orgId}/invitations`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),

  revokeInvitation: (orgId: string, inviteId: string) =>
    request<{ message: string }>(`/organizations/${orgId}/invitations/${inviteId}`, {
      method: 'DELETE',
    }),

  getInvitation: (token: string) =>
    request<{ email: string; role: string; organization_name: string; expires_at: string }>(
      `/organizations/invitations/${token}`
    ),

  acceptInvitation: (token: string) =>
    request<{ message: string; organization: Organization; role: OrgRole }>(
      `/organizations/invitations/${token}/accept`,
      { method: 'POST' }
    ),

  // My pending invitations
  getMyInvitations: () =>
    request<PendingInvitation[]>('/organizations/my-invitations'),

  acceptInvitationById: (inviteId: string) =>
    request<{ message: string; organization: Organization; role: OrgRole }>(
      `/organizations/invitations/${inviteId}/accept`,
      { method: 'POST' }
    ),

  declineInvitation: (inviteId: string) =>
    request<{ message: string }>(
      `/organizations/invitations/${inviteId}/decline`,
      { method: 'POST' }
    ),
};

// GitHub API
export const github = {
  getRepos: () =>
    request<{ repos: Repository[] }>('/auth/github/repos'),

  getBranches: (owner: string, repo: string) =>
    request<{ branches: Branch[] }>(`/auth/github/repos/${owner}/${repo}/branches`),

  createBranch: (owner: string, repo: string, branchName: string, baseBranch: string) =>
    request<{ success: boolean; branch: { name: string; base: string } }>(
      `/auth/github/repos/${owner}/${repo}/branches`,
      { method: 'POST', body: JSON.stringify({ branch_name: branchName, base_branch: baseBranch }) }
    ),

  disconnect: () =>
    request<{ success: boolean }>('/auth/github/disconnect', { method: 'POST' }),
};

// GitLab API
export const gitlab = {
  getStatus: () =>
    request<{ configured: boolean }>('/auth/gitlab/status'),

  getRepos: () =>
    request<{ repos: Repository[] }>('/auth/gitlab/repos'),

  getBranches: (projectId: string) =>
    request<{ branches: Branch[] }>(`/auth/gitlab/repos/${encodeURIComponent(projectId)}/branches`),

  createBranch: (projectId: string, branchName: string, baseBranch: string) =>
    request<{ success: boolean; branch: { name: string; base: string } }>(
      `/auth/gitlab/repos/${encodeURIComponent(projectId)}/branches`,
      { method: 'POST', body: JSON.stringify({ branch_name: branchName, base_branch: baseBranch }) }
    ),

  disconnect: () =>
    request<{ success: boolean }>('/auth/gitlab/disconnect', { method: 'POST' }),
};

// GitHub App API (for granular repo access via GitHub App installations)
export interface GitHubAppInstallation {
  id: string;
  installation_id: number;
  account_login: string;
  account_type: 'User' | 'Organization';
  repository_selection?: 'all' | 'selected';
  suspended_at?: string;
  created_at: string;
}

export interface GitHubAppRepository extends Repository {
  installation_id: number;
}

export const githubApp = {
  getStatus: () =>
    request<{ configured: boolean; appName: string }>('/github-app/status'),

  getInstallUrl: () =>
    request<{ url: string; state: string }>('/github-app/install-url'),

  getConfigureUrl: (installationId: number) =>
    request<{ url: string }>(`/github-app/configure-url/${installationId}`),

  listInstallations: () =>
    request<{ installations: GitHubAppInstallation[] }>('/github-app/installations'),

  listRepos: (installationId: number) =>
    request<{ repos: GitHubAppRepository[]; total_count: number }>(
      `/github-app/installations/${installationId}/repos`
    ),

  getBranches: (installationId: number, owner: string, repo: string) =>
    request<{ branches: Branch[] }>(
      `/github-app/installations/${installationId}/repos/${owner}/${repo}/branches`
    ),

  createBranch: (installationId: number, owner: string, repo: string, branchName: string, baseBranch: string) =>
    request<{ success: boolean; branch: { name: string; base: string } }>(
      `/github-app/installations/${installationId}/repos/${owner}/${repo}/branches`,
      { method: 'POST', body: JSON.stringify({ branch_name: branchName, base_branch: baseBranch }) }
    ),

  syncInstallations: () =>
    request<{ synced: number; installations: { id: number; account: string }[] }>(
      '/github-app/sync-installations',
      { method: 'POST' }
    ),

  removeInstallation: (installationId: number) =>
    request<{ success: boolean }>(
      `/github-app/installations/${installationId}`,
      { method: 'DELETE' }
    ),
};

// Sessions API
export const sessions = {
  list: () =>
    request<{ sessions: Session[] }>('/sessions'),

  create: (data: {
    agent_type?: 'code' | 'task' | 'portal' | 'portal-sandbox';
    name?: string;
    repo_url?: string;
    repo_name?: string;
    branch?: string;
    agent_provider?: string;
    agent_model?: string;
    system_prompt?: string;
  }) =>
    request<{ session: Session }>('/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  get: (id: string) =>
    request<{ session: Session; tasks: Task[] }>(`/sessions/${id}?_t=${Date.now()}`),

  delete: (id: string) =>
    request<{ success: boolean }>(`/sessions/${id}`, { method: 'DELETE' }),
};

// Agent API
export const agent = {
  startSandbox: (sessionId: string) =>
    request<{ success: boolean; sandbox: { id: string } }>(
      `/agent/sessions/${sessionId}/sandbox/start`,
      { method: 'POST' }
    ),

  stopSandbox: (sessionId: string) =>
    request<{ success: boolean }>(
      `/agent/sessions/${sessionId}/sandbox/stop`,
      { method: 'POST' }
    ),

  resetSandbox: (sessionId: string) =>
    request<{ success: boolean; sandboxId?: string; message?: string }>(
      `/agent/sessions/${sessionId}/sandbox/reset`,
      { method: 'POST' }
    ),

  createTask: (sessionId: string, prompt: string) =>
    request<{ task: Task }>(`/sessions/${sessionId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),

  runTask: (sessionId: string, taskId: string) =>
    request<{ success: boolean; provider: string }>(
      `/agent/sessions/${sessionId}/tasks/${taskId}/run`,
      { method: 'POST' }
    ),

  getProviders: () =>
    request<{ providers: AgentProvider[] }>(
      '/agent/providers'
    ),

  getOpencodeModels: () =>
    request<{ providers: ModelProviderGroup[]; defaultModel: string }>(
      '/agent/opencode/models'
    ),

  getTask: (sessionId: string, taskId: string) =>
    request<{ task: Task; messages: Message[] }>(
      `/sessions/${sessionId}/tasks/${taskId}`
    ),

  exec: (sessionId: string, command: string, cwd?: string) =>
    request<{ stdout: string; stderr: string; exitCode: number }>(
      `/agent/sessions/${sessionId}/exec`,
      {
        method: 'POST',
        body: JSON.stringify({ command, cwd }),
      }
    ),

  createBranch: (sessionId: string, branchName: string) =>
    request<{ success: boolean }>(
      `/agent/sessions/${sessionId}/branch`,
      {
        method: 'POST',
        body: JSON.stringify({ branch_name: branchName }),
      }
    ),

  push: (sessionId: string, branch?: string) =>
    request<{ success: boolean }>(
      `/agent/sessions/${sessionId}/push`,
      {
        method: 'POST',
        body: JSON.stringify({ branch }),
      }
    ),

  getOutput: (sessionId: string) =>
    request<{ output: string }>(
      `/agent/sessions/${sessionId}/output`
    ),
};

// API Keys
export const apiKeys = {
  list: () =>
    request<{ keys: ApiKeyInfo[] }>('/keys'),

  create: (name: string) =>
    request<{ id: string; name: string; key: string; key_prefix: string; created_at: string }>(
      '/keys',
      { method: 'POST', body: JSON.stringify({ name }) }
    ),

  delete: (id: string) =>
    request<{ success: boolean }>(`/keys/${id}`, { method: 'DELETE' }),
};

// Agent Config
export const agentConfig = {
  get: (sessionId: string) =>
    request<{ config: AgentConfigType }>(`/agents/${sessionId}/config`),

  update: (sessionId: string, config: Partial<AgentConfigType>) =>
    request<{ config: AgentConfigType }>(
      `/agents/${sessionId}/config`,
      { method: 'PATCH', body: JSON.stringify(config) }
    ),

  listAgents: () =>
    request<{ agents: AgentListItem[] }>('/agents'),

  // Logo management
  uploadLogo: async (sessionId: string, file: File) => {
    const formData = new FormData();
    formData.append('logo', file);

    const response = await fetch(`/api/agents/${sessionId}/config/logo`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Logo upload failed');
    }

    return response.json() as Promise<{ success: boolean; logoUrl: string }>;
  },

  deleteLogo: (sessionId: string) =>
    request<{ success: boolean }>(
      `/agents/${sessionId}/config/logo`,
      { method: 'DELETE' }
    ),
};

// Agent Runs (task history)
export const runs = {
  list: (agentId: string, limit = 50, offset = 0) =>
    request<{ runs: AgentRun[]; total: number; limit: number; offset: number }>(
      `/agents/${agentId}/runs?limit=${limit}&offset=${offset}`
    ),

  get: (agentId: string, runId: string) =>
    request<{ run: AgentRun }>(`/agents/${agentId}/runs/${runId}`),
};

// Schedules (cron-like agent scheduling)
export const schedules = {
  listAll: () =>
    request<{ schedules: Schedule[] }>('/schedules'),

  listForAgent: (agentId: string) =>
    request<{ schedules: Schedule[] }>(`/schedules/agent/${agentId}`),

  get: (scheduleId: string) =>
    request<{ schedule: Schedule; runs: ScheduleRun[] }>(`/schedules/${scheduleId}`),

  create: (data: { session_id: string; name: string; description?: string; cron_expression: string; timezone?: string; prompt: string }) =>
    request<{ schedule: Schedule }>('/schedules', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (scheduleId: string, data: Partial<{ name: string; description: string; cron_expression: string; timezone: string; prompt: string; is_active: boolean }>) =>
    request<{ schedule: Schedule }>(`/schedules/${scheduleId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (scheduleId: string) =>
    request<{ success: boolean }>(`/schedules/${scheduleId}`, { method: 'DELETE' }),

  toggle: (scheduleId: string) =>
    request<{ is_active: boolean; next_run_at: string | null }>(`/schedules/${scheduleId}/toggle`, { method: 'POST' }),

  runNow: (scheduleId: string) =>
    request<{ run_id: string; task_id: string; message: string }>(`/schedules/${scheduleId}/run`, { method: 'POST' }),
};

// Prompt Templates
export const templates = {
  list: (agentId: string) =>
    request<{ templates: PromptTemplate[] }>(`/agents/${agentId}/templates`),

  create: (agentId: string, data: { name: string; template: string; variables?: string[] }) =>
    request<{ template: PromptTemplate }>(
      `/agents/${agentId}/templates`,
      { method: 'POST', body: JSON.stringify(data) }
    ),

  update: (agentId: string, templateId: string, data: Partial<{ name: string; template: string; variables: string[] }>) =>
    request<{ template: PromptTemplate }>(
      `/agents/${agentId}/templates/${templateId}`,
      { method: 'PATCH', body: JSON.stringify(data) }
    ),

  delete: (agentId: string, templateId: string) =>
    request<{ success: boolean }>(
      `/agents/${agentId}/templates/${templateId}`,
      { method: 'DELETE' }
    ),
};

// Legacy Workflows (per-agent steps)
export const workflows = {
  get: (agentId: string) =>
    request<{ steps: WorkflowStep[] }>(`/agents/${agentId}/workflow`),

  save: (agentId: string, steps: { action_type: string; config: Record<string, unknown> }[]) =>
    request<{ steps: WorkflowStep[] }>(
      `/agents/${agentId}/workflow`,
      { method: 'PUT', body: JSON.stringify({ steps }) }
    ),
};

// Pending Approval type
export interface PendingApproval {
  run_id: string;
  workflow_id: string;
  workflow_name: string;
  workflow_description?: string;
  node_id: string;
  node_name: string;
  message: string;
  checkpoint_config?: {
    message?: string;
    require_feedback?: boolean;
    show_context?: boolean;
    allow_loop_back?: boolean;
    loop_back_node_id?: string;
    max_loops?: number;
  };
  input_data: Record<string, unknown>;
  context: Record<string, unknown>;
  started_at?: string;
  paused_at: string;
  node_history: {
    node_id: string;
    node_name: string;
    node_type: string;
    status: string;
    output: Record<string, unknown>;
    completed_at: string;
  }[];
  // Loop-back options
  supports_loop_back: boolean;
  loop_back_targets: { id: string; name: string; node_type: string }[];
  default_loop_back_node_id?: string;
  max_loops: number;
  current_loop_count: number;
}

// Workflow Orchestration (LangGraph-style multi-agent workflows)
export const workflowOrchestration = {
  // Workflow CRUD
  list: () =>
    request<{ workflows: Workflow[] }>('/workflows'),
  
  // Pending approvals (human checkpoints)
  getPendingApprovals: () =>
    request<{ pending_approvals: PendingApproval[]; count: number }>('/workflows/pending-approvals'),

  get: (workflowId: string) =>
    request<{ workflow: Workflow; nodes: WorkflowNode[]; edges: WorkflowEdge[] }>(`/workflows/${workflowId}`),

  create: (data: { name: string; description?: string }) =>
    request<{ workflow: Workflow; nodes: WorkflowNode[]; edges: WorkflowEdge[] }>('/workflows', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (workflowId: string, data: Partial<Workflow>) =>
    request<{ workflow: Workflow }>(`/workflows/${workflowId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (workflowId: string) =>
    request<{ success: boolean }>(`/workflows/${workflowId}`, { method: 'DELETE' }),

  // Node CRUD
  addNode: (workflowId: string, data: Omit<WorkflowNode, 'id' | 'workflow_id' | 'created_at'>) =>
    request<{ node: WorkflowNode }>(`/workflows/${workflowId}/nodes`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateNode: (workflowId: string, nodeId: string, data: Partial<WorkflowNode>) =>
    request<{ node: WorkflowNode }>(`/workflows/${workflowId}/nodes/${nodeId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteNode: (workflowId: string, nodeId: string) =>
    request<{ success: boolean }>(`/workflows/${workflowId}/nodes/${nodeId}`, { method: 'DELETE' }),

  // Edge CRUD
  addEdge: (workflowId: string, data: { source_node_id: string; target_node_id: string; condition_label?: string }) =>
    request<{ edge: WorkflowEdge }>(`/workflows/${workflowId}/edges`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteEdge: (workflowId: string, edgeId: string) =>
    request<{ success: boolean }>(`/workflows/${workflowId}/edges/${edgeId}`, { method: 'DELETE' }),

  // Workflow Execution
  run: (workflowId: string, inputData?: Record<string, unknown>) =>
    request<{ run: WorkflowRun }>(`/workflows/${workflowId}/run`, {
      method: 'POST',
      body: JSON.stringify({ input_data: inputData || {} }),
    }),

  getRun: (workflowId: string, runId: string) =>
    request<{ run: WorkflowRun; node_runs: WorkflowNodeRun[] }>(`/workflows/${workflowId}/runs/${runId}`),

  listRuns: (workflowId: string) =>
    request<{ runs: WorkflowRun[] }>(`/workflows/${workflowId}/runs`),

  resumeRun: (workflowId: string, runId: string, data: { 
    approved: boolean; 
    feedback?: string;
    action?: 'fail' | 'loop_back';
    loop_back_node_id?: string;
  }) =>
    request<{ success: boolean; message?: string; loop_count?: number }>(`/workflows/${workflowId}/runs/${runId}/resume`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  cancelRun: (workflowId: string, runId: string) =>
    request<{ success: boolean }>(`/workflows/${workflowId}/runs/${runId}/cancel`, { method: 'POST' }),
  
  // Workflow Buckets
  listBuckets: (workflowId: string) =>
    request<{ buckets: WorkflowBucket[] }>(`/workflows/${workflowId}/buckets`),
  
  attachBucket: (workflowId: string, data: { bucket_id: string; mount_path?: string; read_only?: boolean }) =>
    request<WorkflowBucket>(`/workflows/${workflowId}/buckets`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  detachBucket: (workflowId: string, bucketId: string) =>
    request<{ success: boolean }>(`/workflows/${workflowId}/buckets/${bucketId}`, { method: 'DELETE' }),
};

// Builder (AI chat for creating agents)
export const builder = {
  listConversations: () =>
    request<{ conversations: BuilderConversation[] }>('/builder/conversations'),

  createConversation: () =>
    request<{ conversation: BuilderConversation }>('/builder/conversations', {
      method: 'POST',
    }),

  getMessages: (conversationId: string) =>
    request<{ messages: BuilderMessage[] }>(`/builder/conversations/${conversationId}/messages`),

  sendMessage: (conversationId: string, content: string) =>
    request<{ message: BuilderMessage }>(`/builder/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  deleteConversation: (conversationId: string) =>
    request<{ success: boolean }>(`/builder/conversations/${conversationId}`, {
      method: 'DELETE',
    }),

  getMemories: () =>
    request<{ memories: BuilderMemory[] }>('/builder/memories'),
};

export interface BuilderConversation {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface BuilderMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: { id: string; name: string; input: Record<string, unknown> }[] | null;
  tool_results?: { tool_use_id: string; content: string }[] | null;
  created_at: string;
}

export interface BuilderMemory {
  id: string;
  user_id: string;
  memory_type: 'preference' | 'fact' | 'context';
  content: string;
  importance: number;
  created_at: string;
  last_accessed: string;
}

export interface PromptTemplate {
  id: string;
  agent_id: string;
  name: string;
  template: string;
  variables?: string;
  created_at: string;
}

export interface WorkflowStep {
  id: string;
  agent_id: string;
  step_order: number;
  action_type: 'prompt' | 'fetch' | 'write' | 'webhook' | 'chain';
  config: Record<string, unknown>;
  created_at: string;
}

// Types
export interface User {
  id: string;
  email: string;
  github_username?: string;
  github_connected?: boolean;
  gitlab_username?: string;
  gitlab_connected?: boolean;
}

export interface Repository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  url: string;
  clone_url: string;
  default_branch: string;
  private: boolean;
}

export interface Branch {
  name: string;
  protected: boolean;
}

export interface Session {
  id: string;
  user_id: string;
  agent_type: 'code' | 'task' | 'portal' | 'portal-sandbox';
  repo_url?: string;
  repo_name?: string;
  branch?: string;
  sandbox_id?: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  agent_provider?: 'claude-code' | 'aider' | 'opencode';
  agent_model?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentProvider {
  id: string;
  name: string;
  description: string;
  requiresKey: string;
  supportsModelSelection?: boolean;
}

export interface ModelOption {
  id: string;
  name: string;
  provider: string;
  envKey: string;
  description?: string;
  configured: boolean;
}

export interface ModelProviderGroup {
  name: string;
  envKey: string;
  configured: boolean;
  models: ModelOption[];
}

export interface Task {
  id: string;
  session_id: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  model_provider?: string;
  model_name?: string;
  created_at: string;
  updated_at: string;
}

export type ModelProvider = 'anthropic' | 'openai';

export interface Message {
  id: string;
  task_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string;
  last_used_at?: string;
  created_at: string;
}

export interface PortalTheme {
  primaryColor?: string;
  backgroundColor?: string;
  accentColor?: string;
  textColor?: string;
  buttonColor?: string;
  fontFamily?: 'system' | 'sans' | 'serif' | 'mono' | 'display';
}

export interface AgentConfigType {
  id: string;
  session_id: string;
  agent_type?: 'code' | 'task' | 'portal' | 'portal-sandbox';  // Added portal-sandbox
  name?: string;
  system_prompt?: string;
  allowed_tools?: string;
  secrets?: string;
  e2b_template?: string;
  api_enabled: number | boolean;
  webhook_url?: string;
  chain_to_agent_id?: string;
  chain_condition?: 'on_success' | 'on_failure' | 'always';
  portal_enabled?: number | boolean;
  embed_theme?: string; // JSON string of PortalTheme
  embed_greeting?: string;
  portal_logo_url?: string;
  portal_name?: string;
  portal_custom_css?: string; // Custom CSS for iframe embed
  portal_greeting?: string | null; // Custom greeting for Insights Portal (e.g., "Hey there, I'm {name}")
  portal_suggested_questions?: string[] | null; // Custom suggested questions for Insights Portal
  output_schema?: string; // JSON Schema for structured output (SDK feature)
  enable_extended_thinking?: boolean; // Enable Claude's extended thinking
  thinking_budget_tokens?: number; // Token budget for extended thinking
  // Portal agent specific fields
  portal_agent_model?: string;
  portal_agent_thinking_budget?: number;
  portal_agent_max_tokens?: number;
  portal_agent_tools?: string;
  portal_agent_sandbox_enabled?: boolean;
  setup_wizard_completed?: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentListItem {
  id: string;
  repo_name: string;
  config_name?: string;
}

export interface DebugLogEntry {
  type: 'text' | 'tool' | 'status' | 'error';
  content: string;
  timestamp: number;
  raw?: Record<string, unknown>;
}

export interface AgentRun {
  id: string;
  agent_id: string;
  user_id: string;
  prompt: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  priority: number;
  source: 'web' | 'api' | 'chain' | 'workflow';
  sdk_session_id?: string;
  result?: string;
  structured_output?: Record<string, unknown>;
  error?: string;
  debug_log?: string; // JSON string of DebugLogEntry[]
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface Schedule {
  id: string;
  user_id: string;
  session_id: string;
  name: string;
  description: string | null;
  cron_expression: string;
  timezone: string;
  prompt: string;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  description_human?: string;
  agent_name?: string;
  created_at: string;
  updated_at: string;
}

export interface ScheduleRun {
  id: string;
  schedule_id: string;
  task_id: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  created_at: string;
}

// Workflow Orchestration Types
export type WorkflowNodeType = 'start' | 'end' | 'agent' | 'condition' | 'human_checkpoint' | 'parallel_split' | 'parallel_merge' | 'transform' | 'delay';

export interface Workflow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  max_retries: number;
  timeout_seconds: number;
  canvas_state: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  // Extra fields from list endpoint
  node_count?: number;
  run_count?: number;
  last_run?: WorkflowRun | null;
}

export interface WorkflowNode {
  id: string;
  workflow_id: string;
  node_type: WorkflowNodeType;
  name: string;
  description: string | null;
  position_x: number;
  position_y: number;
  config: string; // JSON string
  created_at: string;
}

export interface WorkflowEdge {
  id: string;
  workflow_id: string;
  source_node_id: string;
  target_node_id: string;
  condition_label: string | null;
  edge_order: number;
  created_at: string;
}

export type WorkflowRunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  user_id: string;
  input_data: string;
  output_data: string | null;
  context: string;
  status: WorkflowRunStatus;
  current_node_id: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export type WorkflowNodeRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting_human';

export interface WorkflowNodeRun {
  id: string;
  workflow_run_id: string;
  node_id: string;
  node_name?: string;
  node_type?: string;
  input_data: string | null;
  output_data: string | null;
  status: WorkflowNodeRunStatus;
  retry_count: number;
  error: string | null;
  task_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface WorkflowBucket {
  id: string;
  workflow_id: string;
  bucket_id: string;
  bucket_name: string;
  mount_path: string;
  read_only: boolean | number;
  created_at: string;
}

// ============================================
// EVENTS & WEBHOOKS API
// ============================================

export const events = {
  // Webhooks
  listWebhooks: () =>
    request<{ webhooks: Webhook[] }>('/events/webhooks'),

  createWebhook: (data: { name: string; target_type: 'agent' | 'workflow'; target_id: string; description?: string; payload_mapping?: Record<string, string> }) =>
    request<{ webhook: Webhook }>('/events/webhooks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteWebhook: (id: string) =>
    request<{ success: boolean }>(`/events/webhooks/${id}`, { method: 'DELETE' }),

  regenerateWebhookSecret: (id: string) =>
    request<{ webhook_url: string }>(`/events/webhooks/${id}/regenerate`, { method: 'POST' }),

  // GitHub Webhooks
  listGitHubWebhooks: () =>
    request<{ webhooks: GitHubWebhook[] }>('/events/github-webhooks'),

  createGitHubWebhook: (data: { repo_full_name: string; events: string[]; target_type: 'agent' | 'workflow'; target_id: string; prompt_template?: string; filters?: Record<string, string> }) =>
    request<{ webhook: GitHubWebhook; setup_instructions: { webhook_url: string; secret: string } }>('/events/github-webhooks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteGitHubWebhook: (id: string) =>
    request<{ success: boolean }>(`/events/github-webhooks/${id}`, { method: 'DELETE' }),

  // Scheduled Tasks
  listSchedules: () =>
    request<{ schedules: ScheduledTask[] }>('/events/schedules'),

  createSchedule: (data: { name: string; cron_expression: string; target_type: 'agent' | 'workflow'; target_id: string; prompt?: string; timezone?: string }) =>
    request<{ schedule: ScheduledTask }>('/events/schedules', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateSchedule: (id: string, data: Partial<ScheduledTask>) =>
    request<{ schedule: ScheduledTask }>(`/events/schedules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteSchedule: (id: string) =>
    request<{ success: boolean }>(`/events/schedules/${id}`, { method: 'DELETE' }),

  // Notification Channels
  listNotificationChannels: () =>
    request<{ channels: NotificationChannel[] }>('/events/notifications/channels'),

  createNotificationChannel: (data: { name: string; channel_type: 'slack' | 'discord' | 'webhook'; config: Record<string, string> }) =>
    request<{ channel: NotificationChannel }>('/events/notifications/channels', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteNotificationChannel: (id: string) =>
    request<{ success: boolean }>(`/events/notifications/channels/${id}`, { method: 'DELETE' }),

  testNotificationChannel: (id: string) =>
    request<{ success: boolean; message: string }>(`/events/notifications/channels/${id}/test`, { method: 'POST' }),

  // Notification Rules
  listNotificationRules: () =>
    request<{ rules: NotificationRule[] }>('/events/notifications/rules'),

  createNotificationRule: (data: { channel_id: string; name: string; trigger_type: string; message_template: string; filter?: Record<string, string> }) =>
    request<{ rule: NotificationRule }>('/events/notifications/rules', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteNotificationRule: (id: string) =>
    request<{ success: boolean }>(`/events/notifications/rules/${id}`, { method: 'DELETE' }),

  // Event Log
  getEventLog: (limit?: number, offset?: number) =>
    request<{ events: EventLogEntry[]; total: number }>(`/events/events?limit=${limit || 50}&offset=${offset || 0}`),
};

// Event Types
export interface Webhook {
  id: string;
  user_id: string;
  secret: string;
  name: string;
  description: string | null;
  target_type: 'agent' | 'workflow';
  target_id: string;
  webhook_url: string;
  payload_mapping: Record<string, string>;
  is_active: number;
  trigger_count: number;
  last_triggered_at: string | null;
  created_at: string;
}

export interface GitHubWebhook {
  id: string;
  user_id: string;
  repo_full_name: string;
  events: string[];
  filters: Record<string, string>;
  target_type: 'agent' | 'workflow';
  target_id: string;
  prompt_template: string | null;
  is_active: number;
  trigger_count: number;
  last_triggered_at: string | null;
  created_at: string;
}

export interface ScheduledTask {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  cron_expression: string;
  timezone: string;
  target_type: 'agent' | 'workflow';
  target_id: string;
  prompt: string | null;
  is_active: number;
  next_run_at: string | null;
  last_run_at: string | null;
  run_count: number;
  created_at: string;
}

export interface NotificationChannel {
  id: string;
  user_id: string;
  name: string;
  channel_type: 'slack' | 'discord' | 'email' | 'webhook';
  config: Record<string, string>;
  is_active: number;
  created_at: string;
}

export interface NotificationRule {
  id: string;
  user_id: string;
  channel_id: string;
  channel_name?: string;
  name: string;
  trigger_type: string;
  filter: Record<string, string> | null;
  message_template: string;
  is_active: number;
  created_at: string;
}

export interface EventLogEntry {
  id: string;
  user_id: string;
  event_type: string;
  source_type: string;
  source_id: string | null;
  target_type: string | null;
  target_id: string | null;
  status: string;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

// Agent Templates
export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  agent_type: 'code' | 'task' | 'portal' | 'portal-sandbox';
  tags: string[];
  type: 'agent';
  system_prompt?: string;
}

// Workflow Templates
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
  type: 'workflow';
}

export const agentTemplates = {
  list: () =>
    request<{ agent_templates: AgentTemplate[]; workflow_templates: WorkflowTemplate[] }>('/builder/templates'),

  createFromTemplate: (templateId: string, data: { name_override?: string; repo_url?: string }) =>
    request<{ agent: { id: string; name: string; type: string; template: string; description: string } }>(
      `/builder/templates/${templateId}/create`,
      { method: 'POST', body: JSON.stringify(data) }
    ),

  createWorkflowFromTemplate: (templateId: string, data: { name_override?: string }) =>
    request<{ workflow: { id: string; name: string; template: string; description: string; node_count: number } }>(
      `/builder/workflow-templates/${templateId}/create`,
      { method: 'POST', body: JSON.stringify(data) }
    ),
};

// File System Types
export interface Bucket {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  storage_used: number;
  storage_limit: number;
  created_at: string;
  updated_at: string;
  // Repo info (included via LEFT JOIN in list buckets)
  repo_url?: string;
  repo_branch?: string;
  sync_status?: 'pending' | 'syncing' | 'synced' | 'failed';
  sync_progress?: SyncProgress;
  last_synced_at?: string;
}

export interface FileItem {
  id: string;
  bucket_id: string;
  name: string;
  path: string;
  parent_id?: string;
  is_folder: boolean;
  mime_type?: string;
  size: number;
  created_at: string;
  updated_at: string;
}

// Files API
export const files = {
  // Bucket operations
  listBuckets: () =>
    request<{ buckets: Bucket[] }>('/files/buckets'),

  getBucket: (id: string) =>
    request<{ bucket: Bucket }>(`/files/buckets/${id}`),

  createBucket: (name: string, description?: string) =>
    request<{ bucket: Bucket }>(
      '/files/buckets',
      { method: 'POST', body: JSON.stringify({ name, description }) }
    ),

  updateBucket: (id: string, data: { name?: string; description?: string }) =>
    request<{ bucket: Bucket }>(
      `/files/buckets/${id}`,
      { method: 'PATCH', body: JSON.stringify(data) }
    ),

  deleteBucket: (id: string) =>
    request<{ success: boolean }>(`/files/buckets/${id}`, { method: 'DELETE' }),

  // File operations
  listFiles: (bucketId: string, path = '/', limit = 50, offset = 0, search = '') =>
    request<{ files: FileItem[]; total: number; path: string; bucket: Bucket; search?: string }>(
      `/files/buckets/${bucketId}/files?path=${encodeURIComponent(path)}&limit=${limit}&offset=${offset}${search ? `&search=${encodeURIComponent(search)}` : ''}`
    ),

  createFolder: (bucketId: string, name: string, parentPath = '/') =>
    request<{ file: FileItem }>(
      `/files/buckets/${bucketId}/folders`,
      { method: 'POST', body: JSON.stringify({ name, parentPath }) }
    ),

  uploadFiles: async (bucketId: string, fileList: FileList, parentPath = '/') => {
    const formData = new FormData();
    const relativePaths: string[] = [];
    
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      formData.append('files', file);
      // webkitRelativePath contains folder structure like "folder/subfolder/file.txt"
      // Use it if available (folder upload), otherwise just the filename
      const relativePath = (file as any).webkitRelativePath || file.name;
      relativePaths.push(relativePath);
    }
    
    formData.append('parentPath', parentPath);
    formData.append('relativePaths', JSON.stringify(relativePaths));

    const response = await fetch(`/api/files/buckets/${bucketId}/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Upload failed');
    }

    return response.json() as Promise<{ files: FileItem[] }>;
  },

  getFile: (id: string) =>
    request<{ file: FileItem }>(`/files/files/${id}`),

  downloadFile: async (id: string) => {
    const response = await fetch(`/api/files/files/${id}/download`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Download failed');
    }

    return response.blob();
  },

  deleteFile: (id: string) =>
    request<{ success: boolean }>(`/files/files/${id}`, { method: 'DELETE' }),

  renameFile: (id: string, name: string) =>
    request<{ file: FileItem }>(
      `/files/files/${id}`,
      { method: 'PATCH', body: JSON.stringify({ name }) }
    ),

  // Agent-bucket associations
  getAgentBuckets: (sessionId: string) =>
    request<{ buckets: Array<{ id: string; bucket_id: string; bucket_name: string; mount_path: string; read_only: boolean }> }>(
      `/files/agents/${sessionId}/buckets`
    ),

  addAgentBucket: (sessionId: string, bucketId: string, mountPath = '/home/user/workspace/files', readOnly = false) =>
    request<{ success: boolean }>(
      `/files/agents/${sessionId}/buckets`,
      { method: 'POST', body: JSON.stringify({ bucket_id: bucketId, mount_path: mountPath, read_only: readOnly }) }
    ),

  removeAgentBucket: (sessionId: string, bucketId: string) =>
    request<{ success: boolean }>(`/files/agents/${sessionId}/buckets/${bucketId}`, { method: 'DELETE' }),

  // Storage configuration
  getStorageInfo: () =>
    request<StorageInfo>('/files/storage/info'),

  getStorageConfig: () =>
    request<{ config: StorageConfig | null }>('/files/storage/config'),

  saveStorageConfig: (config: {
    provider: 's3' | 'r2' | 's3-compatible';
    bucket_name: string;
    region?: string;
    endpoint?: string;
    access_key_id: string;
    secret_access_key: string;
  }) =>
    request<{ config: StorageConfig }>('/files/storage/config', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  testStorageConfig: () =>
    request<{ success: boolean; error?: string; test_status: string }>('/files/storage/config/test', {
      method: 'POST',
    }),

  deleteStorageConfig: () =>
    request<{ success: boolean }>('/files/storage/config', { method: 'DELETE' }),

  toggleStorageConfig: (isActive: boolean) =>
    request<{ success: boolean }>('/files/storage/config/toggle', {
      method: 'PATCH',
      body: JSON.stringify({ is_active: isActive }),
    }),

  // Repo-backed bucket operations
  createBucketFromRepo: (data: { 
    name: string; 
    repo_url: string; 
    branch?: string; 
    token?: string; 
    description?: string;
    installation_id?: number; // GitHub App installation ID for granular access
  }) =>
    request<{ bucket: Bucket; bucketRepo: BucketRepo }>(
      '/files/buckets/from-repo',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  getBucketRepo: (bucketId: string) =>
    request<{ bucketRepo: BucketRepo | null }>(`/files/buckets/${bucketId}/repo`),

  syncBucketRepo: (bucketId: string) =>
    request<{ success: boolean; message: string }>(`/files/buckets/${bucketId}/sync`, { method: 'POST' }),

  checkSyncStatus: (bucketId: string) =>
    request<{ needsSync: boolean; remoteCommit?: string; localCommit?: string; error?: string }>(
      `/files/buckets/${bucketId}/sync-status`
    ),

  listBucketRepos: () =>
    request<{ repos: BucketRepo[] }>('/files/repos'),

  // File content operations (for Monaco editor)
  getFileContent: (fileId: string) =>
    request<{ content: string; file: { id: string; name: string; path: string; mime_type?: string; size: number } }>(
      `/files/files/${fileId}/content`
    ),

  updateFileContent: (fileId: string, content: string) =>
    request<{ success: boolean; file: { id: string; name: string; path: string; size: number } }>(
      `/files/files/${fileId}/content`,
      { method: 'PUT', body: JSON.stringify({ content }) }
    ),

  // Commit and push to repo
  commitAndPush: (bucketId: string, data: { file_id?: string; file_path?: string; content: string; commit_message?: string }) =>
    request<{ success: boolean; sha?: string; message: string }>(
      `/files/buckets/${bucketId}/commit-push`,
      { method: 'POST', body: JSON.stringify(data) }
    ),

  // Streaming editor operations (for large files)
  getFileInfo: (fileId: string) =>
    request<FileStreamingInfo>(`/files/files/${fileId}/info`),

  getFileLines: (fileId: string, start: number, count: number) =>
    request<{ lines: string[]; start: number; count: number; totalLines: number; hasMore: boolean }>(
      `/files/files/${fileId}/lines?start=${start}&count=${count}`
    ),

  patchFile: (fileId: string, edits: Array<{ startLine: number; deleteCount: number; insertLines: string[] }>) =>
    request<{ success: boolean; file: { id: string; name: string; path: string; size: number; line_count: number } }>(
      `/files/files/${fileId}/patch`,
      { method: 'PUT', body: JSON.stringify({ edits }) }
    ),
};

// Storage types
export interface StorageInfo {
  provider: string;
  configured: boolean;
  backend: string;
  bucket: string | null;
  isUserOwned: boolean;
  maxFileSize: number;
  maxFilesPerUpload: number;
  testStatus?: string;
}

export interface StorageConfig {
  id: string;
  user_id: string;
  provider: 's3' | 'r2' | 's3-compatible';
  bucket_name: string;
  region?: string;
  endpoint?: string;
  is_active: boolean;
  last_tested_at?: string;
  test_status?: 'success' | 'failed' | 'untested';
  test_error?: string;
  created_at: string;
  updated_at: string;
}

// Repo-backed bucket info
export interface BucketRepo {
  id: string;
  bucket_id: string;
  user_id: string;
  repo_url: string;
  repo_branch: string;
  has_token: boolean;
  github_installation_id?: number; // GitHub App installation ID for granular access
  last_synced_at?: string;
  sync_status: 'pending' | 'syncing' | 'synced' | 'failed';
  sync_error?: string;
  sync_progress?: SyncProgress;
  file_count: number;
  bucket_name?: string;
  created_at: string;
  updated_at: string;
}

export interface SyncProgress {
  phase: 'discovering' | 'downloading' | 'extracting' | 'uploading';
  current: number;
  total: number;
  message: string;
}

// Streaming editor file info
export interface FileStreamingInfo {
  id: string;
  name: string;
  path: string;
  size: number;
  line_count: number | null;
  mime_type: string | null;
  useStreaming: boolean;
  streamingThreshold: number;
}

// Agent Users API (portal + embed users)
export interface AgentUser {
  id: string;
  type: 'portal' | 'embed';
  identifier: string;
  displayName: string;
  userContext: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentThread {
  id: string;
  title: string | null;
  messageCount: number;
  lastMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface AgentStats {
  totalUsers: number;
  portalUsers: number;
  embedUsers: number;
  totalThreads: number;
  totalMessages: number;
}

export const agentUsers = {
  // Get all users for an agent
  getUsers: (agentId: string) =>
    request<{ 
      users: AgentUser[]; 
      total: number;
      portalCount: number;
      embedCount: number;
    }>(`/agents/${agentId}/users`),

  // Get threads for a user
  getThreads: (agentId: string, userId: string, type: 'portal' | 'embed') =>
    request<{ threads: AgentThread[] }>(
      `/agents/${agentId}/users/${userId}/threads?type=${type}`
    ),

  // Get messages for a thread
  getMessages: (agentId: string, userId: string, threadId: string, type: 'portal' | 'embed') =>
    request<{ messages: AgentMessage[] }>(
      `/agents/${agentId}/users/${userId}/threads/${threadId}/messages?type=${type}`
    ),

  // Get stats for an agent
  getStats: (agentId: string) =>
    request<AgentStats>(`/agents/${agentId}/stats`),
};

// ============================================
// SKILLS & MCP API
// ============================================

export interface BuiltinSkill {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'productivity' | 'development' | 'data' | 'communication' | 'ai';
  requiredSecrets: string[];
  optionalSecrets?: string[];
  docsUrl?: string;
}

export interface MCPServerConfig {
  id: string;
  type: 'builtin' | 'custom';
  name: string;
  skill_id?: string; // For builtin skills
  transport?: 'sse' | 'streamable-http';
  url?: string;
  headers?: Record<string, string>;
  tools?: string[]; // Discovered tools
  error?: string;
  status?: 'connected' | 'disconnected' | 'error';
}

export interface AgentSkillsConfig {
  enabledSkills: string[];  // Array of skill IDs
  mcpServers: MCPServerConfig[];
}

export const skills = {
  // Get all available builtin skills
  getBuiltinSkills: () =>
    request<{ skills: BuiltinSkill[] }>('/skills/builtin'),

  // Get agent's skills configuration
  getAgentSkills: (sessionId: string) =>
    request<{ 
      builtinSkills: Array<BuiltinSkill & { enabled: boolean; configured: boolean; missingSecrets: string[] }>;
      customServers: MCPServerConfig[];
    }>(
      `/skills/agents/${sessionId}`
    ),

  // Update agent's enabled skills
  updateSkills: (sessionId: string, skillIds: string[]) =>
    request<{ success: boolean; skills: string[] }>(
      `/skills/agents/${sessionId}/skills`,
      { method: 'PATCH', body: JSON.stringify({ skills: skillIds }) }
    ),

  // Add a custom MCP server
  addMcpServer: (sessionId: string, config: { name: string; transport: 'sse' | 'streamable-http'; url: string; headers?: Record<string, string> }) =>
    request<{ success: boolean; server: MCPServerConfig }>(
      `/skills/agents/${sessionId}/mcp-servers`,
      { method: 'POST', body: JSON.stringify(config) }
    ),

  // Remove a custom MCP server
  removeMcpServer: (sessionId: string, serverId: string) =>
    request<{ success: boolean }>(
      `/skills/agents/${sessionId}/mcp-servers/${serverId}`,
      { method: 'DELETE' }
    ),

  // Test an MCP server connection
  testMcpServer: (sessionId: string, serverId: string) =>
    request<{ success: boolean; tools?: { name: string; description: string }[]; error?: string }>(
      `/skills/agents/${sessionId}/mcp-servers/${serverId}/test`,
      { method: 'POST' }
    ),

  // Disconnect an MCP server
  disconnectMcpServer: (sessionId: string, serverId: string) =>
    request<{ success: boolean }>(
      `/skills/agents/${sessionId}/mcp-servers/${serverId}/disconnect`,
      { method: 'POST' }
    ),
};

// Analytics interfaces
export interface AnalyticsSummary {
  totalMessages: number;
  totalResponses: number;
  totalSessions: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  avgLatencyMs: number;
  successRate: number;
  errorCount: number;
}

export interface UsageOverTimeData {
  timestamp: string;
  messages: number;
  responses: number;
  sessions: number;
  tokensInput: number;
  tokensOutput: number;
}

export interface UsageBySourceData {
  source: string;
  count: number;
  tokensInput: number;
  tokensOutput: number;
}

export interface LatencyPercentiles {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface ToolUsageData {
  toolName: string;
  callCount: number;
  successCount: number;
  errorCount: number;
}

export interface RecentError {
  id: string;
  eventType: string;
  source: string;
  errorMessage: string;
  createdAt: string;
}

export interface KBAnalytics {
  totalSearches: number;
  successfulSearches: number;
  hitRate: number;
  topQueries: Array<{ query: string; count: number }>;
  topDocuments: Array<{ document: string; accessCount: number; avgScore: number }>;
}

export interface SandboxStats {
  totalStarts: number;
  totalStops: number;
  avgLifetimeMs: number;
  totalRuntimeMs: number;
}

export interface ActiveSessions {
  portalSessions: number;
  embedSessions: number;
  chatSessions: number;
  total: number;
}

export interface SessionDurations {
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  totalSessions: number;
}

export interface StorageUsage {
  kbStorageBytes: number;
  kbChunks: number;
  fileStorageBytes: number;
  fileCount: number;
  bucketCount: number;
}

export interface SystemStats {
  totalAgents: number;
  activeAgents: number;
  activeSandboxes: number;
  totalMessages: number;
  totalSessions: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalFiles: number;
  totalFileStorage: number;
  totalKBChunks: number;
  totalBuckets: number;
  totalKnowledgeBases: number;
  errorRate: number;
}

export interface TopAgent {
  agentId: string;
  agentName: string;
  messageCount: number;
  sessionCount: number;
  lastActive: string;
}

export interface WoWComparison {
  messagesChange: number;
  sessionsChange: number;
  tokensChange: number;
  errorsChange: number;
}

export interface SourceDistribution {
  source: string;
  count: number;
  percentage: number;
}

export interface ConversationDepth {
  avgMessagesPerSession: number;
  avgResponsesPerSession: number;
  totalConversations: number;
  shortConversations: number;
  mediumConversations: number;
  longConversations: number;
}

export interface PeakHourData {
  dayOfWeek: number;
  hour: number;
  count: number;
}

export interface ApiStats {
  totalRequests: number;
  totalResponses: number;
  totalErrors: number;
  avgResponseTimeMs: number;
  successRate: number;
  tokensIn: number;
  tokensOut: number;
  uniqueApiKeys: number;
  requestsOverTime: Array<{ date: string; requests: number; errors: number }>;
}

export interface ResponseLengthStats {
  avgTokensPerResponse: number;
  minTokens: number;
  maxTokens: number;
  medianTokens: number;
}

export interface SandboxUsageToday {
  startsToday: number;
  stopsToday: number;
  startsYesterday: number;
  currentlyRunning: number;
  avgLifetimeMinutes: number;
  peakConcurrent: number;
}

export interface SystemToolUsage {
  toolName: string;
  callCount: number;
  successCount: number;
  errorCount: number;
  agentCount: number;
}

// Analytics API
export const analytics = {
  // Get summary stats
  getSummary: (agentId: string, startDate?: string, endDate?: string) =>
    request<{ success: boolean; summary: AnalyticsSummary }>(
      `/analytics/${agentId}/summary?${new URLSearchParams({
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      })}`
    ),

  // Get usage over time for charts
  getUsageOverTime: (agentId: string, startDate?: string, endDate?: string, granularity: 'hour' | 'day' = 'day') =>
    request<{ success: boolean; data: UsageOverTimeData[] }>(
      `/analytics/${agentId}/usage-over-time?${new URLSearchParams({
        granularity,
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      })}`
    ),

  // Get usage by source (portal, embed, api, etc.)
  getUsageBySource: (agentId: string, startDate?: string, endDate?: string) =>
    request<{ success: boolean; data: UsageBySourceData[] }>(
      `/analytics/${agentId}/by-source?${new URLSearchParams({
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      })}`
    ),

  // Get latency percentiles
  getLatency: (agentId: string, startDate?: string, endDate?: string) =>
    request<{ success: boolean; percentiles: LatencyPercentiles }>(
      `/analytics/${agentId}/latency?${new URLSearchParams({
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      })}`
    ),

  // Get tool usage breakdown
  getToolUsage: (agentId: string, startDate?: string, endDate?: string) =>
    request<{ success: boolean; data: ToolUsageData[] }>(
      `/analytics/${agentId}/tools?${new URLSearchParams({
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      })}`
    ),

  // Get recent errors
  getRecentErrors: (agentId: string, limit: number = 10) =>
    request<{ success: boolean; errors: RecentError[] }>(
      `/analytics/${agentId}/errors?limit=${limit}`
    ),

  // Get KB analytics
  getKBAnalytics: (agentId: string, startDate?: string, endDate?: string) =>
    request<{ success: boolean; data: KBAnalytics }>(
      `/analytics/${agentId}/kb?${new URLSearchParams({
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      })}`
    ),

  // Get sandbox stats
  getSandboxStats: (agentId: string, startDate?: string, endDate?: string) =>
    request<{ success: boolean; data: SandboxStats }>(
      `/analytics/${agentId}/sandbox?${new URLSearchParams({
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      })}`
    ),

  // Get active sessions (real-time)
  getActiveSessions: (agentId: string) =>
    request<{ success: boolean; data: ActiveSessions }>(
      `/analytics/${agentId}/active-sessions`
    ),

  // Get session durations
  getSessionDurations: (agentId: string, startDate?: string, endDate?: string) =>
    request<{ success: boolean; data: SessionDurations }>(
      `/analytics/${agentId}/session-durations?${new URLSearchParams({
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      })}`
    ),

  // Get storage usage
  getStorageUsage: (agentId: string) =>
    request<{ success: boolean; data: StorageUsage }>(
      `/analytics/${agentId}/storage`
    ),

  // Check if agent has KB attached
  hasKnowledgeBases: (agentId: string) =>
    request<{ success: boolean; hasKnowledgeBases: boolean; count: number }>(
      `/analytics/${agentId}/has-kb`
    ),

  // System-level analytics
  getSystemOverview: () =>
    request<{ success: boolean; data: SystemStats }>(
      `/analytics/system/overview`
    ),

  getTopAgents: (limit: number = 10) =>
    request<{ success: boolean; data: TopAgent[] }>(
      `/analytics/system/top-agents?limit=${limit}`
    ),

  // New system-level endpoints
  getWoWComparison: () =>
    request<{ success: boolean; data: WoWComparison }>(
      `/analytics/system/wow`
    ),

  getSourceDistribution: () =>
    request<{ success: boolean; data: SourceDistribution[] }>(
      `/analytics/system/source-distribution`
    ),

  getSystemPeakHours: (days: number = 30) =>
    request<{ success: boolean; data: PeakHourData[] }>(
      `/analytics/system/peak-hours?days=${days}`
    ),

  getSandboxUsageToday: () =>
    request<{ success: boolean; data: SandboxUsageToday }>(
      `/analytics/system/sandbox-usage-today`
    ),

  getSystemTopTools: (limit: number = 10) =>
    request<{ success: boolean; data: SystemToolUsage[] }>(
      `/analytics/system/top-tools?limit=${limit}`
    ),

  // New agent-level endpoints
  getConversationDepth: (agentId: string, startDate: string, endDate: string) =>
    request<{ success: boolean; data: ConversationDepth }>(
      `/analytics/${agentId}/conversation-depth?startDate=${startDate}&endDate=${endDate}`
    ),

  getPeakHours: (agentId: string, days: number = 30) =>
    request<{ success: boolean; data: PeakHourData[] }>(
      `/analytics/${agentId}/peak-hours?days=${days}`
    ),

  getApiStats: (agentId: string, startDate: string, endDate: string) =>
    request<{ success: boolean; data: ApiStats }>(
      `/analytics/${agentId}/api-stats?startDate=${startDate}&endDate=${endDate}`
    ),

  getResponseLength: (agentId: string, startDate: string, endDate: string) =>
    request<{ success: boolean; data: ResponseLengthStats }>(
      `/analytics/${agentId}/response-length?startDate=${startDate}&endDate=${endDate}`
    ),
};

// Portal Customizer API
export const portalCustomizer = {
  analyzeWebsite: (url: string, sessionId: string) =>
    request<{
      analysis: {
        primaryColor: string;
        accentColor: string;
        backgroundColor: string;
        textColor: string;
        fontFamily: string;
        borderRadius: string;
        customCSS: string;
        reasoning: string;
      };
      customCSS: string;
      previewUrl: string;
    }>('/portal-customizer/analyze', {
      method: 'POST',
      body: JSON.stringify({ url, sessionId }),
    }),

  applyStyles: (sessionId: string, customCSS: string, analysis?: any) =>
    request<{
      success: boolean;
      message: string;
      previewUrl: string;
    }>('/portal-customizer/apply', {
      method: 'POST',
      body: JSON.stringify({ sessionId, customCSS, analysis }),
    }),
};
