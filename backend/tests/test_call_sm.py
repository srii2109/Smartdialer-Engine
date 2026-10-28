"""Tests for the Call State Machine, out-of-order webhook delivery, and duplicate suppression."""

import pytest
from app.models import CallState
from app.state_machines import CallStateMachine, InvalidStateTransitionError


def test_standard_forward_call_lifecycle():
    state = CallState.QUEUED
    state, applied, _ = CallStateMachine.transition_with_event(state, CallState.RESERVED)
    assert applied and state == CallState.RESERVED

    state, applied, _ = CallStateMachine.transition_with_event(state, CallState.INITIATED)
    assert applied and state == CallState.INITIATED

    state, applied, _ = CallStateMachine.transition_with_event(state, CallState.RINGING)
    assert applied and state == CallState.RINGING

    state, applied, _ = CallStateMachine.transition_with_event(state, CallState.ANSWERED)
    assert applied and state == CallState.ANSWERED

    state, applied, _ = CallStateMachine.transition_with_event(state, CallState.CONNECTED)
    assert applied and state == CallState.CONNECTED

    state, applied, _ = CallStateMachine.transition_with_event(state, CallState.COMPLETED)
    assert applied and state == CallState.COMPLETED


def test_duplicate_event_handling():
    """Requirement: Telecom provider sends ANSWERED, ANSWERED, ANSWERED."""
    state = CallState.RINGING
    state, applied, _ = CallStateMachine.transition_with_event(state, CallState.ANSWERED)
    assert state == CallState.ANSWERED and applied is True

    # Duplicate 1
    state, applied, note = CallStateMachine.transition_with_event(state, CallState.ANSWERED)
    assert state == CallState.ANSWERED
    assert applied is False
    assert "Duplicate" in note

    # Duplicate 2
    state, applied, note = CallStateMachine.transition_with_event(state, CallState.ANSWERED)
    assert state == CallState.ANSWERED
    assert applied is False


def test_out_of_order_event_handling():
    """Requirement: Telecom provider sends COMPLETED, ANSWERED, RINGING."""
    # Start at INITIATED
    state = CallState.INITIATED

    # 1. COMPLETED arrives first
    state, applied, note = CallStateMachine.transition_with_event(state, CallState.COMPLETED)
    assert state == CallState.COMPLETED
    assert applied is True

    # 2. Late ANSWERED arrives
    state, applied, note = CallStateMachine.transition_with_event(state, CallState.ANSWERED)
    assert state == CallState.COMPLETED # Must NOT regress to ANSWERED!
    assert applied is False
    assert "terminal state" in note

    # 3. Late RINGING arrives
    state, applied, note = CallStateMachine.transition_with_event(state, CallState.RINGING)
    assert state == CallState.COMPLETED # Must NOT regress to RINGING!
    assert applied is False
    assert "terminal state" in note


def test_terminal_state_lockdown():
    """Terminal states (COMPLETED, FAILED, CANCELLED) cannot be changed."""
    for term in [CallState.COMPLETED, CallState.FAILED, CallState.CANCELLED]:
        state, applied, _ = CallStateMachine.transition_with_event(term, CallState.RINGING)
        assert state == term
        assert applied is False

        state, applied, _ = CallStateMachine.transition_with_event(term, CallState.ANSWERED)
        assert state == term
        assert applied is False
