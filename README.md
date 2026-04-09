# Agent Orchestrator

An agentic coding platform that lets AI agents write code for you. Connect your GitHub repos, describe what you want, and watch as the agent makes changes automatically.

## Architecture

- **Backend**: Node.js + Express + PostgreSQL
- **Frontend**: Vite + React + TypeScript + Tailwind CSS
- **Agent Runtime**: E2B Sandboxes + Claude API
- **Auth**: Session-based with GitHub OAuth

## Features

- User authentication (email/password + GitHub OAuth)
- GitHub repository integration
- Sandboxed code execution via E2B
- AI agent (Claude) for making code changes
- Git operations (commit, push, branch)

## SDK

Oshu provides TypeScript and Python SDKs for programmatic access to agents. The SDKs support real-time streaming, structured output, task management, and graceful error handling.

### Features

- 🚀 **Real-time Streaming**: Stream agent responses as they're generated
- 📊 **Structured Output**: Define JSON schemas for consistent, parseable responses
- ⏱️ **Task Management**: Submit tasks, monitor progress, and cancel if needed
- 🔥 **Sandbox Warmup**: Pre-warm sandboxes for faster first-request performance
- 🔒 **Session Isolation**: Create isolated sandboxes for multi-user/multi-tenant scenarios
- 🔄 **Auto-reconnect**: Handles connection drops and sandbox restarts gracefully
- 🎯 **Type Safety**: Full TypeScript support with comprehensive type definitions

### Quick Start

#### TypeScript SDK

```typescript
import { Oshu } from '@opencomputer/agents-sdk';

const oshu = new Oshu({
  apiKey: 'flt_your_api_key',
  baseUrl: 'http://localhost:3000'
});

// Connect to the service
await oshu.connect();

// List available agents
const agents = await oshu.agents.list();

// Simple blocking call
const result = await oshu.agents.run('agent-id', {
  prompt: 'Create a simple React component',
  timeout: 300 // seconds
});

console.log(result.result); // Raw text response
console.log(result.output); // Structured output (if configured)
```

#### Streaming with Task Management

```typescript
// Submit a task for streaming execution
const task = await oshu.agents.submit('agent-id', {
  prompt: 'Refactor this code to use TypeScript',
  timeout: 600
});

// Listen for real-time updates
task.on('stdout', (data) => {
  console.log('Agent output:', data);
});

task.on('status', (status) => {
  console.log('Task status:', status);
});

// Wait for completion
const result = await task.result();
console.log('Final result:', result);

// Or cancel if needed
// await task.cancel();
```

#### Python SDK

```python
import asyncio
from oshu import Oshu

async def main():
    oshu = Oshu(
        api_key="flt_your_api_key",
        base_url="http://localhost:3000"
    )
    
    # Connect
    await oshu.connect()
    
    # Simple call
    result = await oshu.agents.run("agent-id", {
        "prompt": "Write a Python function to calculate fibonacci",
        "timeout": 300
    })
    
    print(result.result)  # Raw response
    print(result.output)  # Structured output
    
    # Streaming
    task = await oshu.agents.submit("agent-id", {
        "prompt": "Create a FastAPI application",
        "timeout": 600
    })
    
    # Listen for updates
    def on_stdout(data):
        print(f"Agent: {data}")
    
    task.on("stdout", on_stdout)
    result = await task.result()

asyncio.run(main())
```

### Structured Output

Define JSON schemas per agent to get consistent, parseable responses:

```typescript
// In the Oshu UI, configure an agent's structured output schema:
{
  "type": "object",
  "properties": {
    "summary": {
      "type": "string",
      "description": "Brief summary of changes made"
    },
    "files_modified": {
      "type": "array",
      "items": { "type": "string" },
      "description": "List of files that were modified"
    },
    "status": {
      "type": "string",
      "enum": ["success", "error", "partial"],
      "description": "Overall status of the task"
    }
  },
  "required": ["summary", "status"]
}
```

Then in your code:

```typescript
const result = await oshu.agents.run('agent-id', {
  prompt: 'Add error handling to the API routes'
});

// result.result contains the natural language response
// result.output contains the parsed JSON matching your schema
console.log(result.output.summary);
console.log(result.output.files_modified);
console.log(result.output.status);
```

### Sandbox Warmup

Improve first-request performance by warming up sandboxes ahead of time:

```typescript
// Warm up a single agent
const warmupResult = await oshu.agents.warmup('agent-id');
if (warmupResult.success) {
  console.log(`Sandbox ready: ${warmupResult.sandboxId}`);
}

// Warm up multiple agents in parallel
const agentIds = ['agent-1', 'agent-2', 'agent-3'];
const results = await oshu.agents.warmupMultiple(agentIds);
console.log(`Warmed up ${results.results.filter(r => r.success).length}/${agentIds.length} agents`);

// Now first requests will be much faster
const result = await oshu.agents.run('agent-id', {
  prompt: 'This will start immediately!'
});
```

Python equivalent:

```python
# Warm up a single agent
warmup_result = await oshu.agents.warmup('agent-id')
if warmup_result['success']:
    print(f"Sandbox ready: {warmup_result['sandbox_id']}")

# Warm up multiple agents
agent_ids = ['agent-1', 'agent-2', 'agent-3']
results = await oshu.agents.warmup_multiple(agent_ids)
success_count = sum(1 for r in results['results'] if r['success'])
print(f"Warmed up {success_count}/{len(agent_ids)} agents")
```

### Session Isolation

Create isolated sandbox sessions for multi-user or multi-process scenarios. Each session gets its own sandbox, so work done in one session doesn't affect others.

#### Use Cases

- **Multi-tenant applications**: Each user gets their own isolated environment
- **Parallel processing**: Run multiple tasks on the same agent without interference
- **Testing**: Isolated environments for each test run
- **API consumers**: SDK users can manage their own sandbox lifecycle

#### TypeScript

```typescript
// Create an isolated session
const session = await oshu.agents.new('agent-id');
console.log(`Session created: ${session.id}`);

// Run tasks in the isolated session
const result = await oshu.agents.run('agent-id', {
  prompt: 'Create a file called data.json',
  sessionId: session.id,  // Routes to this specific sandbox
  timeout: 120,
});

// Run more tasks in the same sandbox
const result2 = await oshu.agents.run('agent-id', {
  prompt: 'Read the data.json file we just created',
  sessionId: session.id,
  timeout: 60,
});

// Close the session when done (cleans up sandbox)
await oshu.agents.close('agent-id', session.id);
```

#### Auto-provisioned Sessions

For simpler use cases, let the system create sessions automatically:

```typescript
// The 'provision' option auto-creates a session for this task
const task = await oshu.agents.submit('agent-id', {
  prompt: 'Process this document',
  provision: true,  // Creates isolated session automatically
});

console.log(`Auto-created session: ${task.sessionId}`);

const result = await task.result();

// Clean up when done
if (task.sessionId) {
  await oshu.agents.close('agent-id', task.sessionId);
}
```

#### Python

```python
# Create an isolated session
session = await oshu.agents.new('agent-id')
print(f"Session created: {session.id}")

# Run tasks in the isolated session
result = await oshu.agents.run(
    'agent-id',
    RunOptions(
        prompt='Create a file called data.json',
        session_id=session.id,
        timeout=120,
    )
)

# Close the session when done
await oshu.agents.close_session('agent-id', session.id)
```

#### Session Lifecycle

- **Creation**: `agents.new(agentId)` creates a session and optionally warms up the sandbox
- **Usage**: Pass `sessionId` to `run()` or `submit()` to route tasks to the session's sandbox
- **TTL**: Sessions automatically close after 30 minutes of inactivity
- **Cleanup**: Call `agents.close(agentId, sessionId)` to immediately close and clean up

#### Isolation Surfaces

The system supports different isolation levels:

| Surface | Sandbox Key | Description |
|---------|-------------|-------------|
| Playground | `{agentId}:owner` | Owner testing their agent (UI) |
| Portal | `portal-{portalSessionId}` | Per-visitor isolation |
| Embed | `embed-{embedUserId}` | Per-embed-user isolation |
| SDK (with session) | `{agentId}:sdk:{sessionId}` | SDK-managed isolation |
| SDK (no session) | `{agentId}` | Shared sandbox (backward compatible) |

### Installation

#### TypeScript
```bash
# From the main repo
cd packages/sdk-typescript
npm run build
cd ../../your-project
npm install file:../path/to/oshu/packages/sdk-typescript
```

#### Python
```bash
# From the main repo
cd packages/sdk-python
pip install -e .
```

### Examples

The repository includes several examples:

- **TypeScript Examples**:
  - `examples/test-sdk.mjs` - Basic SDK usage
  - `examples/structured-output-example.mjs` - JSON schema output
  - `examples/warmup-example.mjs` - Sandbox warmup
  - `examples/session-isolation-example.mjs` - Session isolation
  - `examples/multi-user-sessions.mjs` - Multi-user isolation demo
  - `examples/session-with-warmup.mjs` - Sessions + warmup performance
- **Python Examples** (`examples/python-example/`):
  - `warmup_example.py` - Sandbox warmup
  - `session_isolation_example.py` - Session isolation
  - `multi_user_sessions.py` - Multi-user isolation demo
- **Chat Interface**: `examples/chat-app-starter/` - Full React app using the SDK

#### Chat App Starter

A complete chat interface built with the SDK:

```bash
cd examples/chat-app-starter
./install.sh
npm run dev
```

Features:
- Real-time agent conversations
- Agent selection and management
- Structured output display
- Settings persistence
- Modern React UI with Tailwind CSS

### API Reference

#### Oshu Client

```typescript
const oshu = new Oshu({
  apiKey: string,        // Your API key (starts with 'flt_')
  baseUrl?: string,      // Backend URL (default: 'http://localhost:3000')
  timeout?: number       // Default timeout in seconds (default: 300)
});
```

#### Methods

- `await oshu.connect()` - Connect to the WebSocket service
- `await oshu.disconnect()` - Disconnect from the service
- `await oshu.agents.list()` - List available agents
- `await oshu.agents.run(agentId, options)` - Run agent synchronously
- `await oshu.agents.submit(agentId, options)` - Submit task for streaming
- `await oshu.agents.warmup(agentId)` - Warm up sandbox for faster performance
- `await oshu.agents.warmupMultiple(agentIds)` - Warm up multiple agents in parallel

#### Run Options

```typescript
interface RunOptions {
  prompt: string;        // The task description
  timeout?: number;      // Timeout in seconds
  priority?: number;     // Task priority (1-10)
}
```

#### Task Events

- `stdout` - Agent output stream
- `stderr` - Error output stream
- `status` - Status changes (queued, running, completed, failed, cancelled)
- `tool` - Tool usage events

## Setup

### Prerequisites

- Node.js 18+
- npm
- PostgreSQL (local or remote)
- GitHub OAuth App (for GitHub integration)
- E2B API Key
- Anthropic API Key

### Environment Variables

Copy the example env file and fill in your credentials:

```bash
cp backend/.env.example backend/.env
```

Required variables:
- `DATABASE_URL`: PostgreSQL connection string (e.g., `postgres://user:pass@localhost:5432/dbname`)
- `SESSION_SECRET`: Random string for session encryption
- `GITHUB_CLIENT_ID`: From GitHub OAuth App
- `GITHUB_CLIENT_SECRET`: From GitHub OAuth App
- `GITHUB_CALLBACK_URL`: OAuth callback URL (default: http://localhost:3000/api/auth/github/callback)
- `E2B_API_KEY`: From e2b.dev
- `ANTHROPIC_API_KEY`: From Anthropic console
- `FRONTEND_URL`: Frontend URL for CORS (default: http://localhost:5173)

### Installation

```bash
# Install all dependencies
npm run install:all

# Initialize database
npm run db:migrate

# Start development servers
npm run dev
```

The backend runs on http://localhost:3000 and frontend on http://localhost:5173

## How It Works

1. **Register/Login**: Create an account and connect your GitHub
2. **Create Session**: Select a repository and branch
3. **Start Sandbox**: Spins up an E2B sandbox with your code cloned
4. **Make Requests**: Describe changes in natural language
5. **Agent Works**: Claude reads your code, makes changes, and commits
6. **Push Changes**: Review and push when ready

## API Routes

### Auth
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### GitHub
- `GET /api/auth/github/connect` - Start GitHub OAuth
- `GET /api/auth/github/callback` - OAuth callback
- `GET /api/auth/github/repos` - List user repos
- `GET /api/auth/github/repos/:owner/:repo/branches` - List branches

### Sessions
- `GET /api/sessions` - List sessions
- `POST /api/sessions` - Create session
- `GET /api/sessions/:id` - Get session details
- `DELETE /api/sessions/:id` - Delete session

### Agent
- `POST /api/agent/sessions/:id/sandbox/start` - Start sandbox
- `POST /api/agent/sessions/:id/sandbox/stop` - Stop sandbox
- `POST /api/agent/sessions/:id/tasks/:taskId/run` - Run agent task
- `POST /api/agent/sessions/:id/exec` - Execute command in sandbox
- `POST /api/agent/sessions/:id/push` - Push changes

## License

MIT
