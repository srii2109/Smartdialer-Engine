"""Tests for the Agent State Machine."""

import pytest
from app.models import AgentState
from app.state_machines import AgentStateMachine, InvalidStateTransitionError


def test_valid_agent_lifecycle():
    # OFFLINE -> AVAILABLE
    assert AgentStateMachine.can_transition(AgentState.OFFLINE, AgentState.AVAILABLE)
    assert AgentStateMachine.transition(AgentState.OFFLINE, AgentState.AVAILABLE) == AgentState.AVAILABLE

    # AVAILABLE -> RESERVED
    assert AgentStateMachine.can_transition(AgentState.AVAILABLE, AgentState.RESERVED)
    assert AgentStateMachine.transition(AgentState.AVAILABLE, AgentState.RESERVED) == AgentState.RESERVED

    # RESERVED -> DIALING
    assert AgentStateMachine.can_transition(AgentState.RESERVED, AgentState.DIALING)
    assert AgentStateMachine.transition(AgentState.RESERVED, AgentState.DIALING) == AgentState.DIALING

    # DIALING -> CONNECTED
    assert AgentStateMachine.can_transition(AgentState.DIALING, AgentState.CONNECTED)
    assert AgentStateMachine.transition(AgentState.DIALING, AgentState.CONNECTED) == AgentState.CONNECTED

    # CONNECTED -> WRAP_UP
    assert AgentStateMachine.can_transition(AgentState.CONNECTED, AgentState.WRAP_UP)
    assert AgentStateMachine.transition(AgentState.CONNECTED, AgentState.WRAP_UP) == AgentState.WRAP_UP

    # WRAP_UP -> AVAILABLE
    assert AgentStateMachine.can_transition(AgentState.WRAP_UP, AgentState.AVAILABLE)
    assert AgentStateMachine.transition(AgentState.WRAP_UP, AgentState.AVAILABLE) == AgentState.AVAILABLE


def test_invalid_agent_transitions():
    # Cannot jump from OFFLINE directly to CONNECTED
    assert not AgentStateMachine.can_transition(AgentState.OFFLINE, AgentState.CONNECTED)
    with pytest.raises(InvalidStateTransitionError):
        AgentStateMachine.transition(AgentState.OFFLINE, AgentState.CONNECTED)

    # Cannot jump from AVAILABLE directly to CONNECTED without reservation/dialing
    assert not AgentStateMachine.can_transition(AgentState.AVAILABLE, AgentState.CONNECTED)
    with pytest.raises(InvalidStateTransitionError):
        AgentStateMachine.transition(AgentState.AVAILABLE, AgentState.CONNECTED)

    # Paused agents cannot directly connect
    assert not AgentStateMachine.can_transition(AgentState.PAUSED, AgentState.CONNECTED)


def test_agent_abort_or_unanswered():
    # Dialing when call fails or borrower doesn't answer -> can return to AVAILABLE
    assert AgentStateMachine.can_transition(AgentState.DIALING, AgentState.AVAILABLE)
    # Reserved agent abort -> can return to AVAILABLE
    assert AgentStateMachine.can_transition(AgentState.RESERVED, AgentState.AVAILABLE)
