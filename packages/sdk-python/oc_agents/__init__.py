"""
OC Agents SDK for Python

Example:
    ```python
    import asyncio
    from oc_agents import OCAgents, RunOptions
    
    async def main():
        client = OCAgents(api_key='flt_xxx')
        await client.connect()
        
        # Simple: run and wait for result
        result = await client.agents.run('agent-id', RunOptions(
            prompt='Analyze this data'
        ))
        print(result.output)
        
        # Advanced: stream events and control task
        task = await client.agents.submit('agent-id', SubmitOptions(
            prompt='Long running task'
        ))
        task.on('stdout', print)
        task.on('tool_start', lambda tool, _: print(f'Using {tool}...'))
        
        # Cancel if needed
        # await task.cancel()
        
        # Wait for final result
        result = await task.result()
        
        await client.disconnect()
    
    asyncio.run(main())
    ```
"""

__version__ = '0.1.0'

# Main client
from .client import OCAgents

# Task handle
from .task import TaskHandle

# Types
from .types import (
    OCAgentsConfig,
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
    OCError,
    TaskCancelledError,
    TaskFailedError,
    TaskTimeoutError,
    ConnectionError,
    AuthenticationError,
    AgentNotFoundError,
)

__all__ = [
    # Client
    'OCAgents',
    
    # Task
    'TaskHandle',
    
    # Types
    'OCAgentsConfig',
    'Agent',
    'AgentType',
    'AgentProvider',
    'TaskResult',
    'TaskStatus',
    'RunOptions',
    'SubmitOptions',
    
    # Errors
    'OCError',
    'TaskCancelledError',
    'TaskFailedError',
    'TaskTimeoutError',
    'ConnectionError',
    'AuthenticationError',
    'AgentNotFoundError',
]
