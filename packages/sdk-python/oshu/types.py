"""
Oshu SDK Types
"""

from dataclasses import dataclass, field
from typing import Optional, Literal, TypeVar, Generic, Any, Dict, List
from datetime import datetime

# Type aliases
TaskStatus = Literal['pending', 'processing', 'completed', 'failed', 'cancelling', 'cancelled']
AgentType = Literal['code', 'task', 'portal']
AgentProvider = Literal['claude-code', 'aider', 'opencode']

T = TypeVar('T')


@dataclass
class TaskResult(Generic[T]):
    """Result of a completed task"""
    id: str
    agent_id: str
    status: TaskStatus
    result: Optional[str] = None      # Raw text output
    output: Optional[T] = None        # Structured output (if output_schema defined)
    error: Optional[str] = None
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


@dataclass
class Agent:
    """Agent information"""
    id: str
    name: str
    type: AgentType
    provider: AgentProvider
    api_enabled: bool
    model: Optional[str] = None
    output_schema: Optional[Dict[str, Any]] = None
    created_at: Optional[str] = None


@dataclass
class RunOptions:
    """Options for running a task"""
    prompt: str
    priority: int = 0
    timeout: Optional[float] = None  # Max wait time in seconds
    session_id: Optional[str] = None  # SDK session ID for isolated sandbox


@dataclass
class SubmitOptions:
    """Options for submitting a task (non-blocking)"""
    prompt: str
    priority: int = 0
    timeout: Optional[float] = None
    session_id: Optional[str] = None  # SDK session ID for isolated sandbox
    provision: bool = False  # If True, create a new SDK session automatically


@dataclass
class SdkSession:
    """SDK Session for isolated sandbox access"""
    id: str
    agent_id: str
    status: Literal['active', 'closed']
    created_at: str
    last_used_at: str
    sandbox_id: Optional[str] = None


@dataclass
class OshuConfig:
    """Client configuration"""
    api_key: str
    base_url: str = "https://api.oshu.dev"
    timeout: float = 600.0  # 10 minutes default


# WebSocket message types
@dataclass
class ConnectedMessage:
    type: Literal['connected'] = 'connected'
    connection_id: str = ''


@dataclass
class ErrorMessage:
    type: Literal['error'] = 'error'
    message: str = ''
    code: Optional[str] = None


@dataclass
class TaskCreatedMessage:
    type: Literal['task_created'] = 'task_created'
    task_id: str = ''
    agent_id: str = ''
    sdk_session_id: Optional[str] = None
    status: str = 'pending'
    created_at: str = ''


@dataclass
class TaskStartedMessage:
    type: Literal['task_started'] = 'task_started'
    task_id: str = ''
    timestamp: int = 0


@dataclass
class TaskCompletedMessage:
    type: Literal['task_completed'] = 'task_completed'
    task_id: str = ''
    result: Optional[str] = None
    output: Optional[Any] = None
    timestamp: int = 0


@dataclass
class TaskFailedMessage:
    type: Literal['task_failed'] = 'task_failed'
    task_id: str = ''
    error: str = ''
    timestamp: int = 0


@dataclass
class TaskCancelledMessage:
    type: Literal['task_cancelled'] = 'task_cancelled'
    task_id: str = ''
    timestamp: int = 0


@dataclass
class StdoutMessage:
    type: Literal['stdout'] = 'stdout'
    task_id: str = ''
    data: str = ''
    timestamp: int = 0


@dataclass
class StderrMessage:
    type: Literal['stderr'] = 'stderr'
    task_id: str = ''
    data: str = ''
    timestamp: int = 0


@dataclass
class ToolStartMessage:
    type: Literal['tool_start'] = 'tool_start'
    task_id: str = ''
    tool: str = ''
    input: Optional[Any] = None
    timestamp: int = 0


@dataclass
class ToolEndMessage:
    type: Literal['tool_end'] = 'tool_end'
    task_id: str = ''
    tool: str = ''
    output: Optional[Any] = None
    duration: Optional[int] = None
    timestamp: int = 0
