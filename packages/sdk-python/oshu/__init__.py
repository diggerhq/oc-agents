"""
Oshu SDK for Python

Example:
    ```python
    import asyncio
    from oshu import Oshu, RunOptions
    
    async def main():
        oshu = Oshu(api_key='flt_xxx')
        await oshu.connect()
        
        # Simple: run and wait for result
        result = await oshu.agents.run('agent-id', RunOptions(
            prompt='Analyze this data'
        ))
        print(result.output)
        
        # Advanced: stream events and control task
        task = await oshu.agents.submit('agent-id', SubmitOptions(
            prompt='Long running task'
        ))
        task.on('stdout', print)
        task.on('tool_start', lambda tool, _: print(f'Using {tool}...'))
        
        # Cancel if needed
        # await task.cancel()
        
        # Wait for final result
        result = await task.result()
        
        await oshu.disconnect()
    
    asyncio.run(main())
    ```
"""

__version__ = '0.1.0'

# Main client
from .client import Oshu

# Task handle
from .task import TaskHandle

# Types
from .types import (
    OshuConfig,
    Agent,
    AgentType,
    AgentProvider,
    TaskResult,
    TaskStatus,
    RunOptions,
    SubmitOptions,
)

# Errors
from .errors import (
    OshuError,
    TaskCancelledError,
    TaskFailedError,
    TaskTimeoutError,
    ConnectionError,
    AuthenticationError,
    AgentNotFoundError,
)

__all__ = [
    # Client
    'Oshu',
    
    # Task
    'TaskHandle',
    
    # Types
    'OshuConfig',
    'Agent',
    'AgentType',
    'AgentProvider',
    'TaskResult',
    'TaskStatus',
    'RunOptions',
    'SubmitOptions',
    
    # Errors
    'OshuError',
    'TaskCancelledError',
    'TaskFailedError',
    'TaskTimeoutError',
    'ConnectionError',
    'AuthenticationError',
    'AgentNotFoundError',
]
