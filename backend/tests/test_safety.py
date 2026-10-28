"""Tests for the Safety Controller boundary and compliance invariants."""

import pytest
from app.database import init_db, query_all
from app.safety import SafetyController
from app.models import DialingMode, SafetyDecisionType


@pytest.fixture(autouse=True)
def setup_db():
    init_db(force_reset=True)


def test_zero_capacity_rejection():
    safety = SafetyController()
    provider_health = {"is_healthy": True, "health_pct": 100.0}

    eval_res = safety.evaluate(
        mode=DialingMode.PROGRESSIVE,
        requested_calls=10,
        available_agents=0,
        connected_agents=0,
        ringing_calls=0,
        provider_health=provider_health
    )

    assert eval_res.decision == SafetyDecisionType.REJECTED
    assert eval_res.approved_calls == 0


def test_provider_outage_throttling():
    safety = SafetyController()
    # Provider is failing / in outage
    degraded_health = {"is_healthy": False, "health_pct": 20.0}

    eval_res = safety.evaluate(
        mode=DialingMode.PREDICTIVE,
        requested_calls=15,
        available_agents=10,
        connected_agents=5,
        ringing_calls=2,
        provider_health=degraded_health
    )

    assert eval_res.decision == SafetyDecisionType.REJECTED
    assert eval_res.approved_calls == 0
    assert "Provider health degraded" in eval_res.reason


def test_sudden_agent_dropout_circuit_breaker():
    safety = SafetyController()
    provider_health = {"is_healthy": True, "health_pct": 100.0}

    # Simulate past availability of 100 agents
    for _ in range(5):
        safety.evaluate(
            mode=DialingMode.PREDICTIVE,
            requested_calls=5,
            available_agents=100,
            connected_agents=20,
            ringing_calls=5,
            provider_health=provider_health
        )

    # Sudden drop from 100 to 50 agents!
    eval_res = safety.evaluate(
        mode=DialingMode.PREDICTIVE,
        requested_calls=30,
        available_agents=50,
        connected_agents=20,
        ringing_calls=10,
        provider_health=provider_health
    )

    # Must clamp to safe progressive ceiling (50 - 10 = 40)
    assert eval_res.decision == SafetyDecisionType.PROGRESSIVE_FALLBACK
    assert eval_res.approved_calls == 40
    assert "Sudden agent availability drop detected" in eval_res.reason


def test_predictive_risk_clamping():
    safety = SafetyController(max_allowed_abandonment_rate=0.03)
    provider_health = {"is_healthy": True, "health_pct": 100.0}

    # Pacing engine requests an absurd 500 calls with only 5 available agents and 70% answer rate
    eval_res = safety.evaluate(
        mode=DialingMode.PREDICTIVE,
        requested_calls=500,
        available_agents=5,
        connected_agents=2,
        ringing_calls=0,
        provider_health=provider_health,
        historical_answer_rate=0.70
    )

    # Must reduce or fallback to progressive behavior to prevent massive abandonment
    assert eval_res.decision in {SafetyDecisionType.REDUCED, SafetyDecisionType.PROGRESSIVE_FALLBACK}
    assert eval_res.approved_calls <= 15 # Strictly guarded


def test_audit_log_persisted_in_sql():
    safety = SafetyController()
    provider_health = {"is_healthy": True, "health_pct": 100.0}

    safety.evaluate(
        mode=DialingMode.PROGRESSIVE,
        requested_calls=5,
        available_agents=10,
        connected_agents=0,
        ringing_calls=0,
        provider_health=provider_health
    )

    # Check SQL audit log
    records = query_all("SELECT * FROM safety_decisions;")
    assert len(records) >= 1
    assert records[0]["decision"] == "APPROVED"
    assert records[0]["approved_calls"] == 5
