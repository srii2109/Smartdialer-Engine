"""Tests for Progressive and Predictive Pacing Engine formulas."""

from app.pacing import PacingEngine
from app.models import DialingMode


def test_progressive_pacing():
    # 50 available agents, 0 ringing -> exactly 50 calls
    res = PacingEngine.calculate_calls(
        mode=DialingMode.PROGRESSIVE,
        available_agents=50,
        connected_agents=0,
        ringing_calls=0
    )
    assert res["recommended_calls"] == 50
    assert "Exactly 1 call per free agent" in res["rationale"]

    # 50 available agents, 20 already ringing -> 30 calls
    res = PacingEngine.calculate_calls(
        mode=DialingMode.PROGRESSIVE,
        available_agents=50,
        connected_agents=0,
        ringing_calls=20
    )
    assert res["recommended_calls"] == 30

    # 0 available agents -> 0 calls
    res = PacingEngine.calculate_calls(
        mode=DialingMode.PROGRESSIVE,
        available_agents=0,
        connected_agents=10,
        ringing_calls=5
    )
    assert res["recommended_calls"] == 0


def test_predictive_pacing_low_answer_rate():
    """Scenario A: 20% answer rate, 120s talk time.
    
    With low answer rate, dialer safely dials more calls to keep agents busy.
    """
    res = PacingEngine.calculate_calls(
        mode=DialingMode.PREDICTIVE,
        available_agents=10,
        connected_agents=20,
        ringing_calls=5,
        historical_answer_rate=0.20,
        avg_talk_time_sec=120.0,
        call_setup_ring_time_sec=20.0
    )

    # Some connected agents will finish (20 * (1 - exp(-20/120)) ~ 3 agents)
    # Total capacity ~ 13.
    # At 20% answer rate: target ringing ~ 13 / 0.20 = 65.
    # Recommended ~ 65 - 5 = 60.
    assert res["recommended_calls"] > 20
    assert "Predictive Model" in res["rationale"]
    assert res["metrics"]["answer_rate"] == 0.2


def test_predictive_pacing_high_answer_rate():
    """Scenario C: 70% answer rate, 180s talk time.
    
    With high answer rate, dialer dials conservatively to prevent abandoned calls.
    """
    res = PacingEngine.calculate_calls(
        mode=DialingMode.PREDICTIVE,
        available_agents=10,
        connected_agents=20,
        ringing_calls=5,
        historical_answer_rate=0.70,
        avg_talk_time_sec=180.0,
        call_setup_ring_time_sec=20.0
    )

    # Expected finishing agents is lower due to long talk time
    # With 70% answer rate, required ringing is much lower
    assert res["recommended_calls"] < 25
