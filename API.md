# OC Agents — API Reference

## How It Works

1. **Login**: Authenticate via WorkOS or GitHub OAuth
2. **Create Agent**: Configure a task agent with a system prompt and AI provider
3. **Start Sandbox**: Spins up an OpenComputer sandbox
4. **Make Requests**: Describe tasks in natural language (via UI or SDK)
5. **Agent Works**: The AI agent executes in the sandbox, streams output in real-time
6. **Get Results**: Receive structured or raw text output

## REST API Routes

### Auth
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Sessions (Agents)
- `GET /api/sessions` - List sessions
- `POST /api/sessions` - Create session
- `GET /api/sessions/:id` - Get session details
- `DELETE /api/sessions/:id` - Delete session

### Agent Sandbox
- `POST /api/agent/sessions/:id/sandbox/start` - Start sandbox
- `POST /api/agent/sessions/:id/sandbox/stop` - Stop sandbox
- `POST /api/agent/sessions/:id/sandbox/reset` - Reset sandbox
- `POST /api/agent/sessions/:id/tasks/:taskId/run` - Run agent task
- `POST /api/agent/sessions/:id/exec` - Execute command in sandbox
- `GET /api/agent/sessions/:id/output` - Get agent output

### Agent Config
- `GET /api/agents/:id/config` - Get agent configuration
- `PUT /api/agents/:id/config` - Update agent configuration

### SDK / API v1
- `GET /api/v1/agents` - List agents (API key auth)
- `GET /api/v1/agents/:id` - Get agent details
- `POST /api/v1/agents` - Create agent
- `PUT /api/v1/agents/:id` - Update agent
- `POST /api/v1/agents/:id/sessions` - Create SDK session
- `DELETE /api/v1/agents/:id/sessions/:sessionId` - Close SDK session

### WebSocket
- `ws://host/ws` - Playground WebSocket (session-based auth)
- `ws://host/ws/v1/tasks?api_key=flt_xxx` - SDK WebSocket (API key auth)
- `ws://host/pty` - Terminal PTY WebSocket

### Files & Knowledge
- `GET /api/files/buckets` - List file buckets
- `POST /api/files/buckets` - Create bucket
- `GET /api/files/buckets/:id/files` - List files in bucket
- `POST /api/files/buckets/:id/upload` - Upload file to bucket
- `GET /api/knowledge/agents/:id` - List knowledge bases for agent

### API Keys
- `GET /api/keys` - List API keys
- `POST /api/keys` - Create API key
- `DELETE /api/keys/:id` - Delete API key
