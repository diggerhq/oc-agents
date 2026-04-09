# SDK Tests

These tests verify SDK functionality including session isolation, task execution, and streaming.

## Prerequisites

1. Backend server running (`npm run dev` in root)
2. An agent with API access enabled
3. A valid API key

## Running Tests

### Quick Start

```bash
# From sdk-typescript directory
OC_AGENT_ID=<your-agent-id> npm test
```

### With Custom Settings

```bash
OC_API_KEY=flt_your_key \
OC_BASE_URL=http://localhost:3000 \
OC_AGENT_ID=your-agent-id \
npm test
```

### Using Root Script

```bash
# From repo root
OC_AGENT_ID=<agent-id> ./scripts/test-sdk.sh ts
```

## Test Coverage

| Category | Tests |
|----------|-------|
| Session Management | Create session, session properties |
| Task Execution | Run tasks, streaming, state sharing |
| Session Isolation | Multiple sessions, file isolation |
| Provision | Auto-session creation |
| Cleanup | Session close |

## What the Tests Verify

1. **Session Creation** - `client.agents.new()` returns valid session
2. **Task Execution** - `run()` and `submit()` complete successfully
3. **State Persistence** - Tasks in same session share filesystem
4. **Session Isolation** - Different sessions have separate sandboxes
5. **Provision** - `provision: true` auto-creates isolated sessions
6. **Cleanup** - `close()` properly terminates sessions
