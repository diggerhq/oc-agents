# @opencomputer/agents-sdk

Official TypeScript SDK for [OpenComputer Agents](https://opencomputer.dev) - Run AI agents programmatically.

## Installation

```bash
npm install @opencomputer/agents-sdk
```

## Quick Start

```typescript
import { OCAgents } from '@opencomputer/agents-sdk';

const client = new OCAgents({ apiKey: 'flt_xxx' });
await client.connect();

// Run a task and wait for the result
const result = await client.agents.run('agent-id', {
  prompt: 'Analyze the sales data and provide a summary'
});

console.log(result.output); // Structured output (if agent has output_schema)
console.log(result.result); // Raw text output
```

## Features

- **Real-time streaming** - Get live output as the agent works
- **Task control** - Cancel long-running tasks at any time
- **Structured output** - Define schemas for typed responses
- **Auto-reconnect** - Handles connection drops gracefully
- **Full TypeScript support** - Complete type definitions

## Usage

### Simple: Run and Wait

```typescript
const result = await client.agents.run('agent-id', {
  prompt: 'Analyze this data',
  timeout: 300000, // 5 minutes max
});

if (result.output) {
  // Typed structured output (if agent has output_schema)
  console.log(result.output.summary);
  console.log(result.output.confidence);
}
```

### Advanced: Stream Events

```typescript
const task = await client.agents.submit('agent-id', {
  prompt: 'Long running analysis task'
});

// Listen to real-time events
task.on('stdout', (data) => {
  process.stdout.write(data);
});

task.on('tool_start', (tool, input) => {
  console.log(`Using tool: ${tool}`);
});

task.on('tool_end', (tool, output, duration) => {
  console.log(`${tool} completed in ${duration}ms`);
});

task.on('status', (status) => {
  console.log(`Status: ${status}`);
});

// Cancel if needed
setTimeout(() => {
  task.cancel();
}, 60000);

// Wait for final result
try {
  const result = await task.result();
  console.log('Completed:', result.output);
} catch (error) {
  if (error instanceof TaskCancelledError) {
    console.log('Task was cancelled');
  }
}
```

### List Agents

```typescript
const agents = await client.agents.list();
for (const agent of agents) {
  console.log(`${agent.name} (${agent.id})`);
  console.log(`  Type: ${agent.type}`);
  console.log(`  Provider: ${agent.provider}`);
}
```

### With Structured Output Types

```typescript
// Define your output type
interface AnalysisResult {
  summary: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: number;
  keyPoints: string[];
}

// Get typed result
const result = await client.agents.run<AnalysisResult>('agent-id', {
  prompt: 'Analyze this text...'
});

// TypeScript knows the shape of result.output
console.log(result.output?.summary);
console.log(result.output?.keyPoints.join(', '));
```

## Error Handling

```typescript
import {
  OCAgents,
  OCError,
  TaskCancelledError,
  TaskFailedError,
  TaskTimeoutError,
  AuthenticationError,
} from '@opencomputer/agents-sdk';

try {
  const result = await client.agents.run('agent-id', { prompt: '...' });
} catch (error) {
  if (error instanceof TaskCancelledError) {
    console.log('Task was cancelled');
  } else if (error instanceof TaskFailedError) {
    console.log('Task failed:', error.taskError);
  } else if (error instanceof TaskTimeoutError) {
    console.log('Task timed out after', error.timeout, 'ms');
  } else if (error instanceof AuthenticationError) {
    console.log('Invalid API key');
  } else if (error instanceof OCError) {
    console.log('OCAgents error:', error.message, error.code);
  }
}
```

## Configuration

```typescript
const client = new OCAgents({
  apiKey: 'flt_xxx',           // Required: Your API key
  baseUrl: 'https://api.opencomputer.dev', // Optional: API base URL
  timeout: 600000,              // Optional: Default timeout (10 min)
});
```

## API Reference

### `OCAgents`

Main client class.

- `constructor(config: OCAgentsConfig)` - Create a new client
- `connect(): Promise<void>` - Connect to OpenComputer Agents (required before using)
- `disconnect(): void` - Disconnect from OpenComputer Agents
- `isConnected(): boolean` - Check connection status
- `agents: AgentsResource` - Access agents resource

### `AgentsResource`

Resource for interacting with agents.

- `list(): Promise<Agent[]>` - List all agents
- `get(agentId: string): Promise<Agent>` - Get a specific agent
- `run<T>(agentId: string, options: RunOptions): Promise<TaskResult<T>>` - Run a task and wait
- `submit<T>(agentId: string, options: SubmitOptions): TaskHandle<T>` - Submit a task (non-blocking)

### `TaskHandle`

Handle for managing a submitted task.

- `id: string` - Task ID
- `agentId: string` - Agent ID
- `on(event, handler)` - Listen to events ('stdout', 'stderr', 'tool_start', 'tool_end', 'status')
- `cancel(): Promise<void>` - Cancel the task
- `result(): Promise<TaskResult<T>>` - Wait for the result
- `getStatus(): TaskStatus` - Get current status
- `isFinished(): boolean` - Check if task is done

## License

MIT
