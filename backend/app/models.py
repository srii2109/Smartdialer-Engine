"""Data models, Enums, and schemas for SmartDialer."""

from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class AgentState(str, Enum):
    OFFLINE = "OFFLINE"
    AVAILABLE = "AVAILABLE"
    RESERVED = "RESERVED"
    DIALING = "DIALING"
    CONNECTED = "CONNECTED"
    WRAP_UP = "WRAP_UP"
    PAUSED = "PAUSED"


class CallState(str, Enum):
    QUEUED = "QUEUED"
    RESERVED = "RESERVED"
    INITIATED = "INITIATED"
    RINGING = "RINGING"
    ANSWERED = "ANSWERED"
    CONNECTED = "CONNECTED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class DialingMode(str, Enum):
    PROGRESSIVE = "PROGRESSIVE"
    PREDICTIVE = "PREDICTIVE"


class SafetyDecisionType(str, Enum):
    APPROVED = "APPROVED"
    REDUCED = "REDUCED"
    REJECTED = "REJECTED"
    PROGRESSIVE_FALLBACK = "PROGRESSIVE_FALLBACK"


class AgentModel(BaseModel):
    id: str
    name: str
    state: AgentState
    worker_id: Optional[str] = None
    reserved_at: Optional[str] = None
    last_heartbeat: Optional[str] = None
    version: int
    total_calls: int = 0
    total_talk_time_sec: float = 0.0


class CallModel(BaseModel):
    id: str
    borrower_id: str
    agent_id: Optional[str] = None
    worker_id: Optional[str] = None
    provider_id: str
    provider_call_id: Optional[str] = None
    state: CallState
    mode: DialingMode
    created_at: Optional[str] = None
    initiated_at: Optional[str] = None
    answered_at: Optional[str] = None
    connected_at: Optional[str] = None
    ended_at: Optional[str] = None
    talk_time_sec: float = 0.0
    error_reason: Optional[str] = None
    version: int


class BorrowerModel(BaseModel):
    id: str
    name: str
    phone: str
    priority: int
    state: str
    attempts: int
    last_attempt_at: Optional[str] = None
    version: int


class SafetyEvaluationResult(BaseModel):
    decision: SafetyDecisionType
    requested_calls: int
    approved_calls: int
    reason: str
    available_agents: int
    ringing_calls: int
    provider_health_pct: float
    abandonment_risk_pct: float


class ProviderEvent(BaseModel):
    event_id: str
    call_id: str
    event_type: str
    provider_id: str
    timestamp: Optional[str] = None
    error: Optional[str] = None


class SystemStatus(BaseModel):
    mode: DialingMode
    active_provider: str
    is_running: bool
    total_agents: int
    available_agents: int
    reserved_agents: int
    dialing_agents: int
    connected_agents: int
    wrap_up_agents: int
    paused_agents: int
    offline_agents: int
    active_calls: int
    ringing_calls: int
    completed_calls: int
    failed_calls: int
    abandoned_calls: int
    agent_utilization_pct: float
    abandonment_rate_pct: float
    safety_interventions_count: int
    last_safety_decision: Optional[Dict[str, Any]] = None
