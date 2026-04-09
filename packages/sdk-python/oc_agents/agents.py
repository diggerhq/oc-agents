"""
Agents resource for OC Agents SDK
"""

import json
import asyncio
from typing import List, TypeVar, Generic, Optional, Any, Dict

try:
    import httpx
except ImportError:
    httpx = None

from .types import Agent, TaskResult, RunOptions, SubmitOptions, SdkSession
from .task import TaskHandle
from .errors import OCError

T = TypeVar('T')


class AgentsResource:
    """Resource for interacting with agents"""
    
    def __init__(
        self,
        ws_client: Any,  # WebSocketClient
        base_url: str,
        api_key: str,
        default_timeout: float,
    ):
        if httpx is None:
            raise ImportError("httpx package is required. Install with: pip install httpx")
        
        self._ws_client = ws_client
        self._base_url = base_url
        self._api_key = api_key
        self._default_timeout = default_timeout
        self._http_client = httpx.AsyncClient(
            headers={'Authorization': f'Bearer {api_key}'},
            timeout=30.0,
        )
    
    async def list(self) -> List[Agent]:
        """List all agents accessible via API"""
        response = await self._http_client.get(f'{self._base_url}/api/v1/agents')
        
        if response.status_code != 200:
            try:
                error = response.json()
                raise OCError(error.get('error', 'Failed to list agents'), 'LIST_AGENTS_FAILED')
            except json.JSONDecodeError:
                raise OCError(response.text, 'LIST_AGENTS_FAILED')
        
        data = response.json()
        return [
            Agent(
                id=agent['id'],
                name=agent['name'],
                type=agent.get('agent_type', 'task'),
                provider=agent.get('provider', 'claude-code'),
                model=agent.get('model'),
                output_schema=json.loads(agent['output_schema']) if agent.get('output_schema') else None,
                api_enabled=agent.get('api_enabled', True),
                created_at=agent.get('created_at'),
            )
            for agent in data.get('agents', [])
        ]
    
    async def get(self, agent_id: str) -> Agent:
        """Get a specific agent"""
        response = await self._http_client.get(f'{self._base_url}/api/v1/agents/{agent_id}')
        
        if response.status_code != 200:
            try:
                error = response.json()
                raise OCError(error.get('error', 'Failed to get agent'), 'GET_AGENT_FAILED')
            except json.JSONDecodeError:
                raise OCError(response.text, 'GET_AGENT_FAILED')
        
        agent = response.json()
        return Agent(
            id=agent['id'],
            name=agent['name'],
            type=agent.get('agent_type', 'task'),
            provider=agent.get('provider', 'claude-code'),
            model=agent.get('model'),
            output_schema=json.loads(agent['output_schema']) if agent.get('output_schema') else None,
            api_enabled=agent.get('api_enabled', True),
            created_at=agent.get('created_at'),
        )
    
    async def new(self, agent_id: str) -> SdkSession:
        """
        Create a new SDK session for isolated sandbox access.
        This allows multiple isolated sandboxes for the same agent.
        
        Args:
            agent_id: The agent to create a session for
            
        Returns:
            SdkSession with session_id to use in run/submit calls
        """
        response = await self._http_client.post(f'{self._base_url}/api/v1/agents/{agent_id}/sessions')
        
        if response.status_code != 200:
            try:
                error = response.json()
                raise OCError(error.get('error', 'Failed to create session'), 'CREATE_SESSION_FAILED')
            except json.JSONDecodeError:
                raise OCError(response.text, 'CREATE_SESSION_FAILED')
        
        data = response.json()
        return SdkSession(
            id=data['sessionId'],
            agent_id=agent_id,
            sandbox_id=data.get('sandboxId'),
            status='active',
            created_at=data['createdAt'],
            last_used_at=data.get('lastUsedAt', data['createdAt']),
        )
    
    async def close_session(self, agent_id: str, session_id: str) -> Dict[str, Any]:
        """
        Close an SDK session and cleanup its sandbox.
        
        Args:
            agent_id: The agent the session belongs to
            session_id: The session ID to close
            
        Returns:
            Dict with 'success' and optional 'error' keys
        """
        response = await self._http_client.delete(f'{self._base_url}/api/v1/agents/{agent_id}/sessions/{session_id}')
        
        if response.status_code != 200:
            try:
                error = response.json()
                return {
                    'success': False,
                    'error': error.get('error', f'HTTP {response.status_code}: {response.reason_phrase}')
                }
            except json.JSONDecodeError:
                return {
                    'success': False,
                    'error': f'HTTP {response.status_code}: {response.reason_phrase}'
                }
        
        return {'success': True}
    
    async def submit(self, agent_id: str, options: SubmitOptions) -> TaskHandle[Any]:
        """
        Submit a task and return a handle (non-blocking)
        
        Args:
            agent_id: The agent to run the task on
            options: Task options including prompt, timeout, session_id, and provision
            
        Returns:
            TaskHandle for monitoring and getting results
        """
        timeout = options.timeout or self._default_timeout
        
        # Create future to wait for task_created event
        task_created_future: asyncio.Future = asyncio.get_event_loop().create_future()
        
        def on_message(msg: Dict[str, Any]):
            if msg.get('type') == 'task_created' and msg.get('agentId') == agent_id:
                if not task_created_future.done():
                    task_created_future.set_result(msg)
        
        def on_error(msg: Dict[str, Any]):
            if not task_created_future.done():
                task_created_future.set_exception(OCError(msg.get('message', 'Submit failed'), 'SUBMIT_FAILED'))
        
        self._ws_client.on('message', on_message)
        self._ws_client.on('server_error', on_error)
        
        try:
            # Submit the task with optional session options
            await self._ws_client.submit(
                agent_id, 
                options.prompt, 
                options.priority,
                options.session_id,
                options.provision
            )
            
            # Wait for task_created event
            msg = await asyncio.wait_for(task_created_future, timeout=30.0)
            
            # Create task handle (with session_id if created/used)
            return TaskHandle(
                task_id=msg['taskId'],
                agent_id=agent_id,
                ws_client=self._ws_client,
                timeout=timeout,
                session_id=msg.get('sdkSessionId'),
            )
        finally:
            self._ws_client.off('message', on_message)
            self._ws_client.off('server_error', on_error)
    
    async def run(self, agent_id: str, options: RunOptions) -> TaskResult[Any]:
        """
        Run a task and wait for completion (blocking)
        
        Args:
            agent_id: The agent to run the task on
            options: Task options including prompt, timeout, and session_id
            
        Returns:
            Task result with output
        """
        submit_options = SubmitOptions(
            prompt=options.prompt,
            priority=options.priority,
            timeout=options.timeout,
            session_id=options.session_id,
        )
        handle = await self.submit(agent_id, submit_options)
        return await handle.result()
    
    async def warmup(self, agent_id: str) -> Dict[str, Any]:
        """
        Warm up sandbox for an agent (improves first-request performance)
        
        Returns dict with:
            - success: bool
            - sandbox_id: ID of the sandbox
            - status: 'created' (new sandbox) | 'extended' (existing sandbox, lifetime extended)
            - error: error message if failed
        """
        response = await self._http_client.post(f'{self._base_url}/api/agent/agents/{agent_id}/warmup')
        
        if response.status_code != 200:
            try:
                error = response.json()
                return {
                    'success': False,
                    'error': error.get('error', f'HTTP {response.status_code}: {response.reason_phrase}')
                }
            except json.JSONDecodeError:
                return {
                    'success': False,
                    'error': f'HTTP {response.status_code}: {response.reason_phrase}'
                }
        
        result = response.json()
        return {
            'success': result.get('success', False),
            'sandbox_id': result.get('sandboxId'),
            'status': result.get('status'),  # 'created' or 'extended'
            'error': result.get('error')
        }
    
    async def warmup_multiple(self, agent_ids: List[str]) -> Dict[str, Any]:
        """Warm up sandboxes for multiple agents in parallel"""
        response = await self._http_client.post(
            f'{self._base_url}/api/agent/agents/warmup',
            json={'agentIds': agent_ids}
        )
        
        if response.status_code != 200:
            try:
                error = response.json()
                raise OCError(error.get('error', 'Failed to warm up agents'), 'WARMUP_FAILED')
            except json.JSONDecodeError:
                raise OCError(f'HTTP {response.status_code}: {response.reason_phrase}', 'WARMUP_FAILED')
        
        result = response.json()
        return {
            'success': result.get('success', False),
            'results': result.get('results', [])
        }
    
    async def close(self) -> None:
        """Close the HTTP client"""
        await self._http_client.aclose()
