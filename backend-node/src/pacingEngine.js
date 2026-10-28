import { DialingMode } from './models/states.js';

export class PacingEngine {
  /**
   * Calculates target outbound call count with explicit mathematical rationale.
   */
  static calculateCalls({
    mode,
    availableAgents,
    connectedAgents,
    ringingCalls,
    historicalAnswerRate = 0.35,
    avgTalkTimeSec = 90.0,
    callSetupRingTimeSec = 20.0,
    aggressiveness = 1.0
  }) {
    // 1. PROGRESSIVE MODE (Strict 1-to-1)
    if (mode === DialingMode.PROGRESSIVE) {
      const target = Math.max(0, availableAgents - ringingCalls);
      return {
        mode,
        recommendedCalls: target,
        rationale: `Progressive dialing: Exactly 1 call per free agent. Free=${availableAgents}, Ringing=${ringingCalls} -> target = max(0, ${availableAgents} - ${ringingCalls}) = ${target} calls.`,
        metrics: {
          availableAgents,
          ringingCalls
        }
      };
    }

    // 2. PREDICTIVE MODE: Statistical capacity model
    const p = Math.max(0.05, Math.min(0.95, historicalAnswerRate));
    const talkTime = Math.max(10.0, avgTalkTimeSec);
    const ringTime = Math.max(5.0, callSetupRingTimeSec);

    // Probability of an ongoing call completing during setup/ring window
    const completionProb = 1.0 - Math.exp(-ringTime / talkTime);
    const agentsFreeingUp = connectedAgents * completionProb;

    // Total agent capacity expected when newly placed calls connect
    const expectedAgentCapacity = availableAgents + agentsFreeingUp;

    // Outbound calls needed so that expected answers match expected agent capacity
    const targetTotalRinging = (expectedAgentCapacity / p) * aggressiveness;
    const rawRecommended = targetTotalRinging - ringingCalls;
    const recommendedCalls = Math.max(0, Math.floor(rawRecommended));

    const rationale = `Predictive Model: ${availableAgents} free agents + ${agentsFreeingUp.toFixed(1)} expected completing ` +
      `(P_complete=${(completionProb * 100).toFixed(1)}%) = ${expectedAgentCapacity.toFixed(1)} expected capacity. ` +
      `With answer rate ${(p * 100).toFixed(1)}%, target ringing is ${targetTotalRinging.toFixed(1)}. ` +
      `Minus ${ringingCalls} ringing -> Recommended = ${recommendedCalls} calls.`;

    return {
      mode,
      recommendedCalls,
      rationale,
      metrics: {
        availableAgents,
        connectedAgents,
        expectedAgentCapacity: Number(expectedAgentCapacity.toFixed(2)),
        agentsFreeingUp: Number(agentsFreeingUp.toFixed(2)),
        ringingCalls,
        answerRate: Number(p.toFixed(3)),
        rawRecommended: Number(rawRecommended.toFixed(2))
      }
    };
  }
}
