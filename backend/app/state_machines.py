"""Agent and Call State Machine implementations with transition enforcement,
monotonic event precedence, duplicate suppression, and out-of-order handling.
"""

from typing import Set, Dict, Optional, Tuple
import logging
from app.models import AgentState, CallState

logger = logging.getLogger("smartdialer.state_machines")

# Valid Agent Transitions
AGENT_ALLOWED_TRANSITIONS: Dict[AgentState, Set[AgentState]] = {
    AgentState.OFFLINE: {AgentState.AVAILABLE},
    AgentState.AVAILABLE: {AgentState.RESERVED, AgentState.PAUSED, AgentState.OFFLINE},
    AgentState.RESERVED: {AgentState.DIALING, AgentState.AVAILABLE, AgentState.PAUSED},
    AgentState.DIALING: {AgentState.CONNECTED, AgentState.WRAP_UP, AgentState.AVAILABLE, AgentState.FAILED if hasattr(AgentState, 'FAILED') else AgentState.AVAILABLE},
    AgentState.CONNECTED: {AgentState.WRAP_UP, AgentState.AVAILABLE},
    AgentState.WRAP_UP: {AgentState.AVAILABLE, AgentState.PAUSED, AgentState.OFFLINE},
    AgentState.PAUSED: {AgentState.AVAILABLE, AgentState.OFFLINE},
}

# Monotonic precedence ranking for call states to handle out-of-order provider webhooks
CALL_STATE_PRECEDENCE: Dict[CallState, int] = {
    CallState.QUEUED: 10,
    CallState.RESERVED: 20,
    CallState.INITIATED: 30,
    CallState.RINGING: 40,
    CallState.ANSWERED: 50,
    CallState.CONNECTED: 60,
    CallState.COMPLETED: 100,
    CallState.FAILED: 100,
    CallState.CANCELLED: 100,
}

# Valid forward transitions for Call State
CALL_ALLOWED_TRANSITIONS: Dict[CallState, Set[CallState]] = {
    CallState.QUEUED: {CallState.RESERVED, CallState.CANCELLED},
    CallState.RESERVED: {CallState.INITIATED, CallState.CANCELLED},
    CallState.INITIATED: {CallState.RINGING, CallState.ANSWERED, CallState.FAILED, CallState.CANCELLED},
    CallState.RINGING: {CallState.ANSWERED, CallState.FAILED, CallState.CANCELLED},
    CallState.ANSWERED: {CallState.CONNECTED, CallState.COMPLETED, CallState.FAILED},
    CallState.CONNECTED: {CallState.COMPLETED, CallState.FAILED},
    CallState.COMPLETED: set(),
    CallState.FAILED: set(),
    CallState.CANCELLED: set(),
}


class InvalidStateTransitionError(Exception):
    """Raised when an illegal transition is attempted that cannot be safely reconciled."""
    pass


class AgentStateMachine:
    """Enforces valid lifecycle transitions for agents."""

    @staticmethod
    def can_transition(current: AgentState, target: AgentState) -> bool:
        if current == target:
            return True
        allowed = AGENT_ALLOWED_TRANSITIONS.get(current, set())
        return target in allowed

    @staticmethod
    def transition(current: AgentState, target: AgentState) -> AgentState:
        if current == target:
            return target
        if not AgentStateMachine.can_transition(current, target):
            raise InvalidStateTransitionError(
                f"Illegal agent transition: {current.value} -> {target.value}. Allowed from {current.value}: {[s.value for s in AGENT_ALLOWED_TRANSITIONS.get(current, set())]}"
            )
        return target


class CallStateMachine:
    """Enforces call lifecycle with out-of-order tolerance and idempotent deduplication."""

    @staticmethod
    def can_transition(current: CallState, target: CallState) -> bool:
        if current == target:
            return True
        allowed = CALL_ALLOWED_TRANSITIONS.get(current, set())
        return target in allowed

    @staticmethod
    def transition_with_event(
        current_state: CallState,
        incoming_state: CallState,
        event_id: Optional[str] = None
    ) -> Tuple[CallState, bool, str]:
        """Evaluates incoming state against current state.
        
        Returns:
            (new_state, is_transition_applied, note)
            
        Handles:
        1. Duplicate events (e.g. ANSWERED after ANSWERED) -> idempotent no-op.
        2. Out-of-order events (e.g. RINGING arriving after ANSWERED or COMPLETED) -> ignored with note.
        3. Valid progressive transitions -> applied.
        """
        # 1. Exact duplicate event
        if current_state == incoming_state:
            return (
                current_state,
                False,
                f"Duplicate event {incoming_state.value} ignored (idempotent no-op)."
            )

        # 2. Terminal state protection: terminal states can NEVER be overwritten by earlier events
        curr_precedence = CALL_STATE_PRECEDENCE[current_state]
        inc_precedence = CALL_STATE_PRECEDENCE[incoming_state]

        if curr_precedence >= 100:
            return (
                current_state,
                False,
                f"Late out-of-order event {incoming_state.value} ignored: Call is already in terminal state {current_state.value}."
            )

        # 3. Out-of-order event arriving after a later state
        if inc_precedence < curr_precedence:
            return (
                current_state,
                False,
                f"Out-of-order event {incoming_state.value} (precedence {inc_precedence}) ignored: Call is already at {current_state.value} (precedence {curr_precedence})."
            )

        # 4. Valid transition check
        if incoming_state in CALL_ALLOWED_TRANSITIONS.get(current_state, set()):
            return (incoming_state, True, f"Transition applied: {current_state.value} -> {incoming_state.value}")

        # 5. Fast-forward jump (telecom providers sometimes skip RINGING and send ANSWERED immediately)
        if current_state in {CallState.INITIATED, CallState.RESERVED} and incoming_state in {CallState.ANSWERED, CallState.FAILED, CallState.COMPLETED}:
            return (incoming_state, True, f"Fast-forward transition applied from provider jump: {current_state.value} -> {incoming_state.value}")

        raise InvalidStateTransitionError(
            f"Invalid call transition attempted: {current_state.value} -> {incoming_state.value}"
        )
