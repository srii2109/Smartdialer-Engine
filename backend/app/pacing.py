"""Pacing Engine implementations for Progressive and Predictive dialing modes."""

import math
import logging
from typing import Dict, Any
from app.models import DialingMode

logger = logging.getLogger("smartdialer.pacing")


class PacingEngine:
    """Calculates the target number of outbound calls to initiate based on system state."""

    @staticmethod
    def calculate_calls(
        mode: DialingMode,
        available_agents: int,
        connected_agents: int,
        ringing_calls: int,
        historical_answer_rate: float = 0.35,
        avg_talk_time_sec: float = 90.0,
        call_setup_ring_time_sec: float = 20.0,
        aggressiveness: float = 1.0
    ) -> Dict[str, Any]:
        """Calculates recommended calls and provides an explainable mathematical rationale."""
        
        # 1. PROGRESSIVE MODE: Strict 1-to-1 ratio
        if mode == DialingMode.PROGRESSIVE:
            # Under progressive dialing: We only dial calls for agents currently free
            # Minus any calls that are already ringing and awaiting an agent
            target = max(0, available_agents - ringing_calls)
            return {
                "mode": mode.value,
                "recommended_calls": target,
                "rationale": (
                    f"Progressive dialing: Exactly 1 call per free agent. "
                    f"Free agents={available_agents}, Active ringing={ringing_calls} -> "
                    f"target = max(0, {available_agents} - {ringing_calls}) = {target} calls."
                ),
                "metrics": {
                    "available_agents": available_agents,
                    "ringing_calls": ringing_calls
                }
            }

        # 2. PREDICTIVE MODE: Statistical pacing with Poisson / Erlang capacity model
        # Safe bound on answer rate to prevent division by zero
        p = max(0.05, min(0.95, historical_answer_rate))
        talk_time = max(10.0, avg_talk_time_sec)
        ring_time = max(5.0, call_setup_ring_time_sec)

        # Estimate how many currently connected agents will complete their calls
        # during the ringing window (setup + ring duration)
        # Using memoryless/exponential call duration expectation: P(complete within ring_time) = 1 - exp(-ring_time / talk_time)
        completion_prob = 1.0 - math.exp(-ring_time / talk_time)
        agents_freeing_up = connected_agents * completion_prob

        # Total agent capacity expected when the new batch of calls connects:
        expected_agent_capacity = available_agents + agents_freeing_up

        # Since only a fraction 'p' of borrowers answer, we need (expected_capacity / p) calls ringing.
        target_total_ringing = (expected_agent_capacity / p) * aggressiveness

        # Subtract calls already ringing in the network
        raw_recommended = target_total_ringing - ringing_calls
        recommended_calls = max(0, int(math.floor(raw_recommended)))

        rationale = (
            f"Predictive Model: {available_agents} free agents + {agents_freeing_up:.1f} expected completing "
            f"(P_complete={completion_prob:.1%}) = {expected_agent_capacity:.1f} total agent capacity. "
            f"With historical answer rate {p:.1%}, target ringing is {target_total_ringing:.1f}. "
            f"Minus {ringing_calls} already ringing -> Recommended = {recommended_calls} calls."
        )

        return {
            "mode": mode.value,
            "recommended_calls": recommended_calls,
            "rationale": rationale,
            "metrics": {
                "available_agents": available_agents,
                "connected_agents": connected_agents,
                "expected_agent_capacity": round(expected_agent_capacity, 2),
                "agents_freeing_up": round(agents_freeing_up, 2),
                "ringing_calls": ringing_calls,
                "answer_rate": round(p, 3),
                "raw_recommended": round(raw_recommended, 2)
            }
        }
