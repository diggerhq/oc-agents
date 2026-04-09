"""
WebSocket client with auto-reconnect for Oshu SDK
"""

import json
import asyncio
import threading
from typing import Optional, Callable, Dict, Any, List
from urllib.parse import urlparse

try:
    import websockets
    from websockets.client import WebSocketClientProtocol
except ImportError:
    websockets = None

from .errors import ConnectionError, AuthenticationError


class WebSocketClient:
    """WebSocket client with auto-reconnect"""
    
    def __init__(
        self,
        api_key: str,
        base_url: str,
        reconnect: bool = True,
        reconnect_interval: float = 1.0,
        max_reconnect_attempts: int = 10,
    ):
        if websockets is None:
            raise ImportError("websockets package is required. Install with: pip install websockets")
        
        self.api_key = api_key
        self.base_url = base_url
        self.reconnect = reconnect
        self.reconnect_interval = reconnect_interval
        self.max_reconnect_attempts = max_reconnect_attempts
        
        self._ws: Optional[WebSocketClientProtocol] = None
        self._connection_id: Optional[str] = None
        self._reconnect_attempts = 0
        self._should_reconnect = True
        self._connected = False
        self._listeners: Dict[str, List[Callable]] = {}
        self._receive_task: Optional[asyncio.Task] = None
        self._ping_task: Optional[asyncio.Task] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
    
    def _get_ws_url(self) -> str:
        """Get WebSocket URL from base URL"""
        parsed = urlparse(self.base_url)
        ws_scheme = 'wss' if parsed.scheme == 'https' else 'ws'
        return f"{ws_scheme}://{parsed.netloc}/ws/v1/tasks?apiKey={self.api_key}"
    
    async def connect(self) -> None:
        """Connect to the WebSocket server"""
        if self._connected:
            return
        
        self._should_reconnect = True
        self._loop = asyncio.get_event_loop()
        
        try:
            self._ws = await websockets.connect(self._get_ws_url())
            self._connected = True
            self._reconnect_attempts = 0
            
            # Start receive loop
            self._receive_task = asyncio.create_task(self._receive_loop())
            
            # Start ping loop
            self._ping_task = asyncio.create_task(self._ping_loop())
            
            # Wait for connected message
            await self._wait_for_connected()
            
        except Exception as e:
            self._connected = False
            raise ConnectionError(str(e))
    
    async def _wait_for_connected(self) -> None:
        """Wait for the connected message from server"""
        future = asyncio.Future()
        
        def on_connected(msg):
            if not future.done():
                future.set_result(msg)
        
        self.on('connected', on_connected)
        
        try:
            await asyncio.wait_for(future, timeout=10.0)
        except asyncio.TimeoutError:
            raise ConnectionError("Timeout waiting for connection")
        finally:
            self.off('connected', on_connected)
    
    async def _receive_loop(self) -> None:
        """Receive messages from WebSocket"""
        try:
            async for message in self._ws:
                try:
                    data = json.loads(message)
                    await self._handle_message(data)
                except json.JSONDecodeError:
                    pass
        except websockets.ConnectionClosed as e:
            self._connected = False
            if e.code == 4001:
                self._emit('error', AuthenticationError(str(e.reason)))
                return
            
            self._emit('disconnected', {'code': e.code, 'reason': str(e.reason)})
            
            if self._should_reconnect and self.reconnect:
                await self._schedule_reconnect()
        except Exception as e:
            self._connected = False
            self._emit('error', e)
    
    async def _ping_loop(self) -> None:
        """Send periodic pings"""
        while self._connected:
            try:
                await asyncio.sleep(30)
                if self._connected:
                    await self.send({'type': 'ping'})
            except Exception:
                break
    
    async def _handle_message(self, data: Dict[str, Any]) -> None:
        """Handle incoming message"""
        msg_type = data.get('type', '')
        
        if msg_type == 'connected':
            self._connection_id = data.get('connectionId')
            self._emit('connected', data)
        elif msg_type == 'error':
            self._emit('server_error', data)
        elif msg_type == 'pong':
            pass  # Heartbeat response
        else:
            self._emit('message', data)
            self._emit(msg_type, data)
    
    async def _schedule_reconnect(self) -> None:
        """Schedule a reconnection attempt"""
        if self._reconnect_attempts >= self.max_reconnect_attempts:
            return
        
        self._reconnect_attempts += 1
        delay = self.reconnect_interval * (2 ** (self._reconnect_attempts - 1))
        
        await asyncio.sleep(delay)
        
        if self._should_reconnect:
            try:
                await self.connect()
            except Exception:
                pass
    
    async def send(self, message: Dict[str, Any]) -> None:
        """Send a message to the server"""
        if not self._ws or not self._connected:
            raise ConnectionError("WebSocket not connected")
        
        await self._ws.send(json.dumps(message))
    
    async def submit(
        self, 
        agent_id: str, 
        prompt: str, 
        priority: int = 0,
        sdk_session_id: Optional[str] = None,
        provision: bool = False
    ) -> None:
        """Submit a task with optional SDK session support"""
        message = {
            'type': 'submit',
            'agentId': agent_id,
            'prompt': prompt,
            'priority': priority,
        }
        if sdk_session_id:
            message['sdkSessionId'] = sdk_session_id
        if provision:
            message['provision'] = True
        await self.send(message)
    
    async def cancel(self, task_id: str) -> None:
        """Cancel a task"""
        await self.send({'type': 'cancel', 'taskId': task_id})
    
    async def subscribe(self, task_id: str) -> None:
        """Subscribe to task events"""
        await self.send({'type': 'subscribe', 'taskId': task_id})
    
    async def unsubscribe(self, task_id: str) -> None:
        """Unsubscribe from task events"""
        await self.send({'type': 'unsubscribe', 'taskId': task_id})
    
    async def disconnect(self) -> None:
        """Disconnect from the server"""
        self._should_reconnect = False
        self._connected = False
        
        if self._ping_task:
            self._ping_task.cancel()
            self._ping_task = None
        
        if self._receive_task:
            self._receive_task.cancel()
            self._receive_task = None
        
        if self._ws:
            await self._ws.close()
            self._ws = None
        
        self._connection_id = None
    
    def on(self, event: str, callback: Callable) -> None:
        """Register event listener"""
        if event not in self._listeners:
            self._listeners[event] = []
        self._listeners[event].append(callback)
    
    def off(self, event: str, callback: Callable) -> None:
        """Remove event listener"""
        if event in self._listeners:
            try:
                self._listeners[event].remove(callback)
            except ValueError:
                pass
    
    def _emit(self, event: str, data: Any) -> None:
        """Emit event to listeners"""
        if event in self._listeners:
            for callback in self._listeners[event]:
                try:
                    callback(data)
                except Exception:
                    pass
    
    def is_connected(self) -> bool:
        """Check if connected"""
        return self._connected
    
    def get_connection_id(self) -> Optional[str]:
        """Get connection ID"""
        return self._connection_id
