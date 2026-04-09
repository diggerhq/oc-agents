"""
OC Agents SDK Client
"""

from typing import Optional

from .types import OCAgentsConfig
from .websocket import WebSocketClient
from .agents import AgentsResource
from .errors import OCError

DEFAULT_BASE_URL = 'https://api.opencomputer.dev'
DEFAULT_TIMEOUT = 600.0  # 10 minutes


class OCAgents:
    """
    OC Agents SDK Client
    
    Example:
        ```python
        import asyncio
        from oc_agents import OCAgents
        
        async def main():
            client = OCAgents(api_key='flt_xxx')
            await client.connect()
            
            result = await client.agents.run('agent-id', prompt='Hello')
            print(result.output)
            
            await client.disconnect()
        
        asyncio.run(main())
        ```
    """
    
    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
    ):
        if not api_key:
            raise OCError('API key is required', 'MISSING_API_KEY')
        
        if not api_key.startswith('flt_'):
            raise OCError('Invalid API key format. API keys must start with "flt_"', 'INVALID_API_KEY')
        
        self._config = OCAgentsConfig(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
        )
        
        self._ws_client = WebSocketClient(
            api_key=api_key,
            base_url=base_url,
        )
        
        self._agents: Optional[AgentsResource] = None
        self._connected = False
    
    async def connect(self) -> None:
        """
        Connect to the OC Agents service.
        Must be called before using the SDK.
        """
        if self._connected:
            return
        
        await self._ws_client.connect()
        self._connected = True
        
        # Initialize agents resource
        self._agents = AgentsResource(
            ws_client=self._ws_client,
            base_url=self._config.base_url,
            api_key=self._config.api_key,
            default_timeout=self._config.timeout,
        )
    
    async def disconnect(self) -> None:
        """Disconnect from the OC Agents service"""
        if self._agents:
            await self._agents.close()
            self._agents = None
        
        await self._ws_client.disconnect()
        self._connected = False
    
    def is_connected(self) -> bool:
        """Check if connected to OC Agents"""
        return self._connected and self._ws_client.is_connected()
    
    @property
    def agents(self) -> AgentsResource:
        """
        Access agents resource.
        
        Example:
            ```python
            # List all agents
            agents = await client.agents.list()
            
            # Run a task (blocking)
            result = await client.agents.run('agent-id', prompt='Hello')
            
            # Submit a task (non-blocking)
            task = await client.agents.submit('agent-id', prompt='Hello')
            task.on('stdout', print)
            result = await task.result()
            ```
        """
        if not self._agents:
            raise OCError('Not connected. Call connect() first.', 'NOT_CONNECTED')
        return self._agents
    
    async def __aenter__(self) -> 'OCAgents':
        """Async context manager entry"""
        await self.connect()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Async context manager exit"""
        await self.disconnect()
