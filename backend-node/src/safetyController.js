import { DialingMode, SafetyDecisionType } from './models/states.js';
import { query } from './db.js';

export class SafetyController {
  constructor(maxAllowedAbandonmentRate = 0.03) {
    this.maxAllowedAbandonmentRate = maxAllowedAbandonmentRate;
    this.recentAgentCounts = [];
  }

  /**
   * Evaluates pacing engine request and returns an approved call count.
   * Predictive algorithm CANNOT bypass this check.
   */
  async evaluate({
    mode,
    requestedCalls,
    availableAgents,
    connectedAgents,
    ringingCalls,
    providerHealth,
    historicalAnswerRate = 0.35
  }) {
    const providerHealthy = providerHealth?.isHealthy ?? true;
    const providerHealthPct = providerHealth?.healthPct ?? 100.0;

    // Track agent trajectory to detect sudden dropouts
    this.recentAgentCounts.push(availableAgents);
    if (this.recentAgentCounts.length > 10) this.recentAgentCounts.shift();

    let agentDropDetected = false;
    let prevAgents = availableAgents;
    if (this.recentAgentCounts.length >= 2) {
      prevAgents = this.recentAgentCounts[0];
      if (prevAgents > 10 && (prevAgents - availableAgents) / prevAgents >= 0.35) {
        agentDropDetected = true;
      }
    }

    let result = null;

    // Rule 1: Zero agent capacity
    if (availableAgents <= 0 && (mode === DialingMode.PROGRESSIVE || connectedAgents === 0)) {
      result = {
        decision: SafetyDecisionType.REJECTED,
        requestedCalls,
        approvedCalls: 0,
        reason: 'Rejected: Zero available agents in queue.',
        availableAgents,
        ringingCalls,
        providerHealthPct,
        abandonmentRiskPct: 0.0
      };
    }
    // Rule 2: Provider Health / Outage degraded
    else if (!providerHealthy || providerHealthPct < 70.0) {
      result = {
        decision: SafetyDecisionType.REJECTED,
        requestedCalls,
        approvedCalls: 0,
        reason: `Rejected: Provider health degraded (${providerHealthPct.toFixed(1)}%). Throttling all outbound dispatches.`,
        availableAgents,
        ringingCalls,
        providerHealthPct,
        abandonmentRiskPct: 0.0
      };
    }
    // Rule 3: Sudden agent dropout circuit breaker
    else if (agentDropDetected) {
      const safeProgressive = Math.max(0, availableAgents - ringingCalls);
      result = {
        decision: SafetyDecisionType.PROGRESSIVE_FALLBACK,
        requestedCalls,
        approvedCalls: safeProgressive,
        reason: `Safety Alarm: Sudden agent availability drop detected (${prevAgents} -> ${availableAgents}). Clamping to strict progressive ceiling (${safeProgressive}).`,
        availableAgents,
        ringingCalls,
        providerHealthPct,
        abandonmentRiskPct: 0.0
      };
    }
    // Rule 4: Progressive Mode Check
    else if (mode === DialingMode.PROGRESSIVE) {
      const maxSafeProgressive = Math.max(0, availableAgents - ringingCalls);
      if (requestedCalls <= maxSafeProgressive) {
        result = {
          decision: SafetyDecisionType.APPROVED,
          requestedCalls,
          approvedCalls: requestedCalls,
          reason: `Approved: Progressive request (${requestedCalls}) within available capacity (${maxSafeProgressive}).`,
          availableAgents,
          ringingCalls,
          providerHealthPct,
          abandonmentRiskPct: 0.0
        };
      } else {
        result = {
          decision: SafetyDecisionType.REDUCED,
          requestedCalls,
          approvedCalls: maxSafeProgressive,
          reason: `Reduced: Progressive request (${requestedCalls}) exceeded free capacity. Clamped to ${maxSafeProgressive}.`,
          availableAgents,
          ringingCalls,
          providerHealthPct,
          abandonmentRiskPct: 0.0
        };
      }
    }
    // Rule 5: Predictive Mode Statistical Safety Bound
    else {
      const { riskPct, maxSafeCalls } = this.calculatePredictiveSafetyBounds({
        requestedCalls,
        availableAgents,
        connectedAgents,
        ringingCalls,
        answerRate: historicalAnswerRate
      });

      if (riskPct > (this.maxAllowedAbandonmentRate * 100)) {
        const safeProgressive = Math.max(0, availableAgents - ringingCalls);
        result = {
          decision: SafetyDecisionType.PROGRESSIVE_FALLBACK,
          requestedCalls,
          approvedCalls: safeProgressive,
          reason: `Progressive Fallback: Estimated abandonment risk (${riskPct.toFixed(1)}%) exceeds safety ceiling (${(this.maxAllowedAbandonmentRate * 100).toFixed(1)}%). Falling back to progressive count (${safeProgressive}).`,
          availableAgents,
          ringingCalls,
          providerHealthPct,
          abandonmentRiskPct: riskPct
        };
      } else if (requestedCalls <= maxSafeCalls) {
        result = {
          decision: SafetyDecisionType.APPROVED,
          requestedCalls,
          approvedCalls: requestedCalls,
          reason: `Approved: Predictive request (${requestedCalls}) is within safe probabilistic envelope (Risk: ${riskPct.toFixed(1)}%).`,
          availableAgents,
          ringingCalls,
          providerHealthPct,
          abandonmentRiskPct: riskPct
        };
      } else {
        result = {
          decision: SafetyDecisionType.REDUCED,
          requestedCalls,
          approvedCalls: maxSafeCalls,
          reason: `Reduced: Predictive request (${requestedCalls}) exceeds safety headroom. Clamped to ${maxSafeCalls} (Risk: ${riskPct.toFixed(1)}%).`,
          availableAgents,
          ringingCalls,
          providerHealthPct,
          abandonmentRiskPct: riskPct
        };
      }
    }

    // Persist decision into MySQL audit table
    await this.logDecision(result, mode);
    return result;
  }

  calculatePredictiveSafetyBounds({ requestedCalls, availableAgents, connectedAgents, ringingCalls, answerRate }) {
    const expectedFreeAgents = availableAgents + Math.floor(connectedAgents * 0.15);
    const totalInFlight = requestedCalls + ringingCalls;

    const meanAnswers = totalInFlight * answerRate;
    const variance = totalInFlight * answerRate * (1 - answerRate);
    const stdDev = variance > 0 ? Math.sqrt(variance) : 0.5;

    let riskPct = 0.0;
    if (stdDev > 0 && expectedFreeAgents > 0) {
      const z = (expectedFreeAgents - meanAnswers) / stdDev;
      // Approximation for complementary error function / normal CDF tail
      const t = 1.0 / (1.0 + 0.3275911 * Math.abs(z));
      const erf = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
      const cdf = z >= 0 ? 0.5 * (1.0 + erf) : 0.5 * (1.0 - erf);
      riskPct = Number(((1.0 - cdf) * 100).toFixed(2));
    } else {
      riskPct = expectedFreeAgents >= meanAnswers ? 0.0 : 85.0;
    }

    const safeTotalCalls = Math.floor(expectedFreeAgents / Math.max(0.1, answerRate));
    const maxSafeCalls = Math.max(0, safeTotalCalls - ringingCalls);

    return { riskPct, maxSafeCalls };
  }

  async logDecision(result, mode) {
    try {
      await query(
        `INSERT INTO safety_decisions (
           mode, requested_calls, approved_calls, decision, reason,
           available_agents, ringing_calls, provider_health_pct
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          mode,
          result.requestedCalls,
          result.approvedCalls,
          result.decision,
          result.reason,
          result.availableAgents,
          result.ringingCalls,
          result.providerHealthPct
        ]
      );
    } catch (e) {
      console.error('[SafetyController] Failed to record MySQL audit decision:', e.message);
    }
  }
}
