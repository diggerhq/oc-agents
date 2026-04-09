// Postgres-only migration system.
// We keep legacy definitions temporarily (with sqlite/postgres blocks) but only expose
// a single Postgres `up/down` surface to the runner/CLI.

export interface Migration {
  id: number;
  name: string;
  up: string;
  down: string;
}

interface LegacyMigration {
  id: number;
  name: string;
  sqlite: { up: string; down: string };
  postgres: { up: string; down: string };
}

const legacyMigrations: LegacyMigration[] = [
  {
    id: 1,
    name: 'initial_schema',
    sqlite: {
      up: `
        -- Users table
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT,
          workos_user_id TEXT UNIQUE,
          github_id TEXT UNIQUE,
          github_access_token TEXT,
          github_username TEXT,
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

        -- Messages table
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );

        -- API Keys
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

        -- Agent configs
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

        -- Task queue
        CREATE TABLE IF NOT EXISTS task_queue (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES sessions(id),
          user_id TEXT NOT NULL REFERENCES users(id),
          prompt TEXT NOT NULL,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
          priority INTEGER DEFAULT 0,
          source TEXT DEFAULT 'api' CHECK (source IN ('web', 'api', 'chain', 'workflow', 'slack', 'discord', 'teams', 'linear', 'jira', 'github')),
          api_key_id TEXT REFERENCES api_keys(id),
          result TEXT,
          error TEXT,
          debug_log TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          started_at TEXT,
          completed_at TEXT
        );

        -- Prompt templates
        CREATE TABLE IF NOT EXISTS prompt_templates (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES sessions(id),
          name TEXT NOT NULL,
          template TEXT NOT NULL,
          variables TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );

        -- Workflow steps
        CREATE TABLE IF NOT EXISTS workflow_steps (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES sessions(id),
          step_order INTEGER NOT NULL,
          action_type TEXT NOT NULL CHECK (action_type IN ('prompt', 'fetch', 'write', 'webhook', 'chain')),
          config TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );

        -- Builder conversations
        CREATE TABLE IF NOT EXISTS builder_conversations (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          title TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        -- Builder messages
        CREATE TABLE IF NOT EXISTS builder_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES builder_conversations(id),
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          tool_calls TEXT,
          tool_results TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );

        -- Builder memory
        CREATE TABLE IF NOT EXISTS builder_memory (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          memory_type TEXT NOT NULL CHECK (memory_type IN ('preference', 'fact', 'context')),
          content TEXT NOT NULL,
          importance INTEGER DEFAULT 5,
          created_at TEXT DEFAULT (datetime('now')),
          last_accessed TEXT DEFAULT (datetime('now'))
        );

        -- Schedules
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

        -- Schedule runs
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

        -- Workflows
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

        -- Workflow nodes
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

        -- Workflow edges
        CREATE TABLE IF NOT EXISTS workflow_edges (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
          source_node_id TEXT NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
          target_node_id TEXT NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
          condition_label TEXT,
          edge_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );

        -- Workflow runs
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

        -- Workflow node runs
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

        -- Webhooks
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

        -- GitHub webhooks
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

        -- Scheduled tasks
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

        -- Notification channels
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

        -- Notification rules
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

        -- Event log
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

        -- Create indexes
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
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_user_id ON workflow_runs(user_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
        CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks(user_id);
        CREATE INDEX IF NOT EXISTS idx_webhooks_secret ON webhooks(secret);
        CREATE INDEX IF NOT EXISTS idx_github_webhooks_user_id ON github_webhooks(user_id);
        CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user_id ON scheduled_tasks(user_id);
        CREATE INDEX IF NOT EXISTS idx_notification_channels_user_id ON notification_channels(user_id);
        CREATE INDEX IF NOT EXISTS idx_event_log_user_id ON event_log(user_id);
      `,
      down: `
        DROP TABLE IF EXISTS event_log;
        DROP TABLE IF EXISTS notification_rules;
        DROP TABLE IF EXISTS notification_channels;
        DROP TABLE IF EXISTS scheduled_tasks;
        DROP TABLE IF EXISTS github_webhooks;
        DROP TABLE IF EXISTS webhooks;
        DROP TABLE IF EXISTS workflow_node_runs;
        DROP TABLE IF EXISTS workflow_runs;
        DROP TABLE IF EXISTS workflow_edges;
        DROP TABLE IF EXISTS workflow_nodes;
        DROP TABLE IF EXISTS workflows;
        DROP TABLE IF EXISTS schedule_runs;
        DROP TABLE IF EXISTS schedules;
        DROP TABLE IF EXISTS builder_memory;
        DROP TABLE IF EXISTS builder_messages;
        DROP TABLE IF EXISTS builder_conversations;
        DROP TABLE IF EXISTS workflow_steps;
        DROP TABLE IF EXISTS prompt_templates;
        DROP TABLE IF EXISTS task_queue;
        DROP TABLE IF EXISTS agent_configs;
        DROP TABLE IF EXISTS api_keys;
        DROP TABLE IF EXISTS messages;
        DROP TABLE IF EXISTS tasks;
        DROP TABLE IF EXISTS sessions;
        DROP TABLE IF EXISTS users;
      `,
    },
    postgres: {
      up: `
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

        -- Messages table
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );

        -- API Keys
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

        -- Agent configs
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

        -- Task queue
        CREATE TABLE IF NOT EXISTS task_queue (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES sessions(id),
          user_id TEXT NOT NULL REFERENCES users(id),
          prompt TEXT NOT NULL,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
          priority INTEGER DEFAULT 0,
          source TEXT DEFAULT 'api' CHECK (source IN ('web', 'api', 'chain', 'workflow', 'slack', 'discord', 'teams', 'linear', 'jira', 'github')),
          api_key_id TEXT REFERENCES api_keys(id),
          result TEXT,
          error TEXT,
          debug_log TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          started_at TIMESTAMP,
          completed_at TIMESTAMP
        );

        -- Prompt templates
        CREATE TABLE IF NOT EXISTS prompt_templates (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES sessions(id),
          name TEXT NOT NULL,
          template TEXT NOT NULL,
          variables TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        );

        -- Workflow steps
        CREATE TABLE IF NOT EXISTS workflow_steps (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES sessions(id),
          step_order INTEGER NOT NULL,
          action_type TEXT NOT NULL CHECK (action_type IN ('prompt', 'fetch', 'write', 'webhook', 'chain')),
          config TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );

        -- Builder conversations
        CREATE TABLE IF NOT EXISTS builder_conversations (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          title TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );

        -- Builder messages
        CREATE TABLE IF NOT EXISTS builder_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES builder_conversations(id),
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          tool_calls TEXT,
          tool_results TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        );

        -- Builder memory
        CREATE TABLE IF NOT EXISTS builder_memory (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          memory_type TEXT NOT NULL CHECK (memory_type IN ('preference', 'fact', 'context')),
          content TEXT NOT NULL,
          importance INTEGER DEFAULT 5,
          created_at TIMESTAMP DEFAULT NOW(),
          last_accessed TIMESTAMP DEFAULT NOW()
        );

        -- Schedules
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

        -- Schedule runs
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

        -- Workflows
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

        -- Workflow nodes
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

        -- Workflow edges
        CREATE TABLE IF NOT EXISTS workflow_edges (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
          source_node_id TEXT NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
          target_node_id TEXT NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
          condition_label TEXT,
          edge_order INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW()
        );

        -- Workflow runs
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

        -- Workflow node runs
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

        -- Webhooks
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

        -- GitHub webhooks
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

        -- Scheduled tasks
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

        -- Notification channels
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

        -- Notification rules
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

        -- Event log
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

        -- Create indexes
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
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_user_id ON workflow_runs(user_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
        CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks(user_id);
        CREATE INDEX IF NOT EXISTS idx_webhooks_secret ON webhooks(secret);
        CREATE INDEX IF NOT EXISTS idx_github_webhooks_user_id ON github_webhooks(user_id);
        CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user_id ON scheduled_tasks(user_id);
        CREATE INDEX IF NOT EXISTS idx_notification_channels_user_id ON notification_channels(user_id);
        CREATE INDEX IF NOT EXISTS idx_event_log_user_id ON event_log(user_id);
      `,
      down: `
        DROP TABLE IF EXISTS event_log;
        DROP TABLE IF EXISTS notification_rules;
        DROP TABLE IF EXISTS notification_channels;
        DROP TABLE IF EXISTS scheduled_tasks;
        DROP TABLE IF EXISTS github_webhooks;
        DROP TABLE IF EXISTS webhooks;
        DROP TABLE IF EXISTS workflow_node_runs;
        DROP TABLE IF EXISTS workflow_runs;
        DROP TABLE IF EXISTS workflow_edges;
        DROP TABLE IF EXISTS workflow_nodes;
        DROP TABLE IF EXISTS workflows;
        DROP TABLE IF EXISTS schedule_runs;
        DROP TABLE IF EXISTS schedules;
        DROP TABLE IF EXISTS builder_memory;
        DROP TABLE IF EXISTS builder_messages;
        DROP TABLE IF EXISTS builder_conversations;
        DROP TABLE IF EXISTS workflow_steps;
        DROP TABLE IF EXISTS prompt_templates;
        DROP TABLE IF EXISTS task_queue;
        DROP TABLE IF EXISTS agent_configs;
        DROP TABLE IF EXISTS api_keys;
        DROP TABLE IF EXISTS messages;
        DROP TABLE IF EXISTS tasks;
        DROP TABLE IF EXISTS sessions;
        DROP TABLE IF EXISTS users;
      `,
    },
  },
  {
    id: 2,
    name: 'add_integrations_table',
    sqlite: {
      up: `
        CREATE TABLE IF NOT EXISTS integrations (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          platform TEXT NOT NULL CHECK (platform IN ('slack', 'discord', 'teams', 'linear', 'jira')),
          name TEXT NOT NULL,
          config TEXT NOT NULL DEFAULT '{}',
          webhook_secret TEXT NOT NULL UNIQUE,
          is_active INTEGER DEFAULT 1,
          default_agent_id TEXT REFERENCES sessions(id),
          last_used_at TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_integrations_user_id ON integrations(user_id);
        CREATE INDEX IF NOT EXISTS idx_integrations_webhook_secret ON integrations(webhook_secret);
      `,
      down: `
        DROP INDEX IF EXISTS idx_integrations_webhook_secret;
        DROP INDEX IF EXISTS idx_integrations_user_id;
        DROP TABLE IF EXISTS integrations;
      `,
    },
    postgres: {
      up: `
        CREATE TABLE IF NOT EXISTS integrations (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          platform TEXT NOT NULL CHECK (platform IN ('slack', 'discord', 'teams', 'linear', 'jira')),
          name TEXT NOT NULL,
          config TEXT NOT NULL DEFAULT '{}',
          webhook_secret TEXT NOT NULL UNIQUE,
          is_active BOOLEAN DEFAULT TRUE,
          default_agent_id TEXT REFERENCES sessions(id),
          last_used_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_integrations_user_id ON integrations(user_id);
        CREATE INDEX IF NOT EXISTS idx_integrations_webhook_secret ON integrations(webhook_secret);
      `,
      down: `
        DROP INDEX IF EXISTS idx_integrations_webhook_secret;
        DROP INDEX IF EXISTS idx_integrations_user_id;
        DROP TABLE IF EXISTS integrations;
      `,
    },
  },
  {
    id: 3,
    name: 'update_task_queue_source_constraint',
    sqlite: {
      up: `
        -- SQLite doesn't support ALTER CONSTRAINT, so we need to recreate the table
        -- First, create a new table with the updated constraint
        CREATE TABLE IF NOT EXISTS task_queue_new (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES sessions(id),
          user_id TEXT NOT NULL REFERENCES users(id),
          prompt TEXT NOT NULL,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
          priority INTEGER DEFAULT 0,
          source TEXT DEFAULT 'api' CHECK (source IN ('web', 'api', 'chain', 'workflow', 'slack', 'discord', 'teams', 'linear', 'jira', 'github')),
          api_key_id TEXT REFERENCES api_keys(id),
          result TEXT,
          error TEXT,
          debug_log TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          started_at TEXT,
          completed_at TEXT
        );
        
        -- Copy existing data
        INSERT INTO task_queue_new SELECT * FROM task_queue;
        
        -- Drop the old table
        DROP TABLE task_queue;
        
        -- Rename new table to original name
        ALTER TABLE task_queue_new RENAME TO task_queue;
        
        -- Recreate indexes
        CREATE INDEX IF NOT EXISTS idx_task_queue_agent_id ON task_queue(agent_id);
        CREATE INDEX IF NOT EXISTS idx_task_queue_status ON task_queue(status);
      `,
      down: `
        -- Recreate with old constraint (without new sources)
        CREATE TABLE IF NOT EXISTS task_queue_old (
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
        INSERT INTO task_queue_old SELECT * FROM task_queue WHERE source IN ('web', 'api', 'chain', 'workflow');
        DROP TABLE task_queue;
        ALTER TABLE task_queue_old RENAME TO task_queue;
        CREATE INDEX IF NOT EXISTS idx_task_queue_agent_id ON task_queue(agent_id);
        CREATE INDEX IF NOT EXISTS idx_task_queue_status ON task_queue(status);
      `,
    },
    postgres: {
      up: `
        -- PostgreSQL can modify constraints more easily
        -- Drop the old constraint
        ALTER TABLE task_queue DROP CONSTRAINT IF EXISTS task_queue_source_check;
        
        -- Add new constraint with all sources
        ALTER TABLE task_queue ADD CONSTRAINT task_queue_source_check 
          CHECK (source IN ('web', 'api', 'chain', 'workflow', 'slack', 'discord', 'teams', 'linear', 'jira', 'github'));
      `,
      down: `
        ALTER TABLE task_queue DROP CONSTRAINT IF EXISTS task_queue_source_check;
        ALTER TABLE task_queue ADD CONSTRAINT task_queue_source_check 
          CHECK (source IN ('web', 'api', 'chain', 'workflow'));
      `,
    },
  },
  {
    id: 4,
    name: 'add_file_system',
    sqlite: {
      up: `
        -- User storage buckets
        CREATE TABLE IF NOT EXISTS buckets (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          name TEXT NOT NULL,
          description TEXT,
          storage_used INTEGER DEFAULT 0,
          storage_limit INTEGER DEFAULT 1073741824,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          UNIQUE(user_id, name)
        );

        -- Files and folders
        CREATE TABLE IF NOT EXISTS files (
          id TEXT PRIMARY KEY,
          bucket_id TEXT NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id),
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          parent_id TEXT REFERENCES files(id) ON DELETE CASCADE,
          is_folder INTEGER DEFAULT 0,
          mime_type TEXT,
          size INTEGER DEFAULT 0,
          content BLOB,
          storage_key TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        -- Indexes for efficient queries
        CREATE INDEX IF NOT EXISTS idx_files_bucket_id ON files(bucket_id);
        CREATE INDEX IF NOT EXISTS idx_files_parent_id ON files(parent_id);
        CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
        CREATE INDEX IF NOT EXISTS idx_buckets_user_id ON buckets(user_id);

        -- Agent-bucket associations
        CREATE TABLE IF NOT EXISTS agent_buckets (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          bucket_id TEXT NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
          mount_path TEXT DEFAULT '/workspace/files',
          read_only INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(session_id, bucket_id)
        );
      `,
      down: `
        DROP TABLE IF EXISTS agent_buckets;
        DROP TABLE IF EXISTS files;
        DROP TABLE IF EXISTS buckets;
      `,
    },
    postgres: {
      up: `
        -- User storage buckets
        CREATE TABLE IF NOT EXISTS buckets (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          name TEXT NOT NULL,
          description TEXT,
          storage_used BIGINT DEFAULT 0,
          storage_limit BIGINT DEFAULT 1073741824,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(user_id, name)
        );

        -- Files and folders
        CREATE TABLE IF NOT EXISTS files (
          id TEXT PRIMARY KEY,
          bucket_id TEXT NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id),
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          parent_id TEXT REFERENCES files(id) ON DELETE CASCADE,
          is_folder BOOLEAN DEFAULT FALSE,
          mime_type TEXT,
          size BIGINT DEFAULT 0,
          content BYTEA,
          storage_key TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );

        -- Indexes for efficient queries
        CREATE INDEX IF NOT EXISTS idx_files_bucket_id ON files(bucket_id);
        CREATE INDEX IF NOT EXISTS idx_files_parent_id ON files(parent_id);
        CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
        CREATE INDEX IF NOT EXISTS idx_buckets_user_id ON buckets(user_id);

        -- Agent-bucket associations
        CREATE TABLE IF NOT EXISTS agent_buckets (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          bucket_id TEXT NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
          mount_path TEXT DEFAULT '/workspace/files',
          read_only BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(session_id, bucket_id)
        );
      `,
      down: `
        DROP TABLE IF EXISTS agent_buckets;
        DROP TABLE IF EXISTS files;
        DROP TABLE IF EXISTS buckets;
      `,
    },
  },
  {
    id: 5,
    name: 'add_user_storage_configs',
    sqlite: {
      up: `
        -- User storage configurations (bring your own bucket)
        CREATE TABLE IF NOT EXISTS user_storage_configs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
          provider TEXT NOT NULL CHECK (provider IN ('s3', 'r2', 's3-compatible')),
          bucket_name TEXT NOT NULL,
          region TEXT,
          endpoint TEXT,
          access_key_id TEXT NOT NULL,
          secret_access_key TEXT NOT NULL,
          is_active INTEGER DEFAULT 1,
          last_tested_at TEXT,
          test_status TEXT CHECK (test_status IN ('success', 'failed', 'untested')),
          test_error TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_user_storage_configs_user_id ON user_storage_configs(user_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_user_storage_configs_user_id;
        DROP TABLE IF EXISTS user_storage_configs;
      `,
    },
    postgres: {
      up: `
        -- User storage configurations (bring your own bucket)
        CREATE TABLE IF NOT EXISTS user_storage_configs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
          provider TEXT NOT NULL CHECK (provider IN ('s3', 'r2', 's3-compatible')),
          bucket_name TEXT NOT NULL,
          region TEXT,
          endpoint TEXT,
          access_key_id TEXT NOT NULL,
          secret_access_key TEXT NOT NULL,
          is_active BOOLEAN DEFAULT TRUE,
          last_tested_at TIMESTAMP,
          test_status TEXT CHECK (test_status IN ('success', 'failed', 'untested')),
          test_error TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_user_storage_configs_user_id ON user_storage_configs(user_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_user_storage_configs_user_id;
        DROP TABLE IF EXISTS user_storage_configs;
      `,
    },
  },
  {
    id: 6,
    name: 'add_workflow_buckets',
    sqlite: {
      up: `
        -- Workflow buckets - connect file buckets to workflows
        CREATE TABLE IF NOT EXISTS workflow_buckets (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
          bucket_id TEXT NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
          mount_path TEXT DEFAULT '/home/user/workspace/files',
          read_only INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_workflow_buckets_workflow_id ON workflow_buckets(workflow_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_buckets_unique ON workflow_buckets(workflow_id, bucket_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_workflow_buckets_unique;
        DROP INDEX IF EXISTS idx_workflow_buckets_workflow_id;
        DROP TABLE IF EXISTS workflow_buckets;
      `,
    },
    postgres: {
      up: `
        -- Workflow buckets - connect file buckets to workflows
        CREATE TABLE IF NOT EXISTS workflow_buckets (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
          bucket_id TEXT NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
          mount_path TEXT DEFAULT '/home/user/workspace/files',
          read_only BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_workflow_buckets_workflow_id ON workflow_buckets(workflow_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_buckets_unique ON workflow_buckets(workflow_id, bucket_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_workflow_buckets_unique;
        DROP INDEX IF EXISTS idx_workflow_buckets_workflow_id;
        DROP TABLE IF EXISTS workflow_buckets;
      `,
    },
  },
  {
    id: 7,
    name: 'add_internal_conversations_and_embed_fields',
    sqlite: {
      up: `
        -- Internal conversations (for authenticated user chat with agents)
        CREATE TABLE IF NOT EXISTS internal_conversations (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          UNIQUE(session_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_internal_conversations_session_id ON internal_conversations(session_id);
        CREATE INDEX IF NOT EXISTS idx_internal_conversations_user_id ON internal_conversations(user_id);

        -- Embed conversations for public chat widget
        CREATE TABLE IF NOT EXISTS embed_conversations (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          session_token TEXT UNIQUE NOT NULL,
          user_context TEXT,
          user_id TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_embed_conversations_agent_id ON embed_conversations(agent_id);
        CREATE INDEX IF NOT EXISTS idx_embed_conversations_session_token ON embed_conversations(session_token);

        -- Embed messages for chat history
        CREATE TABLE IF NOT EXISTS embed_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_embed_messages_conversation_id ON embed_messages(conversation_id);

        -- Add embed fields to agent_configs
        ALTER TABLE agent_configs ADD COLUMN embed_greeting TEXT;
        ALTER TABLE agent_configs ADD COLUMN embed_user_fields TEXT;
        ALTER TABLE agent_configs ADD COLUMN embed_theme TEXT;
        ALTER TABLE agent_configs ADD COLUMN embed_allowed_domains TEXT;
        ALTER TABLE agent_configs ADD COLUMN embed_auth_webhook TEXT;
      `,
      down: `
        DROP INDEX IF EXISTS idx_embed_messages_conversation_id;
        DROP TABLE IF EXISTS embed_messages;
        DROP INDEX IF EXISTS idx_embed_conversations_session_token;
        DROP INDEX IF EXISTS idx_embed_conversations_agent_id;
        DROP TABLE IF EXISTS embed_conversations;
        DROP INDEX IF EXISTS idx_internal_conversations_user_id;
        DROP INDEX IF EXISTS idx_internal_conversations_session_id;
        DROP TABLE IF EXISTS internal_conversations;
      `,
    },
    postgres: {
      up: `
        -- Internal conversations (for authenticated user chat with agents)
        CREATE TABLE IF NOT EXISTS internal_conversations (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(session_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_internal_conversations_session_id ON internal_conversations(session_id);
        CREATE INDEX IF NOT EXISTS idx_internal_conversations_user_id ON internal_conversations(user_id);

        -- Embed conversations for public chat widget
        CREATE TABLE IF NOT EXISTS embed_conversations (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          session_token TEXT UNIQUE NOT NULL,
          user_context TEXT,
          user_id TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_embed_conversations_agent_id ON embed_conversations(agent_id);
        CREATE INDEX IF NOT EXISTS idx_embed_conversations_session_token ON embed_conversations(session_token);

        -- Embed messages for chat history
        CREATE TABLE IF NOT EXISTS embed_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_embed_messages_conversation_id ON embed_messages(conversation_id);

        -- Add embed fields to agent_configs
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS embed_greeting TEXT;
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS embed_user_fields TEXT;
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS embed_theme TEXT;
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS embed_allowed_domains TEXT;
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS embed_auth_webhook TEXT;
      `,
      down: `
        DROP INDEX IF EXISTS idx_embed_messages_conversation_id;
        DROP TABLE IF EXISTS embed_messages;
        DROP INDEX IF EXISTS idx_embed_conversations_session_token;
        DROP INDEX IF EXISTS idx_embed_conversations_agent_id;
        DROP TABLE IF EXISTS embed_conversations;
        DROP INDEX IF EXISTS idx_internal_conversations_user_id;
        DROP INDEX IF EXISTS idx_internal_conversations_session_id;
        DROP TABLE IF EXISTS internal_conversations;
      `,
    },
  },
  {
    id: 8,
    name: 'add_knowledge_bases',
    sqlite: {
      up: `
        -- Knowledge bases (vector DB collections)
        CREATE TABLE IF NOT EXISTS knowledge_bases (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          source_bucket_id TEXT REFERENCES buckets(id),
          source_folder_path TEXT DEFAULT '/',
          collection_name TEXT NOT NULL UNIQUE,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'indexing', 'ready', 'failed', 'deleting')),
          indexed_files INTEGER DEFAULT 0,
          indexed_chunks INTEGER DEFAULT 0,
          last_indexed_at TEXT,
          error TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_bases_user_id ON knowledge_bases(user_id);
        CREATE INDEX IF NOT EXISTS idx_knowledge_bases_collection_name ON knowledge_bases(collection_name);

        -- Agent-knowledge base associations
        CREATE TABLE IF NOT EXISTS agent_knowledge_bases (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(session_id, knowledge_base_id)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_knowledge_bases_session_id ON agent_knowledge_bases(session_id);
        CREATE INDEX IF NOT EXISTS idx_agent_knowledge_bases_kb_id ON agent_knowledge_bases(knowledge_base_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_agent_knowledge_bases_kb_id;
        DROP INDEX IF EXISTS idx_agent_knowledge_bases_session_id;
        DROP TABLE IF EXISTS agent_knowledge_bases;
        DROP INDEX IF EXISTS idx_knowledge_bases_collection_name;
        DROP INDEX IF EXISTS idx_knowledge_bases_user_id;
        DROP TABLE IF EXISTS knowledge_bases;
      `,
    },
    postgres: {
      up: `
        -- Knowledge bases (vector DB collections)
        CREATE TABLE IF NOT EXISTS knowledge_bases (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          source_bucket_id TEXT REFERENCES buckets(id),
          source_folder_path TEXT DEFAULT '/',
          collection_name TEXT NOT NULL UNIQUE,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'indexing', 'ready', 'failed', 'deleting')),
          indexed_files INTEGER DEFAULT 0,
          indexed_chunks INTEGER DEFAULT 0,
          last_indexed_at TIMESTAMP,
          error TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_bases_user_id ON knowledge_bases(user_id);
        CREATE INDEX IF NOT EXISTS idx_knowledge_bases_collection_name ON knowledge_bases(collection_name);

        -- Agent-knowledge base associations
        CREATE TABLE IF NOT EXISTS agent_knowledge_bases (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(session_id, knowledge_base_id)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_knowledge_bases_session_id ON agent_knowledge_bases(session_id);
        CREATE INDEX IF NOT EXISTS idx_agent_knowledge_bases_kb_id ON agent_knowledge_bases(knowledge_base_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_agent_knowledge_bases_kb_id;
        DROP INDEX IF EXISTS idx_agent_knowledge_bases_session_id;
        DROP TABLE IF EXISTS agent_knowledge_bases;
        DROP INDEX IF EXISTS idx_knowledge_bases_collection_name;
        DROP INDEX IF EXISTS idx_knowledge_bases_user_id;
        DROP TABLE IF EXISTS knowledge_bases;
      `,
    },
  },
  {
    id: 9,
    name: 'add_api_integration_fields',
    sqlite: {
      up: `SELECT 1; -- Placeholder for API integration fields`,
      down: `SELECT 1; -- No-op`,
    },
    postgres: {
      up: `SELECT 1; -- Placeholder for API integration fields`,
      down: `SELECT 1; -- No-op`,
    },
  },
  {
    id: 10,
    name: 'mcp_servers_and_skills',
    sqlite: {
      up: `
        -- Add MCP servers and skills columns to agent_configs
        ALTER TABLE agent_configs ADD COLUMN mcp_servers TEXT;
        ALTER TABLE agent_configs ADD COLUMN skills TEXT;
        
        -- Create skills table for custom skill definitions
        CREATE TABLE IF NOT EXISTS skills (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id),
          name TEXT NOT NULL,
          description TEXT,
          icon TEXT DEFAULT 'puzzle',
          category TEXT DEFAULT 'custom',
          mcp_config TEXT NOT NULL,
          required_env TEXT,
          is_public INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_skills_user_id ON skills(user_id);
        CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
        
        -- Track MCP server connection status per agent session
        CREATE TABLE IF NOT EXISTS mcp_connections (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          server_id TEXT NOT NULL,
          server_name TEXT NOT NULL,
          status TEXT DEFAULT 'disconnected' CHECK (status IN ('connecting', 'connected', 'disconnected', 'error')),
          tools_discovered TEXT,
          error TEXT,
          connected_at TEXT,
          last_used_at TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_connections_session_id ON mcp_connections(session_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_connections_unique ON mcp_connections(session_id, server_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_mcp_connections_unique;
        DROP INDEX IF EXISTS idx_mcp_connections_session_id;
        DROP TABLE IF EXISTS mcp_connections;
        DROP INDEX IF EXISTS idx_skills_category;
        DROP INDEX IF EXISTS idx_skills_user_id;
        DROP TABLE IF EXISTS skills;
      `,
    },
    postgres: {
      up: `
        -- Add MCP servers and skills columns to agent_configs
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS mcp_servers TEXT;
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS skills TEXT;
        
        -- Create skills table for custom skill definitions
        CREATE TABLE IF NOT EXISTS skills (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id),
          name TEXT NOT NULL,
          description TEXT,
          icon TEXT DEFAULT 'puzzle',
          category TEXT DEFAULT 'custom',
          mcp_config TEXT NOT NULL,
          required_env TEXT,
          is_public BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_skills_user_id ON skills(user_id);
        CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
        
        -- Track MCP server connection status per agent session
        CREATE TABLE IF NOT EXISTS mcp_connections (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          server_id TEXT NOT NULL,
          server_name TEXT NOT NULL,
          status TEXT DEFAULT 'disconnected' CHECK (status IN ('connecting', 'connected', 'disconnected', 'error')),
          tools_discovered TEXT,
          error TEXT,
          connected_at TIMESTAMP,
          last_used_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_connections_session_id ON mcp_connections(session_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_connections_unique ON mcp_connections(session_id, server_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_mcp_connections_unique;
        DROP INDEX IF EXISTS idx_mcp_connections_session_id;
        DROP TABLE IF EXISTS mcp_connections;
        DROP INDEX IF EXISTS idx_skills_category;
        DROP INDEX IF EXISTS idx_skills_user_id;
        DROP TABLE IF EXISTS skills;
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS mcp_servers;
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS skills;
      `,
    },
  },
  {
    id: 11,
    name: 'portal_threads',
    sqlite: {
      up: `
        -- Portal sessions (visitor sessions for public agent access)
        CREATE TABLE IF NOT EXISTS portal_sessions (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          visitor_id TEXT,
          user_context TEXT,
          active_skills TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_portal_sessions_agent_id ON portal_sessions(agent_id);
        CREATE INDEX IF NOT EXISTS idx_portal_sessions_visitor_id ON portal_sessions(visitor_id);
        
        -- Portal threads (conversation threads within a session)
        CREATE TABLE IF NOT EXISTS portal_threads (
          id TEXT PRIMARY KEY,
          portal_session_id TEXT NOT NULL REFERENCES portal_sessions(id) ON DELETE CASCADE,
          title TEXT DEFAULT 'New Thread',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_portal_threads_session_id ON portal_threads(portal_session_id);
        
        -- Portal messages (messages within threads)
        CREATE TABLE IF NOT EXISTS portal_messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES portal_threads(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_portal_messages_thread_id ON portal_messages(thread_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_portal_messages_thread_id;
        DROP TABLE IF EXISTS portal_messages;
        DROP INDEX IF EXISTS idx_portal_threads_session_id;
        DROP TABLE IF EXISTS portal_threads;
        DROP INDEX IF EXISTS idx_portal_sessions_visitor_id;
        DROP INDEX IF EXISTS idx_portal_sessions_agent_id;
        DROP TABLE IF EXISTS portal_sessions;
      `,
    },
    postgres: {
      up: `
        -- Portal sessions (visitor sessions for public agent access)
        CREATE TABLE IF NOT EXISTS portal_sessions (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          visitor_id TEXT,
          user_context TEXT,
          active_skills TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_portal_sessions_agent_id ON portal_sessions(agent_id);
        CREATE INDEX IF NOT EXISTS idx_portal_sessions_visitor_id ON portal_sessions(visitor_id);
        
        -- Portal threads (conversation threads within a session)
        CREATE TABLE IF NOT EXISTS portal_threads (
          id TEXT PRIMARY KEY,
          portal_session_id TEXT NOT NULL REFERENCES portal_sessions(id) ON DELETE CASCADE,
          title TEXT DEFAULT 'New Thread',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_portal_threads_session_id ON portal_threads(portal_session_id);
        
        -- Portal messages (messages within threads)
        CREATE TABLE IF NOT EXISTS portal_messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES portal_threads(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_portal_messages_thread_id ON portal_messages(thread_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_portal_messages_thread_id;
        DROP TABLE IF EXISTS portal_messages;
        DROP INDEX IF EXISTS idx_portal_threads_session_id;
        DROP TABLE IF EXISTS portal_threads;
        DROP INDEX IF EXISTS idx_portal_sessions_visitor_id;
        DROP INDEX IF EXISTS idx_portal_sessions_agent_id;
        DROP TABLE IF EXISTS portal_sessions;
      `,
    },
  },
  {
    id: 12,
    name: 'embed_user_threads',
    sqlite: {
      up: `
        -- Embed users (identified users for persistent history)
        CREATE TABLE IF NOT EXISTS embed_users (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          user_identifier TEXT NOT NULL,
          user_context TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(agent_id, user_identifier)
        );
        CREATE INDEX IF NOT EXISTS idx_embed_users_agent_id ON embed_users(agent_id);
        CREATE INDEX IF NOT EXISTS idx_embed_users_identifier ON embed_users(agent_id, user_identifier);
        
        -- Embed threads (conversation threads per user)
        CREATE TABLE IF NOT EXISTS embed_threads (
          id TEXT PRIMARY KEY,
          embed_user_id TEXT NOT NULL REFERENCES embed_users(id) ON DELETE CASCADE,
          agent_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          title TEXT DEFAULT 'New conversation',
          active_skills TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_embed_threads_user_id ON embed_threads(embed_user_id);
        CREATE INDEX IF NOT EXISTS idx_embed_threads_agent_id ON embed_threads(agent_id);
        
        -- Embed thread messages
        CREATE TABLE IF NOT EXISTS embed_thread_messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES embed_threads(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_embed_thread_messages_thread_id ON embed_thread_messages(thread_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_embed_thread_messages_thread_id;
        DROP TABLE IF EXISTS embed_thread_messages;
        DROP INDEX IF EXISTS idx_embed_threads_agent_id;
        DROP INDEX IF EXISTS idx_embed_threads_user_id;
        DROP TABLE IF EXISTS embed_threads;
        DROP INDEX IF EXISTS idx_embed_users_identifier;
        DROP INDEX IF EXISTS idx_embed_users_agent_id;
        DROP TABLE IF EXISTS embed_users;
      `,
    },
    postgres: {
      up: `
        -- Embed users (identified users for persistent history)
        CREATE TABLE IF NOT EXISTS embed_users (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          user_identifier TEXT NOT NULL,
          user_context TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(agent_id, user_identifier)
        );
        CREATE INDEX IF NOT EXISTS idx_embed_users_agent_id ON embed_users(agent_id);
        CREATE INDEX IF NOT EXISTS idx_embed_users_identifier ON embed_users(agent_id, user_identifier);
        
        -- Embed threads (conversation threads per user)
        CREATE TABLE IF NOT EXISTS embed_threads (
          id TEXT PRIMARY KEY,
          embed_user_id TEXT NOT NULL REFERENCES embed_users(id) ON DELETE CASCADE,
          agent_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          title TEXT DEFAULT 'New conversation',
          active_skills TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_embed_threads_user_id ON embed_threads(embed_user_id);
        CREATE INDEX IF NOT EXISTS idx_embed_threads_agent_id ON embed_threads(agent_id);
        
        -- Embed thread messages
        CREATE TABLE IF NOT EXISTS embed_thread_messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES embed_threads(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_embed_thread_messages_thread_id ON embed_thread_messages(thread_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_embed_thread_messages_thread_id;
        DROP TABLE IF EXISTS embed_thread_messages;
        DROP INDEX IF EXISTS idx_embed_threads_agent_id;
        DROP INDEX IF EXISTS idx_embed_threads_user_id;
        DROP TABLE IF EXISTS embed_threads;
        DROP INDEX IF EXISTS idx_embed_users_identifier;
        DROP INDEX IF EXISTS idx_embed_users_agent_id;
        DROP TABLE IF EXISTS embed_users;
      `,
    },
  },
  {
    id: 13,
    name: 'portal_jwt_secret',
    sqlite: {
      up: `
        ALTER TABLE agent_configs ADD COLUMN portal_jwt_secret TEXT;
      `,
      down: `
        -- SQLite doesn't support DROP COLUMN easily
      `,
    },
    postgres: {
      up: `
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS portal_jwt_secret TEXT;
      `,
      down: `
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS portal_jwt_secret;
      `,
    },
  },
  {
    id: 14,
    name: 'portal_enabled',
    sqlite: {
      up: `
        ALTER TABLE agent_configs ADD COLUMN portal_enabled INTEGER DEFAULT 0;
      `,
      down: `
        -- SQLite doesn't support DROP COLUMN easily
      `,
    },
    postgres: {
      up: `
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN DEFAULT FALSE;
      `,
      down: `
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS portal_enabled;
      `,
    },
  },
  {
    id: 15,
    name: 'sandbox_tracking',
    sqlite: {
      up: `
        -- Track running E2B sandboxes for reconnection
        CREATE TABLE IF NOT EXISTS sandboxes (
          id TEXT PRIMARY KEY,
          session_key TEXT UNIQUE NOT NULL,
          e2b_sandbox_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          created_at TEXT DEFAULT (datetime('now')),
          last_used_at TEXT DEFAULT (datetime('now')),
          expires_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sandboxes_session_key ON sandboxes(session_key);
        CREATE INDEX IF NOT EXISTS idx_sandboxes_status ON sandboxes(status);
      `,
      down: `
        DROP TABLE IF EXISTS sandboxes;
      `,
    },
    postgres: {
      up: `
        -- Track running E2B sandboxes for reconnection
        CREATE TABLE IF NOT EXISTS sandboxes (
          id TEXT PRIMARY KEY,
          session_key TEXT UNIQUE NOT NULL,
          e2b_sandbox_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          last_used_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP WITH TIME ZONE
        );
        CREATE INDEX IF NOT EXISTS idx_sandboxes_session_key ON sandboxes(session_key);
        CREATE INDEX IF NOT EXISTS idx_sandboxes_status ON sandboxes(status);
      `,
      down: `
        DROP TABLE IF EXISTS sandboxes;
      `,
    },
  },
  {
    id: 16,
    name: 'agent_analytics',
    sqlite: {
      up: `
        -- Analytics events for agent observability
        CREATE TABLE IF NOT EXISTS agent_analytics (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'api',
          user_id TEXT,
          session_id TEXT,
          thread_id TEXT,
          
          -- Metrics
          tokens_input INTEGER DEFAULT 0,
          tokens_output INTEGER DEFAULT 0,
          latency_ms INTEGER DEFAULT 0,
          success INTEGER DEFAULT 1,
          
          -- Context
          metadata TEXT,
          error_message TEXT,
          
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_analytics_agent_id ON agent_analytics(agent_id);
        CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON agent_analytics(event_type);
        CREATE INDEX IF NOT EXISTS idx_analytics_source ON agent_analytics(source);
        CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON agent_analytics(created_at);
        CREATE INDEX IF NOT EXISTS idx_analytics_agent_created ON agent_analytics(agent_id, created_at);
      `,
      down: `
        DROP TABLE IF EXISTS agent_analytics;
      `,
    },
    postgres: {
      up: `
        -- Analytics events for agent observability
        CREATE TABLE IF NOT EXISTS agent_analytics (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'api',
          user_id TEXT,
          session_id TEXT,
          thread_id TEXT,
          
          -- Metrics
          tokens_input INTEGER DEFAULT 0,
          tokens_output INTEGER DEFAULT 0,
          latency_ms INTEGER DEFAULT 0,
          success BOOLEAN DEFAULT true,
          
          -- Context
          metadata JSONB,
          error_message TEXT,
          
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_analytics_agent_id ON agent_analytics(agent_id);
        CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON agent_analytics(event_type);
        CREATE INDEX IF NOT EXISTS idx_analytics_source ON agent_analytics(source);
        CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON agent_analytics(created_at);
        CREATE INDEX IF NOT EXISTS idx_analytics_agent_created ON agent_analytics(agent_id, created_at);
      `,
      down: `
        DROP TABLE IF EXISTS agent_analytics;
      `,
    },
  },
  {
    id: 17,
    name: 'bucket_repos',
    sqlite: {
      up: `
        -- Bucket repos - store git repository source info for repo-backed buckets
        -- This allows any bucket to be synced from a git repository
        CREATE TABLE IF NOT EXISTS bucket_repos (
          id TEXT PRIMARY KEY,
          bucket_id TEXT NOT NULL UNIQUE REFERENCES buckets(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          repo_url TEXT NOT NULL,
          repo_branch TEXT DEFAULT 'main',
          repo_token TEXT,
          last_synced_at TEXT,
          sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending', 'syncing', 'synced', 'failed')),
          sync_error TEXT,
          file_count INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_bucket_repos_bucket_id ON bucket_repos(bucket_id);
        CREATE INDEX IF NOT EXISTS idx_bucket_repos_user_id ON bucket_repos(user_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_bucket_repos_user_id;
        DROP INDEX IF EXISTS idx_bucket_repos_bucket_id;
        DROP TABLE IF EXISTS bucket_repos;
      `,
    },
    postgres: {
      up: `
        -- Bucket repos - store git repository source info for repo-backed buckets
        -- This allows any bucket to be synced from a git repository
        CREATE TABLE IF NOT EXISTS bucket_repos (
          id TEXT PRIMARY KEY,
          bucket_id TEXT NOT NULL UNIQUE REFERENCES buckets(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          repo_url TEXT NOT NULL,
          repo_branch TEXT DEFAULT 'main',
          repo_token TEXT,
          last_synced_at TIMESTAMP,
          sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending', 'syncing', 'synced', 'failed')),
          sync_error TEXT,
          file_count INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_bucket_repos_bucket_id ON bucket_repos(bucket_id);
        CREATE INDEX IF NOT EXISTS idx_bucket_repos_user_id ON bucket_repos(user_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_bucket_repos_user_id;
        DROP INDEX IF EXISTS idx_bucket_repos_bucket_id;
        DROP TABLE IF EXISTS bucket_repos;
      `,
    },
  },
  {
    id: 18,
    name: 'bucket_repos_sync_progress',
    sqlite: {
      up: `
        -- Add sync_progress column to bucket_repos for progress tracking
        ALTER TABLE bucket_repos ADD COLUMN sync_progress TEXT;
      `,
      down: `
        -- SQLite doesn't support DROP COLUMN easily, so we leave it
      `,
    },
    postgres: {
      up: `
        -- Add sync_progress column to bucket_repos for progress tracking
        ALTER TABLE bucket_repos ADD COLUMN IF NOT EXISTS sync_progress TEXT;
      `,
      down: `
        ALTER TABLE bucket_repos DROP COLUMN IF EXISTS sync_progress;
      `,
    },
  },
  {
    id: 19,
    name: 'portal_customization',
    sqlite: {
      up: `
        -- Add portal logo URL for portal customization
        ALTER TABLE agent_configs ADD COLUMN portal_logo_url TEXT;
      `,
      down: `
        -- SQLite doesn't support DROP COLUMN easily, so we leave it
      `,
    },
    postgres: {
      up: `
        -- Add portal logo URL for portal customization
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS portal_logo_url TEXT;
      `,
      down: `
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS portal_logo_url;
      `,
    },
  },
  {
    id: 20,
    name: 'portal_custom_name',
    sqlite: {
      up: `
        -- Add custom portal name that overrides agent name
        ALTER TABLE agent_configs ADD COLUMN portal_name TEXT;
      `,
      down: `
        -- SQLite doesn't support DROP COLUMN easily, so we leave it
      `,
    },
    postgres: {
      up: `
        -- Add custom portal name that overrides agent name
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS portal_name TEXT;
      `,
      down: `
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS portal_name;
      `,
    },
  },
  {
    id: 21,
    name: 'agent_extended_thinking',
    sqlite: {
      up: `SELECT 1; -- SQLite no longer supported`,
      down: `SELECT 1;`,
    },
    postgres: {
      up: `
        -- Add extended thinking support for agents
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS enable_extended_thinking BOOLEAN DEFAULT FALSE;
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS thinking_budget_tokens INTEGER DEFAULT 10000;
      `,
      down: `
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS enable_extended_thinking;
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS thinking_budget_tokens;
      `,
    },
  },
  {
    id: 22,
    name: 'bucket_repo_last_sync_commit',
    sqlite: {
      up: `SELECT 1; -- SQLite no longer supported`,
      down: `SELECT 1;`,
    },
    postgres: {
      up: `
        -- Track the last synced commit SHA for smart sync detection
        ALTER TABLE bucket_repos ADD COLUMN IF NOT EXISTS last_sync_commit TEXT;
      `,
      down: `
        ALTER TABLE bucket_repos DROP COLUMN IF EXISTS last_sync_commit;
      `,
    },
  },
  {
    id: 23,
    name: 'file_line_count_and_index',
    sqlite: {
      up: `SELECT 1; -- SQLite no longer supported`,
      down: `SELECT 1;`,
    },
    postgres: {
      up: `
        -- Add line_count and line_index_key to files for code metrics and streaming editor mode
        ALTER TABLE files ADD COLUMN IF NOT EXISTS line_count INTEGER;
        ALTER TABLE files ADD COLUMN IF NOT EXISTS line_index_key TEXT;
        CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_files_user_id;
        ALTER TABLE files DROP COLUMN IF EXISTS line_index_key;
        ALTER TABLE files DROP COLUMN IF EXISTS line_count;
      `,
    },
  },
  {
    id: 24,
    name: 'organizations_and_rbac',
    sqlite: {
      up: `SELECT 1; -- SQLite no longer supported`,
      down: `SELECT 1;`,
    },
    postgres: {
      up: `
        -- Organizations table
        CREATE TABLE IF NOT EXISTS organizations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT UNIQUE NOT NULL,
          is_personal BOOLEAN DEFAULT FALSE,
          owner_id TEXT NOT NULL REFERENCES users(id),
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
        CREATE INDEX IF NOT EXISTS idx_organizations_owner_id ON organizations(owner_id);

        -- Organization members table
        CREATE TABLE IF NOT EXISTS organization_members (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(organization_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON organization_members(organization_id);
        CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON organization_members(user_id);

        -- Organization invitations table
        CREATE TABLE IF NOT EXISTS organization_invitations (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
          token TEXT UNIQUE NOT NULL,
          invited_by TEXT NOT NULL REFERENCES users(id),
          expires_at TIMESTAMP NOT NULL,
          accepted_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_org_invitations_org_id ON organization_invitations(organization_id);
        CREATE INDEX IF NOT EXISTS idx_org_invitations_token ON organization_invitations(token);
        CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON organization_invitations(email);

        -- Resource permissions table (for per-resource sharing)
        CREATE TABLE IF NOT EXISTS resource_permissions (
          id TEXT PRIMARY KEY,
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          visibility TEXT DEFAULT 'org' CHECK (visibility IN ('org', 'private', 'role')),
          min_role TEXT DEFAULT 'member' CHECK (min_role IN ('owner', 'admin', 'member')),
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(resource_type, resource_id)
        );
        CREATE INDEX IF NOT EXISTS idx_resource_perms_org_id ON resource_permissions(organization_id);
        CREATE INDEX IF NOT EXISTS idx_resource_perms_resource ON resource_permissions(resource_type, resource_id);

        -- Add organization_id to sessions
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id);
        
        -- Add organization_id to workflows
        ALTER TABLE workflows ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id);
        
        -- Add organization_id to buckets
        ALTER TABLE buckets ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id);
        
        -- Add organization_id to knowledge_bases
        ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id);
        
        -- Add organization_id to integrations
        ALTER TABLE integrations ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id);
        
        -- Add organization_id to schedules
        ALTER TABLE schedules ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id);
        
        -- Add organization_id to skills
        ALTER TABLE skills ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id);
        
        -- Add organization_id to api_keys
        ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id);
        
        -- Add organization_id to webhooks
        ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id);
        
        -- Add organization_id to github_webhooks
        ALTER TABLE github_webhooks ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id);
        
        -- Add organization_id to scheduled_tasks
        ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id);

        -- Create indexes for organization_id columns
        CREATE INDEX IF NOT EXISTS idx_sessions_org_id ON sessions(organization_id);
        CREATE INDEX IF NOT EXISTS idx_workflows_org_id ON workflows(organization_id);
        CREATE INDEX IF NOT EXISTS idx_buckets_org_id ON buckets(organization_id);
        CREATE INDEX IF NOT EXISTS idx_knowledge_bases_org_id ON knowledge_bases(organization_id);
        CREATE INDEX IF NOT EXISTS idx_integrations_org_id ON integrations(organization_id);
        CREATE INDEX IF NOT EXISTS idx_schedules_org_id ON schedules(organization_id);
        CREATE INDEX IF NOT EXISTS idx_skills_org_id ON skills(organization_id);
        CREATE INDEX IF NOT EXISTS idx_api_keys_org_id ON api_keys(organization_id);
        CREATE INDEX IF NOT EXISTS idx_webhooks_org_id ON webhooks(organization_id);
        CREATE INDEX IF NOT EXISTS idx_github_webhooks_org_id ON github_webhooks(organization_id);
        CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_org_id ON scheduled_tasks(organization_id);
      `,
      down: `
        -- Drop indexes
        DROP INDEX IF EXISTS idx_scheduled_tasks_org_id;
        DROP INDEX IF EXISTS idx_github_webhooks_org_id;
        DROP INDEX IF EXISTS idx_webhooks_org_id;
        DROP INDEX IF EXISTS idx_api_keys_org_id;
        DROP INDEX IF EXISTS idx_skills_org_id;
        DROP INDEX IF EXISTS idx_schedules_org_id;
        DROP INDEX IF EXISTS idx_integrations_org_id;
        DROP INDEX IF EXISTS idx_knowledge_bases_org_id;
        DROP INDEX IF EXISTS idx_buckets_org_id;
        DROP INDEX IF EXISTS idx_workflows_org_id;
        DROP INDEX IF EXISTS idx_sessions_org_id;
        
        -- Drop columns (PostgreSQL supports this)
        ALTER TABLE scheduled_tasks DROP COLUMN IF EXISTS organization_id;
        ALTER TABLE github_webhooks DROP COLUMN IF EXISTS organization_id;
        ALTER TABLE webhooks DROP COLUMN IF EXISTS organization_id;
        ALTER TABLE api_keys DROP COLUMN IF EXISTS organization_id;
        ALTER TABLE skills DROP COLUMN IF EXISTS organization_id;
        ALTER TABLE schedules DROP COLUMN IF EXISTS organization_id;
        ALTER TABLE integrations DROP COLUMN IF EXISTS organization_id;
        ALTER TABLE knowledge_bases DROP COLUMN IF EXISTS organization_id;
        ALTER TABLE buckets DROP COLUMN IF EXISTS organization_id;
        ALTER TABLE workflows DROP COLUMN IF EXISTS organization_id;
        ALTER TABLE sessions DROP COLUMN IF EXISTS organization_id;
        
        -- Drop tables
        DROP TABLE IF EXISTS resource_permissions;
        DROP TABLE IF EXISTS organization_invitations;
        DROP TABLE IF EXISTS organization_members;
        DROP TABLE IF EXISTS organizations;
      `,
    },
  },
  {
    id: 25,
    name: 'migrate_existing_users_to_orgs',
    sqlite: {
      up: `SELECT 1; -- SQLite no longer supported`,
      down: `SELECT 1;`,
    },
    postgres: {
      up: `
        -- Create personal organizations for existing users who don't have one
        INSERT INTO organizations (id, name, slug, is_personal, owner_id, created_at, updated_at)
        SELECT 
          gen_random_uuid()::text,
          split_part(u.email, '@', 1) || '''s Workspace',
          LOWER(REGEXP_REPLACE(split_part(u.email, '@', 1), '[^a-z0-9]+', '-', 'g')) || '-' || SUBSTRING(u.id, 1, 8),
          true,
          u.id,
          NOW(),
          NOW()
        FROM users u
        WHERE NOT EXISTS (
          SELECT 1 FROM organizations o WHERE o.owner_id = u.id AND o.is_personal = true
        );

        -- Add owners to their personal organizations as members
        INSERT INTO organization_members (id, organization_id, user_id, role, created_at)
        SELECT 
          gen_random_uuid()::text,
          o.id,
          o.owner_id,
          'owner',
          NOW()
        FROM organizations o
        WHERE o.is_personal = true
        AND NOT EXISTS (
          SELECT 1 FROM organization_members om 
          WHERE om.organization_id = o.id AND om.user_id = o.owner_id
        );

        -- Assign orphaned sessions to owner's personal org
        UPDATE sessions s
        SET organization_id = (
          SELECT o.id FROM organizations o 
          WHERE o.owner_id = s.user_id AND o.is_personal = true
          LIMIT 1
        )
        WHERE s.organization_id IS NULL;

        -- Assign orphaned workflows to owner's personal org
        UPDATE workflows w
        SET organization_id = (
          SELECT o.id FROM organizations o 
          WHERE o.owner_id = w.user_id AND o.is_personal = true
          LIMIT 1
        )
        WHERE w.organization_id IS NULL;

        -- Assign orphaned buckets to owner's personal org
        UPDATE buckets b
        SET organization_id = (
          SELECT o.id FROM organizations o 
          WHERE o.owner_id = b.user_id AND o.is_personal = true
          LIMIT 1
        )
        WHERE b.organization_id IS NULL;

        -- Assign orphaned knowledge_bases to owner's personal org
        UPDATE knowledge_bases kb
        SET organization_id = (
          SELECT o.id FROM organizations o 
          WHERE o.owner_id = kb.user_id AND o.is_personal = true
          LIMIT 1
        )
        WHERE kb.organization_id IS NULL;

        -- Assign orphaned integrations to owner's personal org
        UPDATE integrations i
        SET organization_id = (
          SELECT o.id FROM organizations o 
          WHERE o.owner_id = i.user_id AND o.is_personal = true
          LIMIT 1
        )
        WHERE i.organization_id IS NULL;

        -- Assign orphaned schedules to owner's personal org
        UPDATE schedules sch
        SET organization_id = (
          SELECT o.id FROM organizations o 
          WHERE o.owner_id = sch.user_id AND o.is_personal = true
          LIMIT 1
        )
        WHERE sch.organization_id IS NULL;

        -- Assign orphaned skills to owner's personal org
        UPDATE skills sk
        SET organization_id = (
          SELECT o.id FROM organizations o 
          WHERE o.owner_id = sk.user_id AND o.is_personal = true
          LIMIT 1
        )
        WHERE sk.organization_id IS NULL;

        -- Assign orphaned api_keys to owner's personal org
        UPDATE api_keys ak
        SET organization_id = (
          SELECT o.id FROM organizations o 
          WHERE o.owner_id = ak.user_id AND o.is_personal = true
          LIMIT 1
        )
        WHERE ak.organization_id IS NULL;

        -- Assign orphaned webhooks to owner's personal org
        UPDATE webhooks wh
        SET organization_id = (
          SELECT o.id FROM organizations o 
          WHERE o.owner_id = wh.user_id AND o.is_personal = true
          LIMIT 1
        )
        WHERE wh.organization_id IS NULL;

        -- Assign orphaned github_webhooks to owner's personal org
        UPDATE github_webhooks gh
        SET organization_id = (
          SELECT o.id FROM organizations o 
          WHERE o.owner_id = gh.user_id AND o.is_personal = true
          LIMIT 1
        )
        WHERE gh.organization_id IS NULL;

        -- Assign orphaned scheduled_tasks to owner's personal org
        UPDATE scheduled_tasks st
        SET organization_id = (
          SELECT o.id FROM organizations o 
          WHERE o.owner_id = st.user_id AND o.is_personal = true
          LIMIT 1
        )
        WHERE st.organization_id IS NULL;
      `,
      down: `
        -- This migration is a data migration, rollback would lose data
        -- Just clear organization_id from resources that aren't in non-personal orgs
        UPDATE sessions SET organization_id = NULL 
        WHERE organization_id IN (SELECT id FROM organizations WHERE is_personal = true);
        UPDATE workflows SET organization_id = NULL 
        WHERE organization_id IN (SELECT id FROM organizations WHERE is_personal = true);
        UPDATE buckets SET organization_id = NULL 
        WHERE organization_id IN (SELECT id FROM organizations WHERE is_personal = true);
        -- Note: Full rollback would require deleting personal orgs which could orphan resources
      `,
    },
  },
  {
    id: 26,
    name: 'add_sdk_features',
    sqlite: {
      up: `
        -- Add output_schema to agent_configs for structured output
        ALTER TABLE agent_configs ADD COLUMN output_schema TEXT;

        -- Add structured_output to task_queue for storing parsed structured output
        ALTER TABLE task_queue ADD COLUMN structured_output TEXT;

        -- Recreate task_queue with updated status constraint (SQLite workaround)
        CREATE TABLE IF NOT EXISTS task_queue_new (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES sessions(id),
          user_id TEXT NOT NULL REFERENCES users(id),
          prompt TEXT NOT NULL,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelling', 'cancelled')),
          priority INTEGER DEFAULT 0,
          source TEXT DEFAULT 'api' CHECK (source IN ('web', 'api', 'chain', 'workflow', 'slack', 'discord', 'teams', 'linear', 'jira', 'github')),
          api_key_id TEXT REFERENCES api_keys(id),
          result TEXT,
          error TEXT,
          debug_log TEXT,
          structured_output TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          started_at TEXT,
          completed_at TEXT
        );
        INSERT INTO task_queue_new SELECT id, agent_id, user_id, prompt, status, priority, source, api_key_id, result, error, debug_log, structured_output, created_at, started_at, completed_at FROM task_queue;
        DROP TABLE task_queue;
        ALTER TABLE task_queue_new RENAME TO task_queue;
        CREATE INDEX IF NOT EXISTS idx_task_queue_agent_id ON task_queue(agent_id);
        CREATE INDEX IF NOT EXISTS idx_task_queue_status ON task_queue(status);
      `,
      down: `
        -- Remove structured_output and recreate with old status constraint
        CREATE TABLE IF NOT EXISTS task_queue_old (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES sessions(id),
          user_id TEXT NOT NULL REFERENCES users(id),
          prompt TEXT NOT NULL,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
          priority INTEGER DEFAULT 0,
          source TEXT DEFAULT 'api' CHECK (source IN ('web', 'api', 'chain', 'workflow', 'slack', 'discord', 'teams', 'linear', 'jira', 'github')),
          api_key_id TEXT REFERENCES api_keys(id),
          result TEXT,
          error TEXT,
          debug_log TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          started_at TEXT,
          completed_at TEXT
        );
        INSERT INTO task_queue_old SELECT id, agent_id, user_id, prompt, 
          CASE WHEN status IN ('cancelling', 'cancelled') THEN 'failed' ELSE status END,
          priority, source, api_key_id, result, error, debug_log, created_at, started_at, completed_at FROM task_queue;
        DROP TABLE task_queue;
        ALTER TABLE task_queue_old RENAME TO task_queue;
        CREATE INDEX IF NOT EXISTS idx_task_queue_agent_id ON task_queue(agent_id);
        CREATE INDEX IF NOT EXISTS idx_task_queue_status ON task_queue(status);

        -- Remove output_schema from agent_configs (SQLite doesn't support DROP COLUMN easily)
        -- This would require table recreation which is complex, skipping for down migration
      `,
    },
    postgres: {
      up: `
        -- Add output_schema to agent_configs for structured output
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS output_schema TEXT;

        -- Add structured_output to task_queue for storing parsed structured output
        ALTER TABLE task_queue ADD COLUMN IF NOT EXISTS structured_output TEXT;

        -- Update task_queue status constraint to include cancelling and cancelled
        ALTER TABLE task_queue DROP CONSTRAINT IF EXISTS task_queue_status_check;
        ALTER TABLE task_queue ADD CONSTRAINT task_queue_status_check 
          CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelling', 'cancelled'));
      `,
      down: `
        -- Update any cancelling/cancelled tasks to failed before removing constraint
        UPDATE task_queue SET status = 'failed' WHERE status IN ('cancelling', 'cancelled');

        -- Restore old status constraint
        ALTER TABLE task_queue DROP CONSTRAINT IF EXISTS task_queue_status_check;
        ALTER TABLE task_queue ADD CONSTRAINT task_queue_status_check 
          CHECK (status IN ('pending', 'processing', 'completed', 'failed'));

        -- Remove columns
        ALTER TABLE task_queue DROP COLUMN IF EXISTS structured_output;
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS output_schema;
      `,
    },
  },
  
  // Migration: Add session_id to task_queue for SDK session isolation
  {
    id: 58,
    name: 'add_sdk_session_support',
    sqlite: {
      up: `
        -- Add session_id to task_queue for SDK session isolation
        ALTER TABLE task_queue ADD COLUMN sdk_session_id TEXT;
        
        -- Create sdk_sessions table for tracking SDK-created sessions
        CREATE TABLE IF NOT EXISTS sdk_sessions (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES sessions(id),
          api_key_id TEXT REFERENCES api_keys(id),
          sandbox_id TEXT,
          status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed')),
          created_at TEXT DEFAULT (datetime('now')),
          last_used_at TEXT DEFAULT (datetime('now')),
          closed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sdk_sessions_agent_id ON sdk_sessions(agent_id);
        CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status);
      `,
      down: `
        DROP TABLE IF EXISTS sdk_sessions;
        -- SQLite doesn't support DROP COLUMN, would need table recreation
      `,
    },
    postgres: {
      up: `
        -- Add session_id to task_queue for SDK session isolation
        ALTER TABLE task_queue ADD COLUMN IF NOT EXISTS sdk_session_id TEXT;
        
        -- Create sdk_sessions table for tracking SDK-created sessions
        CREATE TABLE IF NOT EXISTS sdk_sessions (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES sessions(id),
          api_key_id TEXT REFERENCES api_keys(id),
          sandbox_id TEXT,
          status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed')),
          created_at TIMESTAMP DEFAULT NOW(),
          last_used_at TIMESTAMP DEFAULT NOW(),
          closed_at TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_sdk_sessions_agent_id ON sdk_sessions(agent_id);
        CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status);
      `,
      down: `
        DROP TABLE IF EXISTS sdk_sessions;
        ALTER TABLE task_queue DROP COLUMN IF EXISTS sdk_session_id;
      `,
    },
  },

  // Migration: Add GitLab OAuth support
  {
    id: 59,
    name: 'add_gitlab_oauth',
    sqlite: {
      up: `
        -- Add GitLab OAuth columns to users table
        ALTER TABLE users ADD COLUMN gitlab_id TEXT UNIQUE;
        ALTER TABLE users ADD COLUMN gitlab_access_token TEXT;
        ALTER TABLE users ADD COLUMN gitlab_refresh_token TEXT;
        ALTER TABLE users ADD COLUMN gitlab_username TEXT;
      `,
      down: `
        -- SQLite doesn't support DROP COLUMN easily, would need table recreation
      `,
    },
    postgres: {
      up: `
        -- Add GitLab OAuth columns to users table
        ALTER TABLE users ADD COLUMN IF NOT EXISTS gitlab_id TEXT UNIQUE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS gitlab_access_token TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS gitlab_refresh_token TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS gitlab_username TEXT;
      `,
      down: `
        ALTER TABLE users DROP COLUMN IF EXISTS gitlab_id;
        ALTER TABLE users DROP COLUMN IF EXISTS gitlab_access_token;
        ALTER TABLE users DROP COLUMN IF EXISTS gitlab_refresh_token;
        ALTER TABLE users DROP COLUMN IF EXISTS gitlab_username;
      `,
    },
  },
  {
    id: 60,
    name: 'add_portal_custom_css',
    sqlite: {
      up: `
        -- Add custom CSS column for iframe embed customization
        ALTER TABLE agent_configs ADD COLUMN portal_custom_css TEXT;
      `,
      down: `
        -- SQLite doesn't support DROP COLUMN easily, would need table recreation
      `,
    },
    postgres: {
      up: `
        -- Add custom CSS column for iframe embed customization
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS portal_custom_css TEXT;
      `,
      down: `
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS portal_custom_css;
      `,
    },
  },
  {
    id: 61,
    name: 'enable_extended_thinking_by_default',
    sqlite: {
      up: `SELECT 1; -- SQLite no longer supported`,
      down: `SELECT 1;`,
    },
    postgres: {
      up: `
        -- Change default for enable_extended_thinking to TRUE
        ALTER TABLE agent_configs ALTER COLUMN enable_extended_thinking SET DEFAULT TRUE;
        -- Update existing NULL values to TRUE
        UPDATE agent_configs SET enable_extended_thinking = TRUE WHERE enable_extended_thinking IS NULL;
      `,
      down: `
        ALTER TABLE agent_configs ALTER COLUMN enable_extended_thinking SET DEFAULT FALSE;
      `,
    },
  },
  {
    id: 62,
    name: 'add_portal_bucket_access',
    sqlite: {
      up: `SELECT 1; -- SQLite no longer supported`,
      down: `SELECT 1;`,
    },
    postgres: {
      up: `
        -- Portal bucket access configuration
        -- Allows agents to specify which buckets are visible in the portal
        CREATE TABLE IF NOT EXISTS portal_bucket_access (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          bucket_id TEXT NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
          access_type TEXT NOT NULL DEFAULT 'output' CHECK (access_type IN ('output', 'context', 'hidden')),
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(session_id, bucket_id)
        );
        CREATE INDEX IF NOT EXISTS idx_portal_bucket_access_session_id ON portal_bucket_access(session_id);
        CREATE INDEX IF NOT EXISTS idx_portal_bucket_access_bucket_id ON portal_bucket_access(bucket_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_portal_bucket_access_bucket_id;
        DROP INDEX IF EXISTS idx_portal_bucket_access_session_id;
        DROP TABLE IF EXISTS portal_bucket_access;
      `,
    },
  },
  {
    id: 63,
    name: 'add_portal_thread_sharing',
    sqlite: {
      up: `SELECT 1; -- SQLite no longer supported`,
      down: `SELECT 1;`,
    },
    postgres: {
      up: `
        -- Add share_token column to portal_threads for thread sharing
        ALTER TABLE portal_threads ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_threads_share_token ON portal_threads(share_token);
      `,
      down: `
        DROP INDEX IF EXISTS idx_portal_threads_share_token;
        ALTER TABLE portal_threads DROP COLUMN IF EXISTS share_token;
      `,
    },
  },
  {
    id: 33,
    name: 'fix_bucket_unique_constraint_org_scope',
    sqlite: {
      up: `
        -- SQLite: Drop old constraint and recreate table with new constraint
        -- Create new table with correct constraint
        CREATE TABLE buckets_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          organization_id TEXT REFERENCES organizations(id),
          name TEXT NOT NULL,
          description TEXT,
          storage_used INTEGER DEFAULT 0,
          storage_limit INTEGER DEFAULT 1073741824,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          UNIQUE(organization_id, user_id, name)
        );
        
        -- Copy data
        INSERT INTO buckets_new SELECT * FROM buckets;
        
        -- Drop old table and rename
        DROP TABLE buckets;
        ALTER TABLE buckets_new RENAME TO buckets;
        
        -- Recreate indexes
        CREATE INDEX IF NOT EXISTS idx_buckets_user_id ON buckets(user_id);
        CREATE INDEX IF NOT EXISTS idx_buckets_org_id ON buckets(organization_id);
      `,
      down: `
        -- Revert to old constraint
        CREATE TABLE buckets_old (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          organization_id TEXT REFERENCES organizations(id),
          name TEXT NOT NULL,
          description TEXT,
          storage_used INTEGER DEFAULT 0,
          storage_limit INTEGER DEFAULT 1073741824,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          UNIQUE(user_id, name)
        );
        
        INSERT INTO buckets_old SELECT * FROM buckets;
        DROP TABLE buckets;
        ALTER TABLE buckets_old RENAME TO buckets;
        
        CREATE INDEX IF NOT EXISTS idx_buckets_user_id ON buckets(user_id);
        CREATE INDEX IF NOT EXISTS idx_buckets_org_id ON buckets(organization_id);
      `,
    },
    postgres: {
      up: `
        -- PostgreSQL: Drop old constraint and add new one
        ALTER TABLE buckets DROP CONSTRAINT IF EXISTS buckets_user_id_name_key;
        
        -- Add new constraint scoped to organization and user
        -- This allows same bucket name in different orgs, but not within same org
        CREATE UNIQUE INDEX buckets_org_user_name_key ON buckets(organization_id, user_id, name);
      `,
      down: `
        -- Revert to old constraint
        DROP INDEX IF EXISTS buckets_org_user_name_key;
        
        -- Recreate old constraint (may fail if there are now duplicates)
        ALTER TABLE buckets ADD CONSTRAINT buckets_user_id_name_key UNIQUE (user_id, name);
      `,
    },
  },
  {
    id: 64,
    name: 'add_portal_visitor_id_to_files',
    sqlite: {
      up: `
        -- Add portal_visitor_id to files table for visitor-scoped file visibility
        -- Files with NULL portal_visitor_id are visible to all (default/shared files)
        -- Files with a portal_visitor_id are only visible to that visitor (works across sessions)
        ALTER TABLE files ADD COLUMN portal_visitor_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_files_portal_visitor ON files(portal_visitor_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_files_portal_visitor;
        ALTER TABLE files DROP COLUMN IF EXISTS portal_visitor_id;
      `,
    },
    postgres: {
      up: `
        -- Add portal_visitor_id to files table for visitor-scoped file visibility
        -- Files with NULL portal_visitor_id are visible to all (default/shared files)
        -- Files with a portal_visitor_id are only visible to that visitor (works across sessions)
        ALTER TABLE files ADD COLUMN IF NOT EXISTS portal_visitor_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_files_portal_visitor ON files(portal_visitor_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_files_portal_visitor;
        ALTER TABLE files DROP COLUMN IF EXISTS portal_visitor_id;
      `,
    },
  },
  {
    id: 65,
    name: 'add_github_app_installations',
    sqlite: {
      up: `SELECT 1; -- SQLite no longer supported`,
      down: `SELECT 1;`,
    },
    postgres: {
      up: `
        -- GitHub App installations table
        -- Tracks which users have installed the GitHub App and on which accounts/orgs
        CREATE TABLE IF NOT EXISTS github_app_installations (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          installation_id BIGINT NOT NULL UNIQUE,
          account_login TEXT NOT NULL,
          account_type TEXT NOT NULL CHECK (account_type IN ('User', 'Organization')),
          account_id BIGINT NOT NULL,
          permissions JSONB,
          repository_selection TEXT CHECK (repository_selection IN ('all', 'selected')),
          suspended_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_gh_app_installations_user ON github_app_installations(user_id);
        CREATE INDEX IF NOT EXISTS idx_gh_app_installations_account ON github_app_installations(account_login);
        
        -- Add github_installation_id to bucket_repos for GitHub App-based repos
        ALTER TABLE bucket_repos ADD COLUMN IF NOT EXISTS github_installation_id BIGINT;
        CREATE INDEX IF NOT EXISTS idx_bucket_repos_gh_installation ON bucket_repos(github_installation_id);
      `,
      down: `
        DROP INDEX IF EXISTS idx_bucket_repos_gh_installation;
        ALTER TABLE bucket_repos DROP COLUMN IF EXISTS github_installation_id;
        DROP INDEX IF EXISTS idx_gh_app_installations_account;
        DROP INDEX IF EXISTS idx_gh_app_installations_user;
        DROP TABLE IF EXISTS github_app_installations;
      `,
    },
  },
  {
    id: 66,
    name: 'add_portal_greeting_and_suggested_questions',
    sqlite: {
      up: `SELECT 1; -- SQLite no longer supported`,
      down: `SELECT 1;`,
    },
    postgres: {
      up: `
        -- Add portal_greeting for custom greeting text (e.g., "Welcome to {name}!")
        -- Add portal_suggested_questions as JSON array of suggested questions
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS portal_greeting TEXT;
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS portal_suggested_questions JSONB;
      `,
      down: `
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS portal_greeting;
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS portal_suggested_questions;
      `,
    },
  },
  {
    id: 67,
    name: 'add_portal_bucket_id',
    sqlite: {
      up: `SELECT 1; -- SQLite no longer supported`,
      down: `SELECT 1;`,
    },
    postgres: {
      up: `
        -- Add portal_bucket_id to specify which bucket is shown in portal files
        -- If null, defaults to first attached bucket
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS portal_bucket_id TEXT REFERENCES buckets(id) ON DELETE SET NULL;
      `,
      down: `
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS portal_bucket_id;
      `,
    },
  },
  {
    id: 68,
    name: 'add_portal_files_hidden',
    sqlite: {
      up: `SELECT 1; -- SQLite no longer supported`,
      down: `SELECT 1;`,
    },
    postgres: {
      up: `
        -- Add portal_files_hidden to explicitly hide files section in portal
        -- When true, files section is hidden regardless of attached buckets
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS portal_files_hidden BOOLEAN DEFAULT false;
      `,
      down: `
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS portal_files_hidden;
      `,
    },
  },
  {
    id: 69,
    name: 'add_thinking_to_portal_messages',
    sqlite: {
      up: `SELECT 1; -- SQLite no longer supported`,
      down: `SELECT 1;`,
    },
    postgres: {
      up: `
        -- Add thinking_content to portal_messages for extended thinking persistence
        ALTER TABLE portal_messages ADD COLUMN IF NOT EXISTS thinking_content TEXT;
        
        -- Add thinking_content to embed_thread_messages as well
        ALTER TABLE embed_thread_messages ADD COLUMN IF NOT EXISTS thinking_content TEXT;
      `,
      down: `
        ALTER TABLE portal_messages DROP COLUMN IF EXISTS thinking_content;
        ALTER TABLE embed_thread_messages DROP COLUMN IF EXISTS thinking_content;
      `,
    },
  },
  {
    id: 70,
    name: 'add_portal_agent_type',
    sqlite: {
      up: `SELECT 1; -- SQLite no longer supported`,
      down: `SELECT 1;`,
    },
    postgres: {
      up: `
        -- Update agent_type CHECK constraint to include 'portal'
        ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_agent_type_check;
        ALTER TABLE sessions ADD CONSTRAINT sessions_agent_type_check
          CHECK (agent_type IN ('code', 'task', 'portal'));

        -- Portal agent config columns
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS portal_agent_model TEXT DEFAULT 'claude-sonnet-4-5-20250929';
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS portal_agent_thinking_budget INTEGER DEFAULT 10000;
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS portal_agent_max_tokens INTEGER DEFAULT 8192;
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS portal_agent_tools TEXT;
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS portal_agent_sandbox_enabled BOOLEAN DEFAULT false;
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS setup_wizard_completed BOOLEAN DEFAULT false;
      `,
      down: `
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS setup_wizard_completed;
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS portal_agent_sandbox_enabled;
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS portal_agent_tools;
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS portal_agent_max_tokens;
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS portal_agent_thinking_budget;
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS portal_agent_model;

        ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_agent_type_check;
        ALTER TABLE sessions ADD CONSTRAINT sessions_agent_type_check
          CHECK (agent_type IN ('code', 'task'));
      `,
    },
  },
  {
    id: 71,
    name: 'add_friendly_name_to_files',
    sqlite: {
      up: `SELECT 1; -- SQLite no longer supported`,
      down: `SELECT 1;`,
    },
    postgres: {
      up: `
        -- Add friendly_name column to files table for AI-generated skill display names
        ALTER TABLE files ADD COLUMN IF NOT EXISTS friendly_name TEXT;
      `,
      down: `
        ALTER TABLE files DROP COLUMN IF EXISTS friendly_name;
      `,
    },
  },
  {
    id: 72,
    name: 'add_portal_sandbox_agent_type',
    sqlite: {
      up: `SELECT 1; -- SQLite no longer supported`,
      down: `SELECT 1;`,
    },
    postgres: {
      up: `
        -- Update sessions table to support portal-sandbox agent type
        ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_agent_type_check;
        ALTER TABLE sessions ADD CONSTRAINT sessions_agent_type_check
          CHECK (agent_type IN ('code', 'task', 'portal', 'portal-sandbox'));
      `,
      down: `
        ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_agent_type_check;
        ALTER TABLE sessions ADD CONSTRAINT sessions_agent_type_check
          CHECK (agent_type IN ('code', 'task', 'portal'));
      `,
    },
  },
  {
    id: 73,
    name: 'add_portal_active_skills',
    sqlite: {
      up: `SELECT 1; -- SQLite no longer supported`,
      down: `SELECT 1;`,
    },
    postgres: {
      up: `
        -- Add portal_active_skills column to agent_configs table to store uploaded skills
        ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS portal_active_skills JSONB DEFAULT '[]'::jsonb;
      `,
      down: `
        ALTER TABLE agent_configs DROP COLUMN IF EXISTS portal_active_skills;
      `,
    },
  },
];

export const migrations: Migration[] = legacyMigrations.map((m) => ({
  id: m.id,
  name: m.name,
  up: m.postgres.up,
  down: m.postgres.down,
}));
