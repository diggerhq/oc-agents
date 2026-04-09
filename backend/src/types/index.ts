export interface User {
  id: string;
  email: string;
  password_hash?: string;
  workos_user_id?: string;
  github_id?: string;
  github_access_token?: string;
  github_username?: string;
  gitlab_id?: string;
  gitlab_access_token?: string;
  gitlab_refresh_token?: string;
  gitlab_username?: string;
  created_at: string;
  updated_at: string;
}

export type AgentType = 'code' | 'task' | 'portal';

export interface Session {
  id: string;
  user_id: string;
  organization_id?: string;
  agent_type: AgentType;
  repo_url?: string;  // Optional for task agents
  repo_name?: string;  // Optional for task agents
  branch?: string;
  sandbox_id?: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  agent_provider: ModelProvider;
  agent_model?: string;  // Full model ID, e.g., "anthropic/claude-sonnet-4-20250514"
  created_at: string;
  updated_at: string;
}

export type ModelProvider = 'claude-code' | 'aider' | 'opencode';

export interface Task {
  id: string;
  session_id: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  model_provider?: ModelProvider;
  model_name?: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  task_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface ApiKey {
  id: string;
  user_id: string;
  organization_id?: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  permissions: 'full' | 'read-only';
  last_used_at?: string;
  created_at: string;
}

export interface AgentConfig {
  id: string;
  session_id: string;
  name?: string;
  system_prompt?: string;
  allowed_tools?: string;  // JSON array of tool names
  secrets?: string;  // JSON object of key-value pairs
  oc_template?: string;  // Custom OC snapshot name
  api_enabled: number;  // 0 or 1
  webhook_url?: string;
  chain_to_agent_id?: string;  // Agent to trigger on completion
  chain_condition?: 'on_success' | 'on_failure' | 'always';
  skills?: string;  // JSON array of enabled builtin skill IDs
  mcp_servers?: string;  // JSON array of custom MCP server configs
  portal_enabled?: number | boolean;  // Whether portal is enabled
  portal_jwt_secret?: string;  // JWT secret for portal auth
  portal_bucket_id?: string;  // Which bucket to show in portal files (null = first bucket)
  portal_files_hidden?: boolean;  // Whether to hide files section in portal
  output_schema?: string;  // JSON Schema for structured output (SDK feature)
  enable_extended_thinking?: boolean;  // Enable Claude's extended thinking
  thinking_budget_tokens?: number;  // Token budget for extended thinking
  // Portal agent specific fields
  portal_agent_model?: string;  // Model ID for portal agent (e.g. claude-sonnet-4-5-20250929)
  portal_agent_thinking_budget?: number;  // Thinking budget tokens for portal agent
  portal_agent_max_tokens?: number;  // Max output tokens for portal agent
  portal_agent_tools?: string;  // JSON array of enabled tool categories
  portal_agent_sandbox_enabled?: boolean;  // Whether sandbox tool is available
  setup_wizard_completed?: boolean;  // Whether setup wizard has been completed
  created_at: string;
  updated_at: string;
}

export interface QueuedTask {
  id: string;
  agent_id: string;
  user_id: string;
  prompt: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelling' | 'cancelled';
  priority: number;
  source: 'web' | 'api' | 'chain' | 'workflow';
  api_key_id?: string;
  sdk_session_id?: string;  // SDK session ID for isolated sandbox routing
  result?: string;
  error?: string;
  debug_log?: string;  // JSON array of debug entries (thoughts, tool calls, responses)
  structured_output?: string;  // JSON structured output if output_schema was defined
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface SdkSession {
  id: string;
  agent_id: string;
  api_key_id?: string;
  sandbox_id?: string;
  status: 'active' | 'closed';
  created_at: string;
  last_used_at: string;
  closed_at?: string;
}

export interface PromptTemplate {
  id: string;
  agent_id: string;
  name: string;
  template: string;
  variables?: string;  // JSON array of variable names
  created_at: string;
}

export type WorkflowActionType = 'prompt' | 'fetch' | 'write' | 'webhook' | 'chain';

export interface WorkflowStep {
  id: string;
  agent_id: string;
  step_order: number;
  action_type: WorkflowActionType;
  config: string;  // JSON config for the action
  created_at: string;
}

// File System Types
export interface Bucket {
  id: string;
  user_id: string;
  organization_id?: string;
  name: string;
  description?: string;
  storage_used: number;
  storage_limit: number;
  created_at: string;
  updated_at: string;
}

export interface FileRecord {
  id: string;
  bucket_id: string;
  user_id: string;
  name: string;
  path: string;
  parent_id?: string;
  is_folder: boolean | number;
  mime_type?: string;
  size: number;
  content?: Buffer;
  storage_key?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentBucket {
  id: string;
  session_id: string;
  bucket_id: string;
  mount_path: string;
  read_only: boolean | number;
  created_at: string;
}

export type StorageProvider = 's3' | 'r2' | 's3-compatible';

export interface UserStorageConfig {
  id: string;
  user_id: string;
  provider: StorageProvider;
  bucket_name: string;
  region?: string;
  endpoint?: string;
  access_key_id: string;
  secret_access_key: string;
  is_active: boolean | number;
  last_tested_at?: string;
  test_status?: 'success' | 'failed' | 'untested';
  test_error?: string;
  created_at: string;
  updated_at: string;
}

// MCP Connection tracking
export interface MCPConnection {
  id: string;
  session_id: string;
  server_id: string;
  server_name: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  tools_discovered?: string;  // JSON array of tool names
  error?: string;
  connected_at?: string;
  last_used_at?: string;
  created_at: string;
}

// Skill definition (for custom skills in database)
export interface Skill {
  id: string;
  user_id: string;
  organization_id?: string;
  name: string;
  description?: string;
  icon: string;
  category: 'productivity' | 'development' | 'data' | 'communication' | 'ai' | 'custom';
  mcp_config: string;  // JSON MCPServerConfig
  required_env?: string;  // JSON array of required env var names
  is_public: boolean | number;
  created_at: string;
}

// Bucket Repository (for repo-backed buckets)
// Allows any bucket to be synced from a git repository
export interface BucketRepo {
  id: string;
  bucket_id: string;
  user_id: string;
  repo_url: string;
  repo_branch: string;
  repo_token?: string;
  github_installation_id?: number; // GitHub App installation ID for granular repo access
  last_synced_at?: string;
  sync_status: 'pending' | 'syncing' | 'synced' | 'failed';
  sync_error?: string;
  sync_progress?: string; // JSON: { phase: 'downloading' | 'extracting' | 'uploading', current: number, total: number, message: string }
  file_count: number;
  created_at: string;
  updated_at: string;
}

export interface SyncProgress {
  phase: 'discovering' | 'downloading' | 'extracting' | 'uploading';
  current: number;
  total: number;
  message: string;
}

// Detected skill-related folders in buckets (computed at agent load time)
// These are scanned from ALL attached buckets, not just repo-backed ones
export interface DetectedSkillFolders {
  skills: string[];   // Paths to skill files (e.g., claude/skills/*.md, .cursorrules, AGENTS.md)
  tools: string[];    // Paths to tool scripts (e.g., claude/tools/*.sh)
  prompts: string[];  // Paths to prompt templates (e.g., claude/prompts/*.md)
}

// Organization types
export type OrgRole = 'owner' | 'admin' | 'member';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  is_personal: boolean;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
}

export interface OrganizationInvitation {
  id: string;
  organization_id: string;
  email: string;
  role: 'admin' | 'member';
  token: string;
  invited_by: string;
  expires_at: string;
  accepted_at?: string;
  created_at: string;
}

export type ResourceVisibility = 'org' | 'private' | 'role';

export interface ResourcePermission {
  id: string;
  resource_type: string;
  resource_id: string;
  organization_id: string;
  visibility: ResourceVisibility;
  min_role: OrgRole;
  created_at: string;
}

// Extended types with organization context
export interface OrganizationWithRole extends Organization {
  role: OrgRole;
}

export interface UserWithOrgs extends User {
  organizations?: OrganizationWithRole[];
  current_org_id?: string;
}

// GitHub App Installation (for granular repo access)
export interface GitHubAppInstallation {
  id: string;
  user_id: string;
  installation_id: number;
  account_login: string;
  account_type: 'User' | 'Organization';
  account_id: number;
  permissions?: Record<string, string>;
  repository_selection?: 'all' | 'selected';
  suspended_at?: string;
  created_at: string;
  updated_at: string;
}

// Session types for express-session
declare module 'express-session' {
  interface SessionData {
    userId?: string;
    githubState?: string;
    gitlabState?: string;
    githubAppState?: string;
    workosSessionId?: string;
    currentOrgId?: string;
  }
}
