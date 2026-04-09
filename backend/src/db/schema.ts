// SQLite Schema (local development)
export const sqliteSchema = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  workos_user_id TEXT UNIQUE,
  github_id TEXT UNIQUE,
  github_access_token TEXT,
  github_username TEXT,
  gitlab_id TEXT UNIQUE,
  gitlab_access_token TEXT,
  gitlab_refresh_token TEXT,
  gitlab_username TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Sessions table (agents)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  agent_type TEXT NOT NULL DEFAULT 'code' CHECK (agent_type IN ('code', 'task')),
  repo_url TEXT,
  repo_name TEXT,
  branch TEXT DEFAULT 'main',
  sandbox_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'failed')),
  agent_provider TEXT NOT NULL DEFAULT 'claude-code' CHECK (agent_provider IN ('claude-code', 'aider', 'opencode')),
  agent_model TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  result TEXT,
  error TEXT,
  model_provider TEXT DEFAULT 'claude-code',
  model_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Messages table (conversation history)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- API Keys for programmatic access
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  permissions TEXT DEFAULT 'full',
  last_used_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Agent configurations (extends sessions)
CREATE TABLE IF NOT EXISTS agent_configs (
  id TEXT PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL REFERENCES sessions(id),
  name TEXT,
  system_prompt TEXT,
  allowed_tools TEXT,
  secrets TEXT,
  e2b_template TEXT,
  api_enabled INTEGER DEFAULT 0,
  webhook_url TEXT,
  chain_to_agent_id TEXT REFERENCES sessions(id),
  chain_condition TEXT DEFAULT 'on_success',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Task queue for async/API processing
CREATE TABLE IF NOT EXISTS task_queue (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES sessions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  prompt TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  priority INTEGER DEFAULT 0,
  source TEXT DEFAULT 'api' CHECK (source IN ('web', 'api', 'chain', 'workflow')),
  api_key_id TEXT REFERENCES api_keys(id),
  result TEXT,
  error TEXT,
  debug_log TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);

-- Prompt templates for task agents
CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES sessions(id),
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  variables TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Workflow steps for task agents
CREATE TABLE IF NOT EXISTS workflow_steps (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES sessions(id),
  step_order INTEGER NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('prompt', 'fetch', 'write', 'webhook', 'chain')),
  config TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Builder conversations (AI assistant for creating agents)
CREATE TABLE IF NOT EXISTS builder_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Builder messages (chat history)
CREATE TABLE IF NOT EXISTS builder_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES builder_conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  tool_calls TEXT,
  tool_results TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Builder memory (long-term user preferences and context)
CREATE TABLE IF NOT EXISTS builder_memory (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  memory_type TEXT NOT NULL CHECK (memory_type IN ('preference', 'fact', 'context')),
  content TEXT NOT NULL,
  importance INTEGER DEFAULT 5,
  created_at TEXT DEFAULT (datetime('now')),
  last_accessed TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- SCHEDULE SYSTEM (Cron-like agent scheduling)
-- ============================================

-- Schedules - cron-like schedules for agents
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  cron_expression TEXT NOT NULL,
  timezone TEXT DEFAULT 'UTC',
  prompt TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT,
  run_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Schedule runs - history of scheduled executions
CREATE TABLE IF NOT EXISTS schedule_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- WORKFLOW SYSTEM (LangGraph-style orchestration)
-- ============================================

-- Workflows - the workflow definition
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  max_retries INTEGER DEFAULT 3,
  timeout_seconds INTEGER DEFAULT 3600,
  canvas_state TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Workflow nodes - individual steps in the workflow
CREATE TABLE IF NOT EXISTS workflow_nodes (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL CHECK (node_type IN ('start', 'end', 'agent', 'condition', 'human_checkpoint', 'parallel_split', 'parallel_merge', 'transform', 'delay')),
  name TEXT NOT NULL,
  description TEXT,
  position_x REAL DEFAULT 0,
  position_y REAL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Workflow edges - connections between nodes
CREATE TABLE IF NOT EXISTS workflow_edges (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  source_node_id TEXT NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  target_node_id TEXT NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  condition_label TEXT,
  edge_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Workflow runs - execution instances
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  input_data TEXT DEFAULT '{}',
  output_data TEXT,
  context TEXT DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  current_node_id TEXT REFERENCES workflow_nodes(id),
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Workflow node runs - individual node execution results
CREATE TABLE IF NOT EXISTS workflow_node_runs (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES workflow_nodes(id),
  input_data TEXT,
  output_data TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'waiting_human')),
  retry_count INTEGER DEFAULT 0,
  error TEXT,
  task_id TEXT REFERENCES tasks(id),
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- WEBHOOK & EVENT SYSTEM
-- ============================================

-- Webhooks - incoming webhook endpoints for triggering agents/workflows
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  secret TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  target_type TEXT NOT NULL CHECK (target_type IN ('agent', 'workflow')),
  target_id TEXT NOT NULL,
  payload_mapping TEXT DEFAULT '{}',
  verify_signature INTEGER DEFAULT 0,
  signature_secret TEXT,
  allowed_ips TEXT,
  is_active INTEGER DEFAULT 1,
  last_triggered_at TEXT,
  trigger_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- GitHub webhooks - special handling for GitHub events
CREATE TABLE IF NOT EXISTS github_webhooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  repo_full_name TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '["push"]',
  filters TEXT DEFAULT '{}',
  target_type TEXT NOT NULL CHECK (target_type IN ('agent', 'workflow')),
  target_id TEXT NOT NULL,
  prompt_template TEXT,
  is_active INTEGER DEFAULT 1,
  webhook_secret TEXT,
  github_hook_id INTEGER,
  last_triggered_at TEXT,
  trigger_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Scheduled tasks (cron)
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  cron_expression TEXT NOT NULL,
  timezone TEXT DEFAULT 'UTC',
  target_type TEXT NOT NULL CHECK (target_type IN ('agent', 'workflow')),
  target_id TEXT NOT NULL,
  input_data TEXT DEFAULT '{}',
  prompt TEXT,
  is_active INTEGER DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT,
  run_count INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Notifications - outbound notifications (Slack, Discord, email, webhooks)
CREATE TABLE IF NOT EXISTS notification_channels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('slack', 'discord', 'email', 'webhook')),
  config TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Notification rules - when to send notifications
CREATE TABLE IF NOT EXISTS notification_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('task_completed', 'task_failed', 'workflow_completed', 'workflow_failed', 'workflow_paused', 'agent_error')),
  filter TEXT,
  message_template TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Event log - audit trail of all events
CREATE TABLE IF NOT EXISTS event_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('webhook', 'github', 'schedule', 'api', 'web', 'system')),
  source_id TEXT,
  target_type TEXT CHECK (target_type IN ('agent', 'workflow')),
  target_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('received', 'processing', 'completed', 'failed')),
  payload TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_task_id ON messages(task_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_configs_session_id ON agent_configs(session_id);
CREATE INDEX IF NOT EXISTS idx_task_queue_agent_id ON task_queue(agent_id);
CREATE INDEX IF NOT EXISTS idx_task_queue_status ON task_queue(status);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_agent_id ON prompt_templates(agent_id);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_agent_id ON workflow_steps(agent_id);
CREATE INDEX IF NOT EXISTS idx_builder_conversations_user_id ON builder_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_builder_messages_conversation_id ON builder_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_builder_memory_user_id ON builder_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_user_id ON workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow_id ON workflow_nodes(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_edges_workflow_id ON workflow_edges(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_edges_source ON workflow_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_workflow_edges_target ON workflow_edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_user_id ON workflow_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_workflow_node_runs_run_id ON workflow_node_runs(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_node_runs_node_id ON workflow_node_runs(node_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_secret ON webhooks(secret);
CREATE INDEX IF NOT EXISTS idx_github_webhooks_user_id ON github_webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_github_webhooks_repo ON github_webhooks(repo_full_name);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user_id ON scheduled_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at);
CREATE INDEX IF NOT EXISTS idx_notification_channels_user_id ON notification_channels(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_rules_channel_id ON notification_rules(channel_id);
CREATE INDEX IF NOT EXISTS idx_event_log_user_id ON event_log(user_id);
CREATE INDEX IF NOT EXISTS idx_event_log_created_at ON event_log(created_at);
`;

// PostgreSQL Schema (production)
export const postgresSchema = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  workos_user_id TEXT UNIQUE,
  github_id TEXT UNIQUE,
  github_access_token TEXT,
  github_username TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Sessions table (agents)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  agent_type TEXT NOT NULL DEFAULT 'code' CHECK (agent_type IN ('code', 'task')),
  repo_url TEXT,
  repo_name TEXT,
  branch TEXT DEFAULT 'main',
  sandbox_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'failed')),
  agent_provider TEXT NOT NULL DEFAULT 'claude-code' CHECK (agent_provider IN ('claude-code', 'aider', 'opencode')),
  agent_model TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  result TEXT,
  error TEXT,
  model_provider TEXT DEFAULT 'claude-code',
  model_name TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Messages table (conversation history)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- API Keys for programmatic access
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  permissions TEXT DEFAULT 'full',
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Agent configurations (extends sessions)
CREATE TABLE IF NOT EXISTS agent_configs (
  id TEXT PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL REFERENCES sessions(id),
  name TEXT,
  system_prompt TEXT,
  allowed_tools TEXT,
  secrets TEXT,
  e2b_template TEXT,
  api_enabled BOOLEAN DEFAULT FALSE,
  webhook_url TEXT,
  chain_to_agent_id TEXT REFERENCES sessions(id),
  chain_condition TEXT DEFAULT 'on_success',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Task queue for async/API processing
CREATE TABLE IF NOT EXISTS task_queue (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES sessions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  prompt TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  priority INTEGER DEFAULT 0,
  source TEXT DEFAULT 'api' CHECK (source IN ('web', 'api', 'chain', 'workflow')),
  api_key_id TEXT REFERENCES api_keys(id),
  result TEXT,
  error TEXT,
  debug_log TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Prompt templates for task agents
CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES sessions(id),
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  variables TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Workflow steps for task agents
CREATE TABLE IF NOT EXISTS workflow_steps (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES sessions(id),
  step_order INTEGER NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('prompt', 'fetch', 'write', 'webhook', 'chain')),
  config TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Builder conversations (AI assistant for creating agents)
CREATE TABLE IF NOT EXISTS builder_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Builder messages (chat history)
CREATE TABLE IF NOT EXISTS builder_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES builder_conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  tool_calls TEXT,
  tool_results TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Builder memory (long-term user preferences and context)
CREATE TABLE IF NOT EXISTS builder_memory (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  memory_type TEXT NOT NULL CHECK (memory_type IN ('preference', 'fact', 'context')),
  content TEXT NOT NULL,
  importance INTEGER DEFAULT 5,
  created_at TIMESTAMP DEFAULT NOW(),
  last_accessed TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- SCHEDULE SYSTEM (Cron-like agent scheduling)
-- ============================================

-- Schedules - cron-like schedules for agents
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  cron_expression TEXT NOT NULL,
  timezone TEXT DEFAULT 'UTC',
  prompt TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  run_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Schedule runs - history of scheduled executions
CREATE TABLE IF NOT EXISTS schedule_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- WORKFLOW SYSTEM (LangGraph-style orchestration)
-- ============================================

-- Workflows - the workflow definition
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  max_retries INTEGER DEFAULT 3,
  timeout_seconds INTEGER DEFAULT 3600,
  canvas_state TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Workflow nodes - individual steps in the workflow
CREATE TABLE IF NOT EXISTS workflow_nodes (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL CHECK (node_type IN ('start', 'end', 'agent', 'condition', 'human_checkpoint', 'parallel_split', 'parallel_merge', 'transform', 'delay')),
  name TEXT NOT NULL,
  description TEXT,
  position_x REAL DEFAULT 0,
  position_y REAL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Workflow edges - connections between nodes
CREATE TABLE IF NOT EXISTS workflow_edges (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  source_node_id TEXT NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  target_node_id TEXT NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  condition_label TEXT,
  edge_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Workflow runs - execution instances
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  input_data TEXT DEFAULT '{}',
  output_data TEXT,
  context TEXT DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  current_node_id TEXT REFERENCES workflow_nodes(id),
  error TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Workflow node runs - individual node execution results
CREATE TABLE IF NOT EXISTS workflow_node_runs (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES workflow_nodes(id),
  input_data TEXT,
  output_data TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'waiting_human')),
  retry_count INTEGER DEFAULT 0,
  error TEXT,
  task_id TEXT REFERENCES tasks(id),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- WEBHOOK & EVENT SYSTEM
-- ============================================

-- Webhooks - incoming webhook endpoints for triggering agents/workflows
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  secret TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  target_type TEXT NOT NULL CHECK (target_type IN ('agent', 'workflow')),
  target_id TEXT NOT NULL,
  payload_mapping TEXT DEFAULT '{}',
  verify_signature BOOLEAN DEFAULT FALSE,
  signature_secret TEXT,
  allowed_ips TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_triggered_at TIMESTAMP,
  trigger_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- GitHub webhooks - special handling for GitHub events
CREATE TABLE IF NOT EXISTS github_webhooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  repo_full_name TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '["push"]',
  filters TEXT DEFAULT '{}',
  target_type TEXT NOT NULL CHECK (target_type IN ('agent', 'workflow')),
  target_id TEXT NOT NULL,
  prompt_template TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  webhook_secret TEXT,
  github_hook_id INTEGER,
  last_triggered_at TIMESTAMP,
  trigger_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Scheduled tasks (cron)
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  cron_expression TEXT NOT NULL,
  timezone TEXT DEFAULT 'UTC',
  target_type TEXT NOT NULL CHECK (target_type IN ('agent', 'workflow')),
  target_id TEXT NOT NULL,
  input_data TEXT DEFAULT '{}',
  prompt TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  run_count INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Notifications - outbound notifications (Slack, Discord, email, webhooks)
CREATE TABLE IF NOT EXISTS notification_channels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('slack', 'discord', 'email', 'webhook')),
  config TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Notification rules - when to send notifications
CREATE TABLE IF NOT EXISTS notification_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('task_completed', 'task_failed', 'workflow_completed', 'workflow_failed', 'workflow_paused', 'agent_error')),
  filter TEXT,
  message_template TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Event log - audit trail of all events
CREATE TABLE IF NOT EXISTS event_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('webhook', 'github', 'schedule', 'api', 'web', 'system')),
  source_id TEXT,
  target_type TEXT CHECK (target_type IN ('agent', 'workflow')),
  target_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('received', 'processing', 'completed', 'failed')),
  payload TEXT,
  result TEXT,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_task_id ON messages(task_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_configs_session_id ON agent_configs(session_id);
CREATE INDEX IF NOT EXISTS idx_task_queue_agent_id ON task_queue(agent_id);
CREATE INDEX IF NOT EXISTS idx_task_queue_status ON task_queue(status);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_agent_id ON prompt_templates(agent_id);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_agent_id ON workflow_steps(agent_id);
CREATE INDEX IF NOT EXISTS idx_builder_conversations_user_id ON builder_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_builder_messages_conversation_id ON builder_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_builder_memory_user_id ON builder_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_user_id ON workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow_id ON workflow_nodes(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_edges_workflow_id ON workflow_edges(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_edges_source ON workflow_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_workflow_edges_target ON workflow_edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_user_id ON workflow_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_workflow_node_runs_run_id ON workflow_node_runs(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_node_runs_node_id ON workflow_node_runs(node_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_secret ON webhooks(secret);
CREATE INDEX IF NOT EXISTS idx_github_webhooks_user_id ON github_webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_github_webhooks_repo ON github_webhooks(repo_full_name);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user_id ON scheduled_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at);
CREATE INDEX IF NOT EXISTS idx_notification_channels_user_id ON notification_channels(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_rules_channel_id ON notification_rules(channel_id);
CREATE INDEX IF NOT EXISTS idx_event_log_user_id ON event_log(user_id);
CREATE INDEX IF NOT EXISTS idx_event_log_created_at ON event_log(created_at);
`;

// Legacy export for backward compatibility
export const schema = sqliteSchema;
