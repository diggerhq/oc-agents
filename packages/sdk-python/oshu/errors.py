"""
Oshu SDK Errors
"""


class OshuError(Exception):
    """Base error class for Oshu SDK"""
    
    def __init__(self, message: str, code: str = 'OSHU_ERROR'):
        super().__init__(message)
        self.code = code


class TaskCancelledError(OshuError):
    """Error raised when a task is cancelled"""
    
    def __init__(self, task_id: str):
        super().__init__(f"Task {task_id} was cancelled", 'TASK_CANCELLED')
        self.task_id = task_id


class TaskFailedError(OshuError):
    """Error raised when a task fails"""
    
    def __init__(self, task_id: str, error: str):
        super().__init__(f"Task {task_id} failed: {error}", 'TASK_FAILED')
        self.task_id = task_id
        self.task_error = error


class TaskTimeoutError(OshuError):
    """Error raised when a task times out"""
    
    def __init__(self, task_id: str, timeout: float):
        super().__init__(f"Task {task_id} timed out after {timeout}s", 'TASK_TIMEOUT')
        self.task_id = task_id
        self.timeout = timeout


class ConnectionError(OshuError):
    """Error raised when WebSocket connection fails"""
    
    def __init__(self, message: str):
        super().__init__(message, 'CONNECTION_ERROR')


class AuthenticationError(OshuError):
    """Error raised for authentication failures"""
    
    def __init__(self, message: str = 'Invalid API key'):
        super().__init__(message, 'AUTHENTICATION_ERROR')


class AgentNotFoundError(OshuError):
    """Error raised when an agent is not found"""
    
    def __init__(self, agent_id: str):
        super().__init__(f"Agent {agent_id} not found", 'AGENT_NOT_FOUND')
        self.agent_id = agent_id
