import { AgentState, CallState } from './models/states.js';

export class InvalidStateTransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidStateTransitionError';
  }
}

// Valid Agent Transitions
export const AGENT_ALLOWED_TRANSITIONS = {
  [AgentState.OFFLINE]: new Set([AgentState.AVAILABLE]),
  [AgentState.AVAILABLE]: new Set([AgentState.RESERVED, AgentState.PAUSED, AgentState.OFFLINE]),
  [AgentState.RESERVED]: new Set([AgentState.DIALING, AgentState.AVAILABLE, AgentState.PAUSED]),
  [AgentState.DIALING]: new Set([AgentState.CONNECTED, AgentState.WRAP_UP, AgentState.AVAILABLE]),
  [AgentState.CONNECTED]: new Set([AgentState.WRAP_UP, AgentState.AVAILABLE]),
  [AgentState.WRAP_UP]: new Set([AgentState.AVAILABLE, AgentState.PAUSED, AgentState.OFFLINE]),
  [AgentState.PAUSED]: new Set([AgentState.AVAILABLE, AgentState.OFFLINE]),
};

// Monotonic precedence ranking for call states to handle out-of-order webhooks
export const CALL_STATE_PRECEDENCE = {
  [CallState.QUEUED]: 10,
  [CallState.RESERVED]: 20,
  [CallState.INITIATED]: 30,
  [CallState.RINGING]: 40,
  [CallState.ANSWERED]: 50,
  [CallState.CONNECTED]: 60,
  [CallState.COMPLETED]: 100,
  [CallState.FAILED]: 100,
  [CallState.CANCELLED]: 100,
};

// Valid forward transitions for Call State
export const CALL_ALLOWED_TRANSITIONS = {
  [CallState.QUEUED]: new Set([CallState.RESERVED, CallState.CANCELLED]),
  [CallState.RESERVED]: new Set([CallState.INITIATED, CallState.CANCELLED]),
  [CallState.INITIATED]: new Set([CallState.RINGING, CallState.ANSWERED, CallState.FAILED, CallState.CANCELLED]),
  [CallState.RINGING]: new Set([CallState.ANSWERED, CallState.FAILED, CallState.CANCELLED]),
  [CallState.ANSWERED]: new Set([CallState.CONNECTED, CallState.COMPLETED, CallState.FAILED]),
  [CallState.CONNECTED]: new Set([CallState.COMPLETED, CallState.FAILED]),
  [CallState.COMPLETED]: new Set(),
  [CallState.FAILED]: new Set(),
  [CallState.CANCELLED]: new Set(),
};

export class AgentStateMachine {
  static canTransition(current, target) {
    if (current === target) return true;
    const allowed = AGENT_ALLOWED_TRANSITIONS[current] || new Set();
    return allowed.has(target);
  }

  static transition(current, target) {
    if (current === target) return target;
    if (!AgentStateMachine.canTransition(current, target)) {
      throw new InvalidStateTransitionError(
        `Illegal agent transition: ${current} -> ${target}.`
      );
    }
    return target;
  }
}

export class CallStateMachine {
  static canTransition(current, target) {
    if (current === target) return true;
    const allowed = CALL_ALLOWED_TRANSITIONS[current] || new Set();
    return allowed.has(target);
  }

  /**
   * Evaluates incoming state against current state.
   * Handles duplicates, out-of-order arrivals, and fast-forward jumps.
   */
  static transitionWithEvent(currentState, incomingState, eventId = null) {
    // 1. Exact duplicate event (idempotent no-op)
    if (currentState === incomingState) {
      return {
        newState: currentState,
        applied: false,
        note: `Duplicate event ${incomingState} ignored (idempotent no-op).`
      };
    }

    const currPrec = CALL_STATE_PRECEDENCE[currentState] || 0;
    const incPrec = CALL_STATE_PRECEDENCE[incomingState] || 0;

    // 2. Terminal state protection: COMPLETED/FAILED/CANCELLED cannot regress
    if (currPrec >= 100) {
      return {
        newState: currentState,
        applied: false,
        note: `Late out-of-order event ${incomingState} ignored: Call is in terminal state ${currentState}.`
      };
    }

    // 3. Out-of-order earlier event arriving after a later state
    if (incPrec < currPrec) {
      return {
        newState: currentState,
        applied: false,
        note: `Out-of-order event ${incomingState} (precedence ${incPrec}) ignored: Call is at ${currentState} (precedence ${currPrec}).`
      };
    }

    // 4. Valid normal transition
    const allowed = CALL_ALLOWED_TRANSITIONS[currentState] || new Set();
    if (allowed.has(incomingState)) {
      return {
        newState: incomingState,
        applied: true,
        note: `Transition applied: ${currentState} -> ${incomingState}`
      };
    }

    // 5. Provider jump (e.g. INITIATED straight to ANSWERED or COMPLETED)
    if (
      [CallState.INITIATED, CallState.RESERVED].includes(currentState) &&
      [CallState.ANSWERED, CallState.FAILED, CallState.COMPLETED].includes(incomingState)
    ) {
      return {
        newState: incomingState,
        applied: true,
        note: `Fast-forward provider transition applied: ${currentState} -> ${incomingState}`
      };
    }

    throw new InvalidStateTransitionError(
      `Invalid call transition attempted: ${currentState} -> ${incomingState}`
    );
  }
}
