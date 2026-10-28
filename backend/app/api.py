"""FastAPI router and WebSocket endpoint for SmartDialer management and simulation."""

import asyncio
import json
import logging
import uuid
from typing import Dict, Any, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel
from app.database import query_all, query_one, get_db, init_db, seed_data
from app.models import DialingMode, AgentState, CallState
from app.dialer import SmartDialerEngine
from app.reconciler import Reconciler

logger = logging.getLogger("smartdialer.api")

router = APIRouter()

# Global engine and reconciler instances
engine = SmartDialerEngine()
reconciler = Reconciler()


class ModeRequest(BaseModel):
    mode: DialingMode


class ProviderRequest(BaseModel):
    provider_id: str


class DropAgentsRequest(BaseModel):
    count: int = 20


class ScenarioRequest(BaseModel):
    scenario: str # 'A', 'B', 'C', 'D'


class FailureInjectionRequest(BaseModel):
    failure_type: str # 'worker_crash', 'provider_outage', 'duplicate_event', 'out_of_order'


@router.get("/status")
def get_status() -> Dict[str, Any]:
    return engine.get_system_status()


@router.get("/agents")
def get_agents():
    return query_all("SELECT * FROM agents ORDER BY id ASC LIMIT 100;")


@router.get("/calls")
def get_calls():
    return query_all(
        """
        SELECT c.*, b.name as borrower_name, b.phone as borrower_phone
        FROM calls c
        JOIN borrowers b ON c.borrower_id = b.id
        ORDER BY c.created_at DESC
        LIMIT 50;
        """
    )


@router.get("/safety/log")
def get_safety_logs():
    return query_all("SELECT * FROM safety_decisions ORDER BY id DESC LIMIT 50;")


@router.post("/dialer/start")
async def start_dialer():
    await engine.start(num_workers=3)
    with get_db() as conn:
        conn.execute("UPDATE campaign_config SET value = '1' WHERE key = 'is_running';")
    return {"status": "started"}


@router.post("/dialer/pause")
async def pause_dialer():
    with get_db() as conn:
        conn.execute("UPDATE campaign_config SET value = '0' WHERE key = 'is_running';")
    return {"status": "paused"}


@router.post("/dialer/reset")
async def reset_dialer():
    await engine.stop()
    init_db(force_reset=True)
    seed_data(agent_count=50, borrower_count=300)
    await engine.start(num_workers=3)
    return {"status": "reset_complete"}


@router.post("/config/mode")
def set_dialing_mode(req: ModeRequest):
    engine.set_mode(req.mode)
    return {"status": "mode_updated", "mode": req.mode.value}


@router.post("/config/provider")
def set_active_provider(req: ProviderRequest):
    engine.set_provider(req.provider_id)
    return {"status": "provider_updated", "provider": req.provider_id}


@router.post("/agents/drop")
def drop_agents(req: DropAgentsRequest):
    """Simulates sudden agent dropout (e.g. agents logging off or going to lunch)."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE agents
            SET state = 'OFFLINE',
                worker_id = NULL,
                version = version + 1
            WHERE id IN (
                SELECT id FROM agents WHERE state = 'AVAILABLE' LIMIT ?
            );
            """,
            (req.count,)
        )
        affected = cur.rowcount
    logger.warning(f"Simulated sudden drop of {affected} agents.")
    return {"status": "agents_dropped", "count": affected}


@router.post("/agents/restore")
def restore_agents():
    """Restores all OFFLINE and PAUSED agents back to AVAILABLE."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE agents
            SET state = 'AVAILABLE',
                worker_id = NULL,
                version = version + 1
            WHERE state IN ('OFFLINE', 'PAUSED');
            """
        )
        count = cur.rowcount
    return {"status": "agents_restored", "count": count}


@router.post("/scenarios/run")
def run_scenario(req: ScenarioRequest):
    """Configures environment parameters per assignment scenarios A, B, C, D."""
    prov_a = engine.providers["PROVIDER_A"]
    prov_b = engine.providers["PROVIDER_B"]

    if req.scenario == "A":
        # Scenario A: Answer Rate 20%, Avg Talk Time 120s
        prov_a.set_answer_rate(0.20)
        prov_a.set_talk_time(12.0) # Compacted 12s talk time for smooth demo
        prov_b.set_answer_rate(0.20)
        prov_b.set_talk_time(12.0)
        return {"status": "configured", "scenario": "A", "answer_rate": "20%", "avg_talk_time": "120s"}

    elif req.scenario == "B":
        # Scenario B: Answer Rate 50%, Avg Talk Time 90s
        prov_a.set_answer_rate(0.50)
        prov_a.set_talk_time(9.0)
        prov_b.set_answer_rate(0.50)
        prov_b.set_talk_time(9.0)
        return {"status": "configured", "scenario": "B", "answer_rate": "50%", "avg_talk_time": "90s"}

    elif req.scenario == "C":
        # Scenario C: Answer Rate 70%, Avg Talk Time 180s
        prov_a.set_answer_rate(0.70)
        prov_a.set_talk_time(18.0)
        prov_b.set_answer_rate(0.70)
        prov_b.set_talk_time(18.0)
        return {"status": "configured", "scenario": "C", "answer_rate": "70%", "avg_talk_time": "180s"}

    elif req.scenario == "D":
        # Scenario D: Changing answer rate & latency / chaos
        prov_b.set_answer_rate(0.35)
        prov_b.set_talk_time(10.0)
        engine.set_provider("PROVIDER_B")
        return {"status": "configured", "scenario": "D", "note": "Dynamic changing conditions with Provider B active"}

    raise HTTPException(status_code=400, detail="Invalid scenario")


@router.post("/failures/inject")
async def inject_failure(req: FailureInjectionRequest):
    """Demonstrates failure cases directly required by assignment."""
    
    if req.failure_type == "worker_crash":
        # Failure Case 1: Agent reserved > Borrower reserved > Call initiated > Worker crashes
        fake_worker_id = "crashed_worker_99"
        # Manually create a call initiated by this worker and backdate it so sweeper picks it up
        call_id = f"crash_test_{uuid.uuid4().hex[:6]}"
        with get_db() as conn:
            cur = conn.cursor()
            # Claim an agent
            cur.execute("UPDATE agents SET state = 'RESERVED', worker_id = ? WHERE state = 'AVAILABLE' LIMIT 1 RETURNING id;", (fake_worker_id,))
            agent_row = cur.fetchone()
            agent_id = agent_row["id"] if agent_row else None
            
            # Claim a borrower
            cur.execute("UPDATE borrowers SET state = 'RESERVED' WHERE state = 'UNPROCESSED' LIMIT 1 RETURNING id;", ())
            bor_row = cur.fetchone()
            bor_id = bor_row["id"] if bor_row else "bor_0001"

            # Insert call backdated by 25 seconds (simulating worker death after initiating)
            cur.execute(
                """
                INSERT INTO calls (id, borrower_id, agent_id, worker_id, provider_id, state, mode, created_at, initiated_at, version)
                VALUES (?, ?, ?, ?, 'PROVIDER_A', 'INITIATED', 'PROGRESSIVE', datetime('now', '-25 seconds'), datetime('now', '-25 seconds'), 1);
                """,
                (call_id, bor_id, agent_id, fake_worker_id)
            )

        # Run reconciler sweeper immediately to demonstrate automatic recovery
        recovered = reconciler.reconcile_all()
        return {
            "status": "worker_crash_simulated_and_recovered",
            "call_id": call_id,
            "reconciler_result": recovered
        }

    elif req.failure_type == "provider_outage":
        # Failure Case 2: Provider outage toggle
        provider = engine.get_provider()
        current_health = provider.get_health()
        new_outage_state = not current_health.get("outage_active", False)
        provider.set_outage(new_outage_state)
        return {
            "status": "outage_toggled",
            "provider_id": provider.provider_id,
            "outage_active": new_outage_state
        }

    elif req.failure_type == "duplicate_event":
        # Failure Case 4: Duplicate Webhook Events
        # Pick an active or completed call
        call_row = query_one("SELECT id FROM calls ORDER BY id DESC LIMIT 1;")
        if not call_row:
            return {"status": "error", "message": "No active call found"}
        
        call_id = call_row["id"]
        dup_event_id = f"dup_{uuid.uuid4().hex[:8]}"
        
        # Send event twice
        resp1 = await engine.handle_provider_webhook({
            "event_id": dup_event_id,
            "call_id": call_id,
            "provider_id": "PROVIDER_B",
            "event_type": "ANSWERED"
        })
        resp2 = await engine.handle_provider_webhook({
            "event_id": dup_event_id,
            "call_id": call_id,
            "provider_id": "PROVIDER_B",
            "event_type": "ANSWERED"
        })
        return {
            "status": "duplicate_events_injected",
            "first_call_response": resp1,
            "second_call_response": resp2
        }

    elif req.failure_type == "out_of_order":
        # Failure Case 5: Out of order events (COMPLETED arrives before ANSWERED)
        call_row = query_one("SELECT id FROM calls WHERE state IN ('INITIATED', 'RINGING') ORDER BY id DESC LIMIT 1;")
        if not call_row:
            return {"status": "error", "message": "No ringing/initiated call found to inject"}
        
        call_id = call_row["id"]
        # Deliver COMPLETED first
        resp1 = await engine.handle_provider_webhook({
            "event_id": f"evt_{uuid.uuid4().hex[:8]}",
            "call_id": call_id,
            "provider_id": "PROVIDER_B",
            "event_type": "COMPLETED",
            "talk_time_sec": 10.0
        })
        # Deliver late ANSWERED afterwards
        resp2 = await engine.handle_provider_webhook({
            "event_id": f"evt_{uuid.uuid4().hex[:8]}",
            "call_id": call_id,
            "provider_id": "PROVIDER_B",
            "event_type": "ANSWERED"
        })
        return {
            "status": "out_of_order_events_injected",
            "completed_event_response": resp1,
            "late_answered_response": resp2
        }

    raise HTTPException(status_code=400, detail="Unknown failure type")


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    q = engine.subscribe()
    try:
        while True:
            # Send current snapshot every 1 second or upon queue events
            status = engine.get_system_status()
            recent_calls = query_all(
                """
                SELECT c.id, c.borrower_id, c.agent_id, c.state, c.mode, c.created_at, c.talk_time_sec, c.error_reason,
                       b.name as borrower_name
                FROM calls c
                JOIN borrowers b ON c.borrower_id = b.id
                ORDER BY c.created_at DESC
                LIMIT 15;
                """
            )
            recent_agents = query_all("SELECT id, name, state, total_calls, total_talk_time_sec FROM agents ORDER BY id ASC LIMIT 50;")
            
            payload = {
                "type": "SNAPSHOT",
                "status": status,
                "calls": recent_calls,
                "agents": recent_agents
            }
            await websocket.send_text(json.dumps(payload))
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        engine.unsubscribe(q)
    except Exception as e:
        logger.debug(f"WebSocket closed: {e}")
        engine.unsubscribe(q)
