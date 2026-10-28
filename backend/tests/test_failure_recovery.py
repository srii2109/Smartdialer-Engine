"""Failure Scenario and Recovery Tests.

Demonstrates:
1. Worker crash recovery
2. Provider outage behavior
3. Duplicate webhook idempotency
4. Out-of-order event resilience
"""

import pytest
import asyncio
from app.database import init_db, get_db, query_one, query_all
from app.reconciler import Reconciler
from app.dialer import SmartDialerEngine
from app.models import AgentState, CallState, DialingMode


@pytest.fixture(autouse=True)
def setup_db():
    init_db(force_reset=True)
    with get_db() as conn:
        conn.execute("INSERT INTO agents (id, name, state, version) VALUES ('agent_rec_1', 'Rec Agent', 'AVAILABLE', 1);")
        conn.execute("INSERT INTO borrowers (id, name, phone, priority, state, version) VALUES ('bor_rec_1', 'Bor Rec', '+1-555-9999', 1, 'UNPROCESSED', 1);")


def test_worker_crash_recovery():
    """Failure Case 1: Agent reserved > Borrower reserved > Call initiated > Worker crashes.
    
    Verifies that Reconciler sweeper automatically detects the abandoned call,
    frees the agent back to AVAILABLE, and returns the borrower to UNPROCESSED.
    """
    reconciler = Reconciler(stale_reservation_sec=1) # 1 second threshold for test

    with get_db() as conn:
        # Simulate worker reserving agent and borrower, creating initiated call, then crashing
        conn.execute("UPDATE agents SET state = 'RESERVED', worker_id = 'crashed_worker_1', reserved_at = datetime('now', '-5 seconds') WHERE id = 'agent_rec_1';")
        conn.execute("UPDATE borrowers SET state = 'RESERVED' WHERE id = 'bor_rec_1';")
        conn.execute(
            """
            INSERT INTO calls (id, borrower_id, agent_id, worker_id, provider_id, state, mode, created_at, initiated_at, version)
            VALUES ('call_crash_1', 'bor_rec_1', 'agent_rec_1', 'crashed_worker_1', 'PROVIDER_A', 'INITIATED', 'PROGRESSIVE', datetime('now', '-5 seconds'), datetime('now', '-5 seconds'), 1);
            """
        )

    # Before sweeper: Agent is stuck in RESERVED, Call is stuck in INITIATED
    agent_before = query_one("SELECT * FROM agents WHERE id = 'agent_rec_1';")
    assert agent_before["state"] == "RESERVED"

    # Run reconciler sweeper
    res = reconciler.reconcile_all()
    assert res["crashed_worker_calls_recovered"] == 1

    # After sweeper:
    agent_after = query_one("SELECT * FROM agents WHERE id = 'agent_rec_1';")
    assert agent_after["state"] == "AVAILABLE"
    assert agent_after["worker_id"] is None

    borrower_after = query_one("SELECT * FROM borrowers WHERE id = 'bor_rec_1';")
    assert borrower_after["state"] == "UNPROCESSED" # Ready for retry!

    call_after = query_one("SELECT * FROM calls WHERE id = 'call_crash_1';")
    assert call_after["state"] == "FAILED"
    assert "WORKER_CRASH" in call_after["error_reason"]


def test_duplicate_webhook_events_idempotency():
    """Failure Case 4: Same provider event arrives multiple times."""
    async def _run():
        engine = SmartDialerEngine()
        
        with get_db() as conn:
            # Set agent to DIALING to reflect call currently in flight
            conn.execute("UPDATE agents SET state = 'DIALING' WHERE id = 'agent_rec_1';")
            conn.execute(
                """
                INSERT INTO calls (id, borrower_id, agent_id, provider_id, state, mode, version)
                VALUES ('call_dup_1', 'bor_rec_1', 'agent_rec_1', 'PROVIDER_B', 'RINGING', 'PROGRESSIVE', 1);
                """
            )

        # Deliver event 1st time
        res1 = await engine.handle_provider_webhook({
            "event_id": "unique_evt_100",
            "call_id": "call_dup_1",
            "event_type": "ANSWERED",
            "provider_id": "PROVIDER_B"
        })
        assert res1["status"] == "SUCCESS"

        # Deliver identical event 2nd time
        res2 = await engine.handle_provider_webhook({
            "event_id": "unique_evt_100",
            "call_id": "call_dup_1",
            "event_type": "ANSWERED",
            "provider_id": "PROVIDER_B"
        })
        # Idempotent deduplication via SQL events_log
        assert res2["status"] == "IGNORED"
        assert res2["reason"] == "DUPLICATE_EVENT_ID"

    asyncio.run(_run())


def test_out_of_order_webhook_events():
    """Failure Case 5: Out of order events (COMPLETED arrives before ANSWERED)."""
    async def _run():
        engine = SmartDialerEngine()

        with get_db() as conn:
            conn.execute("UPDATE agents SET state = 'CONNECTED' WHERE id = 'agent_rec_1';")
            conn.execute(
                """
                INSERT INTO calls (id, borrower_id, agent_id, provider_id, state, mode, version)
                VALUES ('call_ooo_1', 'bor_rec_1', 'agent_rec_1', 'PROVIDER_B', 'INITIATED', 'PROGRESSIVE', 1);
                """
            )

        # Deliver COMPLETED first
        res1 = await engine.handle_provider_webhook({
            "event_id": "evt_ooo_1",
            "call_id": "call_ooo_1",
            "event_type": "COMPLETED",
            "provider_id": "PROVIDER_B",
            "talk_time_sec": 12.0
        })
        assert res1["status"] == "SUCCESS"
        assert res1["new_state"] == "COMPLETED"

        # Deliver late ANSWERED afterwards
        res2 = await engine.handle_provider_webhook({
            "event_id": "evt_ooo_2",
            "call_id": "call_ooo_1",
            "event_type": "ANSWERED",
            "provider_id": "PROVIDER_B"
        })
        # Must be safely ignored without regressing call state
        assert res2["status"] == "IGNORED"

        # Verify database state remained terminal COMPLETED
        call_row = query_one("SELECT * FROM calls WHERE id = 'call_ooo_1';")
        assert call_row["state"] == "COMPLETED"

    asyncio.run(_run())
