import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentState, CallState } from '../src/models/states.js';
import { AgentStateMachine, CallStateMachine, InvalidStateTransitionError } from '../src/stateMachines.js';

test('Agent State Machine: valid transitions', () => {
  assert.equal(AgentStateMachine.canTransition(AgentState.OFFLINE, AgentState.AVAILABLE), true);
  assert.equal(AgentStateMachine.canTransition(AgentState.AVAILABLE, AgentState.RESERVED), true);
  assert.equal(AgentStateMachine.canTransition(AgentState.RESERVED, AgentState.DIALING), true);
  assert.equal(AgentStateMachine.canTransition(AgentState.DIALING, AgentState.CONNECTED), true);
  assert.equal(AgentStateMachine.canTransition(AgentState.CONNECTED, AgentState.WRAP_UP), true);
  assert.equal(AgentStateMachine.canTransition(AgentState.WRAP_UP, AgentState.AVAILABLE), true);
});

test('Agent State Machine: invalid transitions rejected', () => {
  assert.equal(AgentStateMachine.canTransition(AgentState.OFFLINE, AgentState.CONNECTED), false);
  assert.throws(() => {
    AgentStateMachine.transition(AgentState.OFFLINE, AgentState.CONNECTED);
  }, InvalidStateTransitionError);

  assert.equal(AgentStateMachine.canTransition(AgentState.AVAILABLE, AgentState.CONNECTED), false);
  assert.throws(() => {
    AgentStateMachine.transition(AgentState.AVAILABLE, AgentState.CONNECTED);
  }, InvalidStateTransitionError);
});

test('Call State Machine: forward lifecycle', () => {
  let state = CallState.QUEUED;
  let res = CallStateMachine.transitionWithEvent(state, CallState.RESERVED);
  assert.equal(res.applied, true);
  state = res.newState;

  res = CallStateMachine.transitionWithEvent(state, CallState.INITIATED);
  assert.equal(res.applied, true);
  state = res.newState;

  res = CallStateMachine.transitionWithEvent(state, CallState.RINGING);
  assert.equal(res.applied, true);
  state = res.newState;

  res = CallStateMachine.transitionWithEvent(state, CallState.ANSWERED);
  assert.equal(res.applied, true);
  state = res.newState;

  res = CallStateMachine.transitionWithEvent(state, CallState.CONNECTED);
  assert.equal(res.applied, true);
  state = res.newState;

  res = CallStateMachine.transitionWithEvent(state, CallState.COMPLETED);
  assert.equal(res.applied, true);
  assert.equal(res.newState, CallState.COMPLETED);
});

test('Call State Machine: duplicate webhook events (ANSWERED, ANSWERED, ANSWERED)', () => {
  let state = CallState.RINGING;
  let res = CallStateMachine.transitionWithEvent(state, CallState.ANSWERED);
  assert.equal(res.applied, true);
  assert.equal(res.newState, CallState.ANSWERED);

  // Duplicate 1
  res = CallStateMachine.transitionWithEvent(res.newState, CallState.ANSWERED);
  assert.equal(res.applied, false);
  assert.equal(res.newState, CallState.ANSWERED);
  assert.match(res.note, /Duplicate/);

  // Duplicate 2
  res = CallStateMachine.transitionWithEvent(res.newState, CallState.ANSWERED);
  assert.equal(res.applied, false);
});

test('Call State Machine: out-of-order events (COMPLETED, ANSWERED, RINGING)', () => {
  let state = CallState.INITIATED;

  // 1. COMPLETED arrives first
  let res = CallStateMachine.transitionWithEvent(state, CallState.COMPLETED);
  assert.equal(res.applied, true);
  assert.equal(res.newState, CallState.COMPLETED);

  // 2. Late ANSWERED arrives
  res = CallStateMachine.transitionWithEvent(res.newState, CallState.ANSWERED);
  assert.equal(res.applied, false);
  assert.equal(res.newState, CallState.COMPLETED); // Terminal state protected!

  // 3. Late RINGING arrives
  res = CallStateMachine.transitionWithEvent(res.newState, CallState.RINGING);
  assert.equal(res.applied, false);
  assert.equal(res.newState, CallState.COMPLETED);
});
