"""Safety Controller: Hard compliance and risk governor for the SmartDialer.

Sits strictly between Pacing Engine and Allocator:
Campaign -> Pacing Engine -> Safety Controller -> Call Allocator -> Telecom Provider

Cannot be switched off by the predictive engine or bypassed by workers.
Enforces compliance bounds, maximum abandonment probability, agent headroom,
and provider health monitoring.
"""

import math
import logging
from typing import Dict, Any, Tuple
from app.database import get_db
from app.models import DialingMode, SafetyDecisionType, SafetyEvaluationResult

logger = logging.getLogger("smartdialer.safety")


class SafetyController:
    """Non-bypassable Safety Controller that guards compliance and system invariants."""

    def __init__(self, max_allowed_abandonment_rate: float = 0.03):
        # 3% maximum abandonment rate compliance limit (FTC/FCC standard)
        self.max_allowed_abandonment_rate = max_allowed_abandonment_rate
        self._recent_agent_counts = []

    def evaluate(
        self,
        mode: DialingMode,
        requested_calls: int,
        available_agents: int,
        connected_agents: int,
        ringing_calls: int,
        provider_health: Dict[str, Any],
        historical_answer_rate: float = 0.35
    ) -> SafetyEvaluationResult:
        """Evaluates pacing engine request and returns an approved call count with full rationale.
        
        The predictive engine cannot bypass this step.
        """
        provider_healthy = provider_health.get("is_healthy", True)
        provider_health_pct = provider_health.get("health_pct", 100.0)

        # Track agent availability trajectory to detect sudden drops (e.g., 100 -> 60)
        self._recent_agent_counts.append(available_agents)
        if len(self._recent_agent_counts) > 10:
            self._recent_agent_counts.pop(0)

        agent_drop_detected = False
        if len(self._recent_agent_counts) >= 2:
            prev_agents = self._recent_agent_counts[0]
            if prev_agents > 10 and (prev_agents - available_agents) / prev_agents >= 0.35:
                agent_drop_detected = True

        # Rule 1: Zero available capacity -> Immediate REJECT
        if available_agents <= 0 and (mode == DialingMode.PROGRESSIVE or connected_agents == 0):
            result = SafetyEvaluationResult(
                decision=SafetyDecisionType.REJECTED,
                requested_calls=requested_calls,
                approved_calls=0,
                reason="Rejected: Zero available agents in queue.",
                available_agents=available_agents,
                ringing_calls=ringing_calls,
                provider_health_pct=provider_health_pct,
                abandonment_risk_pct=0.0
            )
            self._log_decision(result, mode)
            return result

        # Rule 2: Telecom Provider Health / Outage Check
        if not provider_healthy or provider_health_pct < 70.0:
            result = SafetyEvaluationResult(
                decision=SafetyDecisionType.REJECTED,
                requested_calls=requested_calls,
                approved_calls=0,
                reason=f"Rejected: Provider health degraded ({provider_health_pct:.1f}%). Throttling all outbound dispatches.",
                available_agents=available_agents,
                ringing_calls=ringing_calls,
                provider_health_pct=provider_health_pct,
                abandonment_risk_pct=0.0
            )
            self._log_decision(result, mode)
            return result

        # Rule 3: Sudden Agent Dropout Circuit Breaker
        if agent_drop_detected:
            # When agents drop suddenly, pending predictive calls would cause massive abandonments.
            # Force emergency progressive clamp or full hold.
            safe_progressive = max(0, available_agents - ringing_calls)
            result = SafetyEvaluationResult(
                decision=SafetyDecisionType.PROGRESSIVE_FALLBACK,
                requested_calls=requested_calls,
                approved_calls=safe_progressive,
                reason=f"Safety Alarm: Sudden agent availability drop detected ({prev_agents} -> {available_agents}). Clamping to strict progressive dial count ({safe_progressive}).",
                available_agents=available_agents,
                ringing_calls=ringing_calls,
                provider_health_pct=provider_health_pct,
                abandonment_risk_pct=0.0
            )
            self._log_decision(result, mode)
            return result

        # Rule 4: Progressive Mode Safety Check
        if mode == DialingMode.PROGRESSIVE:
            max_safe_progressive = max(0, available_agents - ringing_calls)
            if requested_calls <= max_safe_progressive:
                result = SafetyEvaluationResult(
                    decision=SafetyDecisionType.APPROVED,
                    requested_calls=requested_calls,
                    approved_calls=requested_calls,
                    reason=f"Approved: Progressive request ({requested_calls}) is within available agent capacity ({max_safe_progressive}).",
                    available_agents=available_agents,
                    ringing_calls=ringing_calls,
                    provider_health_pct=provider_health_pct,
                    abandonment_risk_pct=0.0
                )
            else:
                result = SafetyEvaluationResult(
                    decision=SafetyDecisionType.REDUCED,
                    requested_calls=requested_calls,
                    approved_calls=max_safe_progressive,
                    reason=f"Reduced: Progressive request ({requested_calls}) exceeded free capacity. Clamped to {max_safe_progressive}.",
                    available_agents=available_agents,
                    ringing_calls=ringing_calls,
                    provider_health_pct=provider_health_pct,
                    abandonment_risk_pct=0.0
                )
            self._log_decision(result, mode)
            return result

        # Rule 5: Predictive Mode Statistical Safety Bound
        # Calculate Abandonment Risk using Binomial Tail Probability:
        # P(Answered > Available + Buffer)
        risk_pct, max_safe_predictive = self._calculate_predictive_safety_bounds(
            requested_calls=requested_calls,
            available_agents=available_agents,
            connected_agents=connected_agents,
            ringing_calls=ringing_calls,
            answer_rate=historical_answer_rate
        )

        # If abandonment risk exceeds threshold, fall back to Progressive
        if risk_pct > (self.max_allowed_abandonment_rate * 100.0):
            safe_progressive = max(0, available_agents - ringing_calls)
            result = SafetyEvaluationResult(
                decision=SafetyDecisionType.PROGRESSIVE_FALLBACK,
                requested_calls=requested_calls,
                approved_calls=safe_progressive,
                reason=f"Progressive Fallback: Estimated abandonment risk ({risk_pct:.1f}%) exceeds safety ceiling ({self.max_allowed_abandonment_rate*100:.1f}%). Falling back to safe progressive count ({safe_progressive}).",
                available_agents=available_agents,
                ringing_calls=ringing_calls,
                provider_health_pct=provider_health_pct,
                abandonment_risk_pct=risk_pct
            )
            self._log_decision(result, mode)
            return result

        if requested_calls <= max_safe_predictive:
            result = SafetyEvaluationResult(
                decision=SafetyDecisionType.APPROVED,
                requested_calls=requested_calls,
                approved_calls=requested_calls,
                reason=f"Approved: Predictive request ({requested_calls}) is within safe probabilistic envelope (Risk: {risk_pct:.1f}%).",
                available_agents=available_agents,
                ringing_calls=ringing_calls,
                provider_health_pct=provider_health_pct,
                abandonment_risk_pct=risk_pct
            )
        else:
            result = SafetyEvaluationResult(
                decision=SafetyDecisionType.REDUCED,
                requested_calls=requested_calls,
                approved_calls=max_safe_predictive,
                reason=f"Reduced: Predictive request ({requested_calls}) exceeds safety headroom. Clamped to {max_safe_predictive} (Risk: {risk_pct:.1f}%).",
                available_agents=available_agents,
                ringing_calls=ringing_calls,
                provider_health_pct=provider_health_pct,
                abandonment_risk_pct=risk_pct
            )

        self._log_decision(result, mode)
        return result

    def _calculate_predictive_safety_bounds(
        self,
        requested_calls: int,
        available_agents: int,
        connected_agents: int,
        ringing_calls: int,
        answer_rate: float
    ) -> Tuple[float, int]:
        """Calculates probabilistic abandonment risk and max safe calls."""
        # Estimated total capacity assuming modest release from connected calls
        expected_free_agents = available_agents + int(connected_agents * 0.15)
        total_in_flight = requested_calls + ringing_calls

        # Normal approximation / Poisson tail probability
        mean_answers = total_in_flight * answer_rate
        variance = total_in_flight * answer_rate * (1 - answer_rate)
        std_dev = math.sqrt(variance) if variance > 0 else 0.5

        # Z-score for exceeding capacity
        if std_dev > 0 and expected_free_agents > 0:
            z = (expected_free_agents - mean_answers) / std_dev
            # Cumulative risk probability (tail where answers > capacity)
            # using approximation for standard normal CDF
            risk = 0.5 * math.erfc(z / math.sqrt(2))
            risk_pct = round(risk * 100.0, 2)
        else:
            risk_pct = 0.0 if expected_free_agents >= mean_answers else 85.0

        # Compute safe ceiling where risk remains <= allowed threshold
        # For standard 95% or 97% confidence: Z ~ 1.96
        safe_max_answers = expected_free_agents
        safe_total_calls = int(safe_max_answers / max(0.1, answer_rate)) if answer_rate > 0 else available_agents
        max_safe_calls = max(0, safe_total_calls - ringing_calls)

        return (risk_pct, max_safe_calls)

    def _log_decision(self, eval_result: SafetyEvaluationResult, mode: DialingMode) -> None:
        """Stores decision audit trail in SQLite table."""
        try:
            with get_db() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    INSERT INTO safety_decisions (
                        mode, requested_calls, approved_calls, decision, reason,
                        available_agents, ringing_calls, provider_health_pct
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                    """,
                    (
                        mode.value,
                        eval_result.requested_calls,
                        eval_result.approved_calls,
                        eval_result.decision.value,
                        eval_result.reason,
                        eval_result.available_agents,
                        eval_result.ringing_calls,
                        eval_result.provider_health_pct
                    )
                )
        except Exception as e:
            logger.error(f"Failed to record safety decision: {e}")
