"""
Task handle for managing submitted tasks
"""

import asyncio
from typing import Optional, TypeVar, Generic, Callable, Any, Iterator, Dict
from datetime import datetime

from .types import TaskResult, TaskStatus
from .errors import TaskCancelledError, TaskFailedError, TaskTimeoutError

T = TypeVar('T')


class TaskHandle(Generic[T]):
    """Handle for managing a submitted task"""
    
    def __init__(
        self,
        task_id: str,
        agent_id: str,
        ws_client: Any,  # WebSocketClient
        timeout: float = 600.0,
        session_id: Optional[str] = None,  # SDK session ID if using isolated sandbox
    ):
        self.id = task_id
        self.agent_id = agent_id
        self.session_id = session_id  # SDK session ID for isolated sandbox
        self._ws_client = ws_client
        self._timeout = timeout
        self._status: TaskStatus = 'pending'
        self._result: Optional[TaskResult[T]] = None
        self._listeners: Dict[str, list] = {}
        self._result_future: Optional[asyncio.Future] = None
        
        # Set up message handler
        self._ws_client.on('message', self._handle_message)
    
    def _handle_message(self, message: Dict[str, Any]) -> None:
        """Handle incoming WebSocket message"""
        if message.get('taskId') != self.id:
            return
        
        msg_type = message.get('type', '')
        
        if msg_type == 'task_started':
            self._status = 'processing'
            self._emit('status', 'processing')
        
        elif msg_type == 'stdout':
            self._emit('stdout', message.get('data', ''))
        
        elif msg_type == 'stderr':
            self._emit('stderr', message.get('data', ''))
        
        elif msg_type == 'tool_start':
            self._emit('tool_start', message.get('tool', ''), message.get('input'))
        
        elif msg_type == 'tool_end':
            self._emit('tool_end', message.get('tool', ''), message.get('output'), message.get('duration'))
        
        elif msg_type == 'task_completed':
            self._status = 'completed'
            self._result = TaskResult(
                id=self.id,
                agent_id=self.agent_id,
                status='completed',
                result=message.get('result'),
                output=message.get('output'),
                created_at=datetime.now().isoformat(),
                completed_at=datetime.now().isoformat(),
            )
            self._emit('status', 'completed')
            if self._result_future and not self._result_future.done():
                self._result_future.set_result(self._result)
            self._cleanup()
        
        elif msg_type == 'task_failed':
            self._status = 'failed'
            error = message.get('error', 'Unknown error')
            self._result = TaskResult(
                id=self.id,
                agent_id=self.agent_id,
                status='failed',
                error=error,
                created_at=datetime.now().isoformat(),
                completed_at=datetime.now().isoformat(),
            )
            self._emit('status', 'failed')
            if self._result_future and not self._result_future.done():
                self._result_future.set_exception(TaskFailedError(self.id, error))
            self._cleanup()
        
        elif msg_type == 'task_cancelled':
            self._status = 'cancelled'
            self._result = TaskResult(
                id=self.id,
                agent_id=self.agent_id,
                status='cancelled',
                created_at=datetime.now().isoformat(),
                completed_at=datetime.now().isoformat(),
            )
            self._emit('status', 'cancelled')
            if self._result_future and not self._result_future.done():
                self._result_future.set_exception(TaskCancelledError(self.id))
            self._cleanup()
        
        elif msg_type == 'task_cancelling':
            self._status = 'cancelling'
            self._emit('status', 'cancelling')
        
        elif msg_type == 'task_status':
            status = message.get('status')
            self._status = status
            
            if status == 'completed':
                self._result = TaskResult(
                    id=self.id,
                    agent_id=self.agent_id,
                    status='completed',
                    result=message.get('result'),
                    output=message.get('structuredOutput'),
                    created_at=message.get('createdAt'),
                    started_at=message.get('startedAt'),
                    completed_at=message.get('completedAt'),
                )
                if self._result_future and not self._result_future.done():
                    self._result_future.set_result(self._result)
                self._cleanup()
            elif status == 'failed':
                error = message.get('error', 'Unknown error')
                self._result = TaskResult(
                    id=self.id,
                    agent_id=self.agent_id,
                    status='failed',
                    error=error,
                    created_at=message.get('createdAt'),
                    completed_at=message.get('completedAt'),
                )
                if self._result_future and not self._result_future.done():
                    self._result_future.set_exception(TaskFailedError(self.id, error))
                self._cleanup()
            elif status == 'cancelled':
                self._result = TaskResult(
                    id=self.id,
                    agent_id=self.agent_id,
                    status='cancelled',
                    created_at=message.get('createdAt'),
                    completed_at=message.get('completedAt'),
                )
                if self._result_future and not self._result_future.done():
                    self._result_future.set_exception(TaskCancelledError(self.id))
                self._cleanup()
    
    def _cleanup(self) -> None:
        """Clean up resources"""
        self._ws_client.off('message', self._handle_message)
    
    def on(self, event: str, callback: Callable) -> 'TaskHandle[T]':
        """Register event listener"""
        if event not in self._listeners:
            self._listeners[event] = []
        self._listeners[event].append(callback)
        return self
    
    def _emit(self, event: str, *args) -> None:
        """Emit event to listeners"""
        if event in self._listeners:
            for callback in self._listeners[event]:
                try:
                    callback(*args)
                except Exception:
                    pass
    
    async def cancel(self) -> None:
        """Cancel the task"""
        if self._status in ('completed', 'failed', 'cancelled'):
            return
        await self._ws_client.cancel(self.id)
    
    async def result(self) -> TaskResult[T]:
        """Wait for the task to complete and return the result"""
        # If already have result
        if self._result:
            if self._result.status == 'completed':
                return self._result
            elif self._result.status == 'failed':
                raise TaskFailedError(self.id, self._result.error or 'Unknown error')
            elif self._result.status == 'cancelled':
                raise TaskCancelledError(self.id)
        
        # Create future if not exists
        if not self._result_future:
            self._result_future = asyncio.get_event_loop().create_future()
        
        # Wait with timeout
        try:
            return await asyncio.wait_for(self._result_future, timeout=self._timeout)
        except asyncio.TimeoutError:
            self._cleanup()
            raise TaskTimeoutError(self.id, self._timeout)
    
    def get_status(self) -> TaskStatus:
        """Get current task status"""
        return self._status
    
    def is_finished(self) -> bool:
        """Check if task is finished"""
        return self._status in ('completed', 'failed', 'cancelled')
    
    def stream(self) -> Iterator[Dict[str, Any]]:
        """
        Iterate over task events (synchronous generator).
        Note: For async usage, use event handlers with on() instead.
        """
        import queue
        import threading
        
        event_queue: queue.Queue = queue.Queue()
        finished = threading.Event()
        
        def on_event(msg):
            event_queue.put(msg)
            if msg.get('type') in ('task_completed', 'task_failed', 'task_cancelled'):
                finished.set()
        
        self._ws_client.on('message', on_event)
        
        try:
            while not finished.is_set() or not event_queue.empty():
                try:
                    msg = event_queue.get(timeout=0.1)
                    if msg.get('taskId') == self.id:
                        yield msg
                except queue.Empty:
                    continue
        finally:
            self._ws_client.off('message', on_event)
