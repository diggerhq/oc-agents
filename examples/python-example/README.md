# Oshu Python SDK Examples

This directory contains examples showing how to use the Oshu Python SDK locally.

## Setup

1. **Install the SDK locally:**
   ```bash
   pip install -e ../../packages/sdk-python/
   ```

2. **Set your API key (optional):**
   ```bash
   export OSHU_API_KEY=flt_your_api_key_here
   ```
   
   Or the examples will use the default test key.

3. **Make sure your Oshu server is running:**
   ```bash
   # In the main project directory
   cd ../../backend
   npm run dev
   ```

## Examples

### 1. Basic Example (`basic_example.py`)
Simple usage - connect, list agents, run a task:
```bash
python basic_example.py
```

### 2. Streaming Example (`streaming_example.py`)
Advanced usage with real-time streaming, event handlers, and cancellation:
```bash
python streaming_example.py
```

### 3. Context Manager Example (`context_manager_example.py`)
Recommended pattern using async context manager for automatic cleanup:
```bash
python context_manager_example.py
```

## Key Features Demonstrated

- ✅ **Connection Management** - Connect/disconnect to WebSocket
- ✅ **Agent Listing** - Get available agents via REST API
- ✅ **Simple Task Execution** - `run()` method that waits for completion
- ✅ **Streaming Tasks** - `submit()` method with real-time updates
- ✅ **Event Handlers** - Listen for stdout, stderr, status changes
- ✅ **Task Cancellation** - Cancel long-running tasks
- ✅ **Context Manager** - Automatic resource cleanup
- ✅ **Error Handling** - Proper exception handling
- ✅ **Timeouts** - Handle long-running tasks with timeouts

## API Reference

### Basic Usage
```python
from oshu import Oshu, RunOptions

# Simple run (blocks until complete)
async with Oshu(api_key='flt_xxx') as oshu:
    result = await oshu.agents.run('agent-id', RunOptions(prompt='Hello'))
    print(result.output)
```

### Advanced Usage
```python
# Streaming with events
task = await oshu.agents.submit('agent-id', RunOptions(prompt='Long task'))

task.on('stdout', lambda data: print(f"Output: {data}"))
task.on('status', lambda status: print(f"Status: {status}"))

result = await task.result()  # Wait for completion
# or
await task.cancel()  # Cancel if needed
```

### Available Events
- `stdout` - Real-time output from the agent
- `stderr` - Error output from the agent  
- `status` - Status changes (processing, completed, failed, etc.)

### Error Handling
```python
from oshu.errors import TaskCancelledError, TaskFailedError, OshuError

try:
    result = await oshu.agents.run('agent-id', RunOptions(prompt='Hello'))
except TaskFailedError as e:
    print(f"Task failed: {e.message}")
except TaskCancelledError:
    print("Task was cancelled")
except OshuError as e:
    print(f"SDK error: {e}")
```