# oshu

Official Python SDK for [Oshu](https://oshu.dev) - Run AI agents programmatically.

## Installation

```bash
pip install oshu
```

## Quick Start

```python
import asyncio
from oshu import Oshu, RunOptions

async def main():
    oshu = Oshu(api_key='flt_xxx')
    await oshu.connect()
    
    # Run a task and wait for the result
    result = await oshu.agents.run('agent-id', RunOptions(
        prompt='Analyze the sales data and provide a summary'
    ))
    
    print(result.output)  # Structured output (if agent has output_schema)
    print(result.result)  # Raw text output
    
    await oshu.disconnect()

asyncio.run(main())
```

## Features

- **Real-time streaming** - Get live output as the agent works
- **Task control** - Cancel long-running tasks at any time
- **Structured output** - Define schemas for typed responses
- **Auto-reconnect** - Handles connection drops gracefully
- **Async/await** - Native Python async support

## Usage

### Simple: Run and Wait

```python
async with Oshu(api_key='oshu_xxx') as oshu:
    result = await oshu.agents.run('agent-id', RunOptions(
        prompt='Analyze this data',
        timeout=300.0,  # 5 minutes max
    ))
    
    if result.output:
        # Structured output (if agent has output_schema)
        print(result.output['summary'])
        print(result.output['confidence'])
```

### Advanced: Stream Events

```python
from oshu import Oshu, SubmitOptions

async def main():
    oshu = Oshu(api_key='flt_xxx')
    await oshu.connect()
    
    task = await oshu.agents.submit('agent-id', SubmitOptions(
        prompt='Long running analysis task'
    ))
    
    # Listen to real-time events
    task.on('stdout', lambda data: print(data, end=''))
    task.on('tool_start', lambda tool, _: print(f'Using tool: {tool}'))
    task.on('tool_end', lambda tool, _, duration: print(f'{tool} completed in {duration}ms'))
    task.on('status', lambda status: print(f'Status: {status}'))
    
    # Cancel if needed
    # await asyncio.sleep(60)
    # await task.cancel()
    
    # Wait for final result
    try:
        result = await task.result()
        print('Completed:', result.output)
    except TaskCancelledError:
        print('Task was cancelled')
    
    await oshu.disconnect()

asyncio.run(main())
```

### List Agents

```python
agents = await oshu.agents.list()
for agent in agents:
    print(f"{agent.name} ({agent.id})")
    print(f"  Type: {agent.type}")
    print(f"  Provider: {agent.provider}")
```

### Context Manager

```python
async with Oshu(api_key='oshu_xxx') as oshu:
    result = await oshu.agents.run('agent-id', RunOptions(prompt='Hello'))
    print(result.output)
# Automatically disconnects when done
```

## Error Handling

```python
from oshu import (
    Oshu,
    OshuError,
    TaskCancelledError,
    TaskFailedError,
    TaskTimeoutError,
    AuthenticationError,
)

try:
    result = await oshu.agents.run('agent-id', RunOptions(prompt='...'))
except TaskCancelledError:
    print('Task was cancelled')
except TaskFailedError as e:
    print(f'Task failed: {e.task_error}')
except TaskTimeoutError as e:
    print(f'Task timed out after {e.timeout}s')
except AuthenticationError:
    print('Invalid API key')
except OshuError as e:
    print(f'Oshu error: {e} (code: {e.code})')
```

## Configuration

```python
oshu = Oshu(
    api_key='oshu_xxx',           # Required: Your API key
    base_url='https://api.oshu.dev',  # Optional: API base URL
    timeout=600.0,                # Optional: Default timeout (10 min)
)
```

## API Reference

### `Oshu`

Main client class.

- `__init__(api_key, base_url, timeout)` - Create a new client
- `connect()` - Connect to Oshu (required before using)
- `disconnect()` - Disconnect from Oshu
- `is_connected()` - Check connection status
- `agents` - Access agents resource

### `AgentsResource`

Resource for interacting with agents.

- `list()` - List all agents
- `get(agent_id)` - Get a specific agent
- `run(agent_id, options)` - Run a task and wait
- `submit(agent_id, options)` - Submit a task (non-blocking)

### `TaskHandle`

Handle for managing a submitted task.

- `id` - Task ID
- `agent_id` - Agent ID
- `on(event, handler)` - Listen to events ('stdout', 'stderr', 'tool_start', 'tool_end', 'status')
- `cancel()` - Cancel the task
- `result()` - Wait for the result
- `get_status()` - Get current status
- `is_finished()` - Check if task is done
- `stream()` - Iterate over events (sync generator)

### Types

- `RunOptions` - Options for running a task
- `SubmitOptions` - Options for submitting a task
- `TaskResult` - Result of a completed task
- `Agent` - Agent information
- `TaskStatus` - Task status enum

## Requirements

- Python 3.9+
- websockets
- httpx

## License

MIT
