"""SmartDialer Core Engine.

Orchestrates the entire dialing pipeline:
Campaign -> Pacing Engine -> Safety Controller -> Call Allocator -> Telecom Provider

Coordinates concurrent workers, processes telecom webhooks idempotently,
and manages agent call assignment in both Progressive and Predictive modes.
"""

import asyncio
import logging
import sqlite3
import time
import uuid
from typing import Dict, Any, Optional, List
from app.database import get_db, query_one, query_all
from app.models import AgentState, CallState, DialingMode, SafetyDecisionType
from app.state_machines import AgentStateMachine, CallStateMachine, InvalidStateTransitionError
from app.allocator import Allocator
from app.pacing import PacingEngine
from app.safety import SafetyController
from app.providers import ITelecomProvider, ProviderA, ProviderB

logger = logging.getLogger("smartdialer.dialer")


class SmartDialerEngine:
    def __init__(self):
        self.safety_controller = SafetyController(max_allowed_abandonment_rate=0.03)
        self.providers: Dict[str, ITelecomProvider] = {
            "PROVIDER_A": ProviderA(),
            "PROVIDER_B": ProviderB(),
        }
        self._is_running = False
        self._worker_tasks: List[asyncio.Task] = []
        self._subscribers: List[asyncio.Queue] = []
        self._abandoned_calls_count = 0
        self._total_connected_calls = 0

    @property
    def is_running(self) -> bool:
        return self._is_running

    def get_provider(self, provider_id: Optional[str] = None) -> ITelecomProvider:
        if not provider_id:
            cfg = query_one("SELECT value FROM campaign_config WHERE key = 'active_provider';")
            provider_id = cfg["value"] if cfg else "PROVIDER_A"
        return self.providers.get(provider_id, self.providers["PROVIDER_A"])

    def get_mode(self) -> DialingMode:
        cfg = query_one("SELECT value FROM campaign_config WHERE key = 'mode';")
        return DialingMode(cfg["value"]) if cfg else DialingMode.PROGRESSIVE

    def set_mode(self, mode: DialingMode) -> None:
        with get_db() as conn:
            conn.execute("UPDATE campaign_config SET value = ? WHERE key = 'mode';", (mode.value,))
        logger.info(f"Campaign dialing mode changed to: {mode.value}")

    def set_provider(self, provider_id: str) -> None:
        if provider_id in self.providers:
            with get_db() as conn:
                conn.execute("UPDATE campaign_config SET value = ? WHERE key = 'active_provider';", (provider_id,))
            logger.info(f"Active provider switched to: {provider_id}")

    async def start(self, num_workers: int = 3):
        """Starts dialer orchestration loop and background worker tasks."""
        if self._is_running:
            return
        self._is_running = True
        logger.info(f"Starting SmartDialer Engine with {num_workers} workers...")
        self._worker_tasks = [
            asyncio.create_task(self._worker_loop(f"worker_{i+1}"))
            for i in range(num_workers)
        ]

    async def stop(self):
        """Stops the dialer engine cleanly."""
        self._is_running = False
        for task in self._worker_tasks:
            task.cancel()
        self._worker_tasks.clear()
        logger.info("SmartDialer Engine stopped.")

    async def _worker_loop(self, worker_id: str):
        """Worker loop that continuously evaluates pacing, passes through Safety Controller, and dispatches calls."""
        while self._is_running:
            try:
                # 1. Fetch current campaign status
                running_cfg = query_one("SELECT value FROM campaign_config WHERE key = 'is_running';")
                if not running_cfg or running_cfg["value"] != "1":
                    await asyncio.sleep(1.0)
                    continue

                mode = self.get_mode()
                provider = self.get_provider()

                # 2. Query system metrics atomically from SQL
                stats = self._query_queue_stats()
                available_agents = stats["available_agents"]
                connected_agents = stats["connected_agents"]
                ringing_calls = stats["ringing_calls"]

                # 3. PACING ENGINE: Calculate recommended calls
                pacing_result = PacingEngine.calculate_calls(
                    mode=mode,
                    available_agents=available_agents,
                    connected_agents=connected_agents,
                    ringing_calls=ringing_calls,
                    historical_answer_rate=provider.simulated_answer_rate,
                    avg_talk_time_sec=provider.simulated_talk_time,
                )
                recommended_calls = pacing_result["recommended_calls"]

                # 4. SAFETY CONTROLLER: Mandatory non-bypassable checkpoint
                safety_eval = self.safety_controller.evaluate(
                    mode=mode,
                    requested_calls=recommended_calls,
                    available_agents=available_agents,
                    connected_agents=connected_agents,
                    ringing_calls=ringing_calls,
                    provider_health=provider.get_health(),
                    historical_answer_rate=provider.simulated_answer_rate
                )

                approved_calls = safety_eval.approved_calls

                # Broadcast live status update to UI
                await self._broadcast_event({
                    "type": "PACING_CYCLE",
                    "worker_id": worker_id,
                    "mode": mode.value,
                    "recommended_calls": recommended_calls,
                    "approved_calls": approved_calls,
                    "decision": safety_eval.decision.value,
                    "reason": safety_eval.reason
                })

                # 5. CALL ALLOCATOR & DISPATCH
                if approved_calls > 0:
                    # Dispatch up to approved_calls (workers collaborate)
                    # To prevent one worker monopolizing the batch, dispatch 1-3 per worker tick
                    batch_to_dispatch = min(approved_calls, 3)
                    for _ in range(batch_to_dispatch):
                        dispatched = await self._dispatch_single_call(worker_id, mode, provider)
                        if not dispatched:
                            break # No more agents or borrowers available
                        await asyncio.sleep(0.05)

                await asyncio.sleep(0.8)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[{worker_id}] Dialing cycle error: {e}", exc_info=True)
                await asyncio.sleep(1.5)

    async def _dispatch_single_call(self, worker_id: str, mode: DialingMode, provider: ITelecomProvider) -> bool:
        """Atomically claims borrower (and agent if progressive) and dispatches call to provider."""
        call_id = f"call_{uuid.uuid4().hex[:10]}"
        agent = None

        # In PROGRESSIVE mode, we MUST atomically reserve the agent BEFORE dialing
        if mode == DialingMode.PROGRESSIVE:
            agent = Allocator.reserve_next_available_agent(worker_id=worker_id)
            if not agent:
                return False # No free agent right now

        # Atomically claim highest priority borrower
        borrower = Allocator.reserve_next_borrower()
        if not borrower:
            # If we reserved an agent but no borrowers are left, release agent back to AVAILABLE
            if agent:
                Allocator.release_agent(agent["id"], AgentState.AVAILABLE)
            return False

        agent_id = agent["id"] if agent else None

        # Insert Call in SQL in INITIATED state
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO calls (id, borrower_id, agent_id, worker_id, provider_id, state, mode, initiated_at, version)
                VALUES (?, ?, ?, ?, ?, 'INITIATED', ?, CURRENT_TIMESTAMP, 1);
                """,
                (call_id, borrower["id"], agent_id, worker_id, provider.provider_id, mode.value)
            )

        # In Progressive mode, update agent to DIALING
        if agent:
            Allocator.transition_agent(agent["id"], AgentState.DIALING, worker_id=worker_id)

        # Notify UI of dispatch
        await self._broadcast_event({
            "type": "CALL_DISPATCHED",
            "call_id": call_id,
            "borrower_id": borrower["id"],
            "agent_id": agent_id,
            "mode": mode.value,
            "provider_id": provider.provider_id
        })

        # Initiate with telecom provider
        try:
            provider_call_id = await provider.initiate_call(
                call_id=call_id,
                phone=borrower["phone"],
                webhook_cb=self.handle_provider_webhook
            )
            with get_db() as conn:
                conn.execute(
                    "UPDATE calls SET provider_call_id = ? WHERE id = ?;",
                    (provider_call_id, call_id)
                )
            return True
        except Exception as e:
            logger.error(f"Provider failed to initiate call {call_id}: {e}")
            # Provider failure: cleanup call, release agent and borrower
            self._handle_initiation_failure(call_id, agent_id, borrower["id"], str(e))
            return False

    def _handle_initiation_failure(self, call_id: str, agent_id: Optional[str], borrower_id: str, error_msg: str):
        with get_db() as conn:
            conn.execute(
                """
                UPDATE calls
                SET state = 'FAILED',
                    ended_at = CURRENT_TIMESTAMP,
                    error_reason = ?
                WHERE id = ?;
                """,
                (f"PROVIDER_INIT_ERROR: {error_msg}", call_id)
            )
        if agent_id:
            Allocator.release_agent(agent_id, AgentState.AVAILABLE)
        Allocator.reset_borrower(borrower_id, mark_failed=False)

    async def handle_provider_webhook(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """Webhook listener for telecom provider events.
        
        Guarantees idempotency via SQL event log and handles duplicate or out-of-order events.
        """
        event_id = event.get("event_id", f"gen_{uuid.uuid4().hex[:8]}")
        call_id = event["call_id"]
        incoming_event_type = event["event_type"]

        logger.debug(f"[Webhook] Received {incoming_event_type} for call {call_id} (event_id={event_id})")

        # 1. IDEMPOTENCY CHECK via SQL events_log
        with get_db() as conn:
            cur = conn.cursor()
            try:
                cur.execute(
                    """
                    INSERT INTO events_log (event_id, call_id, event_type, raw_payload)
                    VALUES (?, ?, ?, ?);
                    """,
                    (event_id, call_id, incoming_event_type, str(event))
                )
            except sqlite3.IntegrityError:
                # Duplicate event_id received!
                logger.warning(f"[Webhook] Duplicate event {event_id} ignored (SQL unique constraint hit).")
                return {"status": "IGNORED", "reason": "DUPLICATE_EVENT_ID"}

        # 2. FETCH CURRENT CALL STATE
        call_row = query_one("SELECT * FROM calls WHERE id = ?;", (call_id,))
        if not call_row:
            logger.error(f"[Webhook] Received event for unknown call: {call_id}")
            return {"status": "ERROR", "reason": "UNKNOWN_CALL_ID"}

        current_call_state = CallState(call_row["state"])
        try:
            target_call_state = CallState(incoming_event_type)
        except ValueError:
            target_call_state = CallState.FAILED

        # 3. STATE MACHINE EVALUATION (Handles out-of-order, duplicates, terminal states)
        try:
            next_state, is_applied, note = CallStateMachine.transition_with_event(
                current_state=current_call_state,
                incoming_state=target_call_state,
                event_id=event_id
            )
        except InvalidStateTransitionError as ex:
            logger.warning(f"[Webhook] Invalid transition rejected: {ex}")
            return {"status": "REJECTED", "reason": str(ex)}

        if not is_applied:
            logger.info(f"[Webhook] State transition not applied: {note}")
            return {"status": "IGNORED", "reason": note}

        # 4. APPLY TRANSITION AND MANAGE AGENT ASSIGNMENT
        await self._apply_call_transition(call_row, next_state, event)

        return {"status": "SUCCESS", "new_state": next_state.value, "note": note}

    async def _apply_call_transition(self, call: Dict[str, Any], next_state: CallState, event: Dict[str, Any]):
        call_id = call["id"]
        agent_id = call["agent_id"]
        borrower_id = call["borrower_id"]
        mode = DialingMode(call["mode"])

        with get_db() as conn:
            cur = conn.cursor()

            if next_state == CallState.RINGING:
                cur.execute("UPDATE calls SET state = 'RINGING', version = version + 1 WHERE id = ?;", (call_id,))

            elif next_state == CallState.ANSWERED:
                # In Predictive Mode: call may not have an agent allocated yet!
                if not agent_id and mode == DialingMode.PREDICTIVE:
                    # Allocate next available agent
                    allocated_agent = Allocator.reserve_next_available_agent(worker_id="predictive_bridge")
                    if allocated_agent:
                        agent_id = allocated_agent["id"]
                        cur.execute(
                            """
                            UPDATE calls
                            SET state = 'CONNECTED',
                                agent_id = ?,
                                answered_at = CURRENT_TIMESTAMP,
                                connected_at = CURRENT_TIMESTAMP,
                                version = version + 1
                            WHERE id = ?;
                            """,
                            (agent_id, call_id)
                        )
                        # Transition agent to CONNECTED
                        Allocator.transition_agent(agent_id, AgentState.CONNECTED, conn=conn)
                        self._total_connected_calls += 1
                    else:
                        # CRITICAL PREDICTIVE FAILURE: No agent available when borrower answered!
                        # This is a compliance abandonment violation.
                        self._abandoned_calls_count += 1
                        logger.error(f"[Compliance Violation] Predictive call {call_id} answered but NO agent available! Abandoning call.")
                        cur.execute(
                            """
                            UPDATE calls
                            SET state = 'FAILED',
                                answered_at = CURRENT_TIMESTAMP,
                                ended_at = CURRENT_TIMESTAMP,
                                error_reason = 'COMPLIANCE_ABANDONED_NO_AGENT_AVAILABLE',
                                version = version + 1
                            WHERE id = ?;
                            """,
                            (call_id,)
                        )
                        # Hang up immediately
                        provider = self.get_provider(call["provider_id"])
                        await provider.hangup(call_id)
                        return
                else:
                    # Progressive mode (or predictive where agent was reserved): agent is already assigned
                    cur.execute(
                        """
                        UPDATE calls
                        SET state = 'CONNECTED',
                            answered_at = CURRENT_TIMESTAMP,
                            connected_at = CURRENT_TIMESTAMP,
                            version = version + 1
                        WHERE id = ?;
                        """,
                        (call_id,)
                    )
                    if agent_id:
                        Allocator.transition_agent(agent_id, AgentState.CONNECTED, conn=conn)
                    self._total_connected_calls += 1

            elif next_state == CallState.COMPLETED:
                talk_time = event.get("talk_time_sec", 15.0)
                cur.execute(
                    """
                    UPDATE calls
                    SET state = 'COMPLETED',
                        ended_at = CURRENT_TIMESTAMP,
                        talk_time_sec = ?,
                        version = version + 1
                    WHERE id = ?;
                    """,
                    (talk_time, call_id)
                )
                if agent_id:
                    # Update agent statistics and transition to WRAP_UP
                    cur.execute(
                        """
                        UPDATE agents
                        SET total_calls = total_calls + 1,
                            total_talk_time_sec = total_talk_time_sec + ?
                        WHERE id = ?;
                        """,
                        (talk_time, agent_id)
                    )
                    Allocator.transition_agent(agent_id, AgentState.WRAP_UP, conn=conn)
                    # Agent wrap-up delay (0.5s for demo) then return to AVAILABLE
                    asyncio.create_task(self._auto_agent_wrap_up(agent_id))

            elif next_state in {CallState.FAILED, CallState.CANCELLED}:
                err = event.get("error_reason", "CALL_FAILED")
                cur.execute(
                    """
                    UPDATE calls
                    SET state = ?,
                        ended_at = CURRENT_TIMESTAMP,
                        error_reason = ?,
                        version = version + 1
                    WHERE id = ?;
                    """,
                    (next_state.value, err, call_id)
                )
                if agent_id:
                    Allocator.release_agent(agent_id, AgentState.AVAILABLE, conn=conn)
                # Allow borrower to be retried
                Allocator.reset_borrower(borrower_id, mark_failed=(next_state == CallState.FAILED and err != 'NO_ANSWER'), conn=conn)

        await self._broadcast_event({
            "type": "CALL_STATE_CHANGED",
            "call_id": call_id,
            "new_state": next_state.value,
            "agent_id": agent_id
        })

    async def _auto_agent_wrap_up(self, agent_id: str):
        """Simulates brief agent wrap-up before becoming AVAILABLE again."""
        await asyncio.sleep(0.6)
        Allocator.release_agent(agent_id, AgentState.AVAILABLE)
        await self._broadcast_event({
            "type": "AGENT_STATE_CHANGED",
            "agent_id": agent_id,
            "state": "AVAILABLE"
        })

    def _query_queue_stats(self) -> Dict[str, Any]:
        """Queries counts directly from SQL tables."""
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT
                    SUM(CASE WHEN state = 'AVAILABLE' THEN 1 ELSE 0 END) as available,
                    SUM(CASE WHEN state = 'CONNECTED' THEN 1 ELSE 0 END) as connected,
                    SUM(CASE WHEN state = 'RESERVED' THEN 1 ELSE 0 END) as reserved,
                    SUM(CASE WHEN state = 'DIALING' THEN 1 ELSE 0 END) as dialing,
                    SUM(CASE WHEN state = 'WRAP_UP' THEN 1 ELSE 0 END) as wrap_up,
                    SUM(CASE WHEN state = 'PAUSED' THEN 1 ELSE 0 END) as paused,
                    SUM(CASE WHEN state = 'OFFLINE' THEN 1 ELSE 0 END) as offline,
                    COUNT(*) as total
                FROM agents;
                """
            )
            agent_row = cur.fetchone()

            cur.execute(
                """
                SELECT
                    SUM(CASE WHEN state = 'RINGING' THEN 1 ELSE 0 END) as ringing,
                    SUM(CASE WHEN state = 'INITIATED' THEN 1 ELSE 0 END) as initiated,
                    SUM(CASE WHEN state = 'CONNECTED' THEN 1 ELSE 0 END) as connected_calls,
                    SUM(CASE WHEN state = 'COMPLETED' THEN 1 ELSE 0 END) as completed_calls,
                    SUM(CASE WHEN state = 'FAILED' THEN 1 ELSE 0 END) as failed_calls,
                    COUNT(*) as total_calls
                FROM calls;
                """
            )
            call_row = cur.fetchone()

            cur.execute("SELECT COUNT(*) as safety_cnt FROM safety_decisions;")
            safety_row = cur.fetchone()

            return {
                "available_agents": agent_row["available"] or 0,
                "connected_agents": agent_row["connected"] or 0,
                "reserved_agents": agent_row["reserved"] or 0,
                "dialing_agents": agent_row["dialing"] or 0,
                "wrap_up_agents": agent_row["wrap_up"] or 0,
                "paused_agents": agent_row["paused"] or 0,
                "offline_agents": agent_row["offline"] or 0,
                "total_agents": agent_row["total"] or 0,
                "ringing_calls": (call_row["ringing"] or 0) + (call_row["initiated"] or 0),
                "connected_calls": call_row["connected_calls"] or 0,
                "completed_calls": call_row["completed_calls"] or 0,
                "failed_calls": call_row["failed_calls"] or 0,
                "total_calls": call_row["total_calls"] or 0,
                "safety_count": safety_row["safety_cnt"] or 0
            }

    def get_system_status(self) -> Dict[str, Any]:
        """Provides full real-time operational status for API and React dashboard."""
        stats = self._query_queue_stats()
        mode = self.get_mode()
        provider = self.get_provider()
        provider_health = provider.get_health()

        total_agents = max(1, stats["total_agents"])
        busy_agents = stats["connected_agents"] + stats["dialing_agents"] + stats["wrap_up_agents"]
        agent_utilization = round((busy_agents / total_agents) * 100.0, 1)

        total_ans_or_conn = self._total_connected_calls + self._abandoned_calls_count
        abandonment_rate = 0.0
        if total_ans_or_conn > 0:
            abandonment_rate = round((self._abandoned_calls_count / total_ans_or_conn) * 100.0, 2)

        last_decision = query_one(
            "SELECT * FROM safety_decisions ORDER BY id DESC LIMIT 1;"
        )

        return {
            "mode": mode.value,
            "active_provider": provider.provider_id,
            "is_running": self._is_running,
            "total_agents": stats["total_agents"],
            "available_agents": stats["available_agents"],
            "reserved_agents": stats["reserved_agents"],
            "dialing_agents": stats["dialing_agents"],
            "connected_agents": stats["connected_agents"],
            "wrap_up_agents": stats["wrap_up_agents"],
            "paused_agents": stats["paused_agents"],
            "offline_agents": stats["offline_agents"],
            "active_calls": stats["connected_calls"] + stats["ringing_calls"],
            "ringing_calls": stats["ringing_calls"],
            "connected_calls": stats["connected_calls"],
            "completed_calls": stats["completed_calls"],
            "failed_calls": stats["failed_calls"],
            "abandoned_calls": self._abandoned_calls_count,
            "agent_utilization_pct": agent_utilization,
            "abandonment_rate_pct": abandonment_rate,
            "safety_interventions_count": stats["safety_count"],
            "provider_health": provider_health,
            "last_safety_decision": last_decision
        }

    def subscribe(self) -> asyncio.Queue:
        q = asyncio.Queue(maxsize=100)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        if q in self._subscribers:
            self._subscribers.remove(q)

    async def _broadcast_event(self, data: Dict[str, Any]):
        dead = []
        for q in self._subscribers:
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self.unsubscribe(q)
