# OC Agents

An agentic platform that lets AI agents work for you. Create task agents, connect tools, and automate workflows.

## Architecture

- **Backend**: Node.js + Express + PostgreSQL
- **Frontend**: Vite + React + TypeScript + Tailwind CSS
- **Agent Runtime**: OpenComputer Sandboxes + Claude / OpenCode
- **Auth**: Session-based with WorkOS

## Features

- User authentication (WorkOS / GitHub OAuth)
- Sandboxed code execution via OpenComputer
- AI agents (Claude Code, OpenCode) for task execution
- Real-time streaming output
- File bucket storage (Cloudflare R2 / S3)

## SDK

OC Agents provides TypeScript and Python SDKs for programmatic access to agents. The SDKs support real-time streaming, structured output, task management, and graceful error handling.

### Features

- **Real-time Streaming**: Stream agent responses as they're generated
- **Structured Output**: Define JSON schemas for consistent, parseable responses
- **Task Management**: Submit tasks, monitor progress, and cancel if needed
- **Sandbox Warmup**: Pre-warm sandboxes for faster first-request performance
- **Session Isolation**: Create isolated sandboxes for multi-user/multi-tenant scenarios
- **Auto-reconnect**: Handles connection drops and sandbox restarts gracefully
- **Type Safety**: Full TypeScript support with comprehensive type definitions

### Quick Start

#### TypeScript SDK

```typescript
import { OCAgents } from '@opencomputer/agents-sdk';

const client = new OCAgents({
  apiKey: 'flt_your_api_key',
  baseUrl: 'http://localhost:3000'
});

// Connect to the service
await client.connect();

// List available agents
const agents = await client.agents.list();

// Simple blocking call
const result = await client.agents.run('agent-id', {
  prompt: 'Create a simple React component',
  timeout: 300 // seconds
});

console.log(result.result); // Raw text response
console.log(result.output); // Structured output (if configured)
```

#### Streaming with Task Management

```typescript
// Submit a task for streaming execution
const task = await client.agents.submit('agent-id', {
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
from oc_agents import OCAgents

async def main():
    client = OCAgents(
        api_key="flt_your_api_key",
        base_url="http://localhost:3000"
    )
    
    # Connect
    await client.connect()
    
    # Simple call
    result = await client.agents.run("agent-id", {
        "prompt": "Write a Python function to calculate fibonacci",
        "timeout": 300
    })
    
    print(result.result)  # Raw response
    print(result.output)  # Structured output
    
    # Streaming
    task = await client.agents.submit("agent-id", {
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
// In the OC Agents UI, configure an agent's structured output schema:
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
const result = await client.agents.run('agent-id', {
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
const warmupResult = await client.agents.warmup('agent-id');
if (warmupResult.success) {
  console.log(`Sandbox ready: ${warmupResult.sandboxId}`);
}

// Warm up multiple agents in parallel
const agentIds = ['agent-1', 'agent-2', 'agent-3'];
const results = await client.agents.warmupMultiple(agentIds);
console.log(`Warmed up ${results.results.filter(r => r.success).length}/${agentIds.length} agents`);

// Now first requests will be much faster
const result = await client.agents.run('agent-id', {
  prompt: 'This will start immediately!'
});
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
const session = await client.agents.new('agent-id');
console.log(`Session created: ${session.id}`);

// Run tasks in the isolated session
const result = await client.agents.run('agent-id', {
  prompt: 'Create a file called data.json',
  sessionId: session.id,
  timeout: 120,
});

// Run more tasks in the same sandbox
const result2 = await client.agents.run('agent-id', {
  prompt: 'Read the data.json file we just created',
  sessionId: session.id,
  timeout: 60,
});

// Close the session when done (cleans up sandbox)
await client.agents.close('agent-id', session.id);
```

#### Auto-provisioned Sessions

```typescript
// The 'provision' option auto-creates a session for this task
const task = await client.agents.submit('agent-id', {
  prompt: 'Process this document',
  provision: true,
});

console.log(`Auto-created session: ${task.sessionId}`);

const result = await task.result();

// Clean up when done
if (task.sessionId) {
  await client.agents.close('agent-id', task.sessionId);
}
```

### Installation

#### TypeScript
```bash
cd packages/sdk-typescript
npm run build
cd ../../your-project
npm install file:../path/to/oc-agents/packages/sdk-typescript
```

#### Python
```bash
cd packages/sdk-python
pip install -e .
```

### Examples

The repository includes several examples in `examples/`:

- `test-sdk-simple.mjs` - Basic SDK connection and agent listing
- `test-sdk-full.mjs` - Full test suite (streaming, structured output, multi-turn, cancellation)
- `test-sdk.mjs` - General SDK usage
- `structured-output-example.mjs` - JSON schema output
- `warmup-example.mjs` - Sandbox warmup
- **Chat Interface**: `examples/chat-app-starter/` - Full React app using the SDK

### API Reference

#### OCAgents Client

```typescript
const client = new OCAgents({
  apiKey: string,        // Your API key (starts with 'flt_')
  baseUrl?: string,      // Backend URL (default: 'http://localhost:3000')
  timeout?: number       // Default timeout in seconds (default: 300)
});
```

#### Methods

- `await client.connect()` - Connect to the WebSocket service
- `await client.disconnect()` - Disconnect from the service
- `await client.agents.list()` - List available agents
- `await client.agents.run(agentId, options)` - Run agent synchronously
- `await client.agents.submit(agentId, options)` - Submit task for streaming
- `await client.agents.warmup(agentId)` - Warm up sandbox
- `await client.agents.new(agentId)` - Create isolated session
- `await client.agents.close(agentId, sessionId)` - Close session

#### Task Events

- `stdout` - Agent output stream
- `stderr` - Error output stream
- `status` - Status changes (queued, running, completed, failed, cancelled)
- `tool_start` / `tool_end` - Tool usage events
- `thinking` - Extended thinking content

## Setup

### Prerequisites

- Node.js 18+
- npm
- PostgreSQL (local or remote)
- OpenComputer API Key
- Anthropic API Key (for Claude Code agents)
- OpenAI API Key (for OpenCode agents)

### Environment Variables

Copy the example env file and fill in your credentials:

```bash
cp backend/.env.example backend/.env
```

Required variables:
- `DATABASE_URL`: PostgreSQL connection string
- `SESSION_SECRET`: Random string for session encryption
- `OPENCOMPUTER_API_KEY`: From app.opencomputer.dev
- `ANTHROPIC_API_KEY`: From Anthropic console
- `FRONTEND_URL`: Frontend URL for CORS (default: http://localhost:5173)

Optional:
- `OPENAI_API_KEY`: For OpenCode agents with OpenAI models
- `WORKOS_CLIENT_ID` / `WORKOS_API_KEY`: For WorkOS auth
- `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME`: For Cloudflare R2 storage

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

## License

MIT
