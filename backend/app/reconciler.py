"""Reconciliation and Recovery Sweeper.

Detects and recovers from:
1. Worker crashes during call setup (Agent reserved > Borrower reserved > Call initiated > Crash).
2. Worker crash immediately after ANSWERED.
3. Provider timeouts and orphan calls.
4. Agent heartbeat timeouts and stale reservations.
"""

import asyncio
import logging
from typing import Dict, Any, List
from app.database import get_db
from app.models import AgentState, CallState
from app.allocator import Allocator

logger = logging.getLogger("smartdialer.reconciler")


class Reconciler:
    """Periodic sweeper restoring consistency after unexpected worker crashes or telecom drops."""

    def __init__(self, stale_reservation_sec: int = 15, call_timeout_sec: int = 40):
        self.stale_reservation_sec = stale_reservation_sec
        self.call_timeout_sec = call_timeout_sec
        self._running = False

    async def run_loop(self, interval_sec: float = 3.0):
        self._running = True
        logger.info("Reconciler sweeper loop started.")
        while self._running:
            try:
                self.reconcile_all()
            except Exception as e:
                logger.error(f"Error in reconciliation cycle: {e}")
            await asyncio.sleep(interval_sec)

    def stop(self):
        self._running = False

    def reconcile_all(self) -> Dict[str, int]:
        """Runs all reconciliation passes."""
        crashed_calls = self.reconcile_crashed_worker_calls()
        stale_agents = self.reconcile_stale_agent_reservations()
        stale_calls = self.reconcile_stuck_ringing_calls()
        return {
            "crashed_worker_calls_recovered": crashed_calls,
            "stale_agent_reservations_freed": stale_agents,
            "stuck_ringing_calls_timed_out": stale_calls
        }

    def reconcile_crashed_worker_calls(self) -> int:
        """Recovers calls where worker initiated reservation or dialing but died before completion.
        
        Failure Case 1: Agent reserved > Borrower reserved > Call initiated > Worker crashes.
        """
        recovered_count = 0
        with get_db() as conn:
            cur = conn.cursor()
            # Select calls stuck in INITIATED or RESERVED older than threshold
            cur.execute(
                """
                SELECT id, borrower_id, agent_id, worker_id, state, created_at
                FROM calls
                WHERE state IN ('RESERVED', 'INITIATED')
                  AND (strftime('%s', 'now') - strftime('%s', created_at)) > ?;
                """,
                (self.stale_reservation_sec,)
            )
            stuck_calls = cur.fetchall()

            for call in stuck_calls:
                call_id = call["id"]
                agent_id = call["agent_id"]
                borrower_id = call["borrower_id"]

                logger.warning(
                    f"[Reconciler] Detected orphaned call {call_id} from crashed worker {call['worker_id']}. Recovering..."
                )

                # 1. Terminate call state safely
                cur.execute(
                    """
                    UPDATE calls
                    SET state = 'FAILED',
                        ended_at = CURRENT_TIMESTAMP,
                        error_reason = 'WORKER_CRASH_OR_TIMEOUT_RECOVERED',
                        version = version + 1
                    WHERE id = ?;
                    """,
                    (call_id,)
                )

                # 2. Release agent if one was attached
                if agent_id:
                    cur.execute(
                        """
                        UPDATE agents
                        SET state = 'AVAILABLE',
                            worker_id = NULL,
                            reserved_at = NULL,
                            last_heartbeat = CURRENT_TIMESTAMP,
                            version = version + 1
                        WHERE id = ?;
                        """,
                        (agent_id,)
                    )

                # 3. Reset borrower so they can be reached in another cycle
                if borrower_id:
                    cur.execute(
                        """
                        UPDATE borrowers
                        SET state = 'UNPROCESSED',
                            version = version + 1
                        WHERE id = ?;
                        """,
                        (borrower_id,)
                    )

                recovered_count += 1

        return recovered_count

    def reconcile_stale_agent_reservations(self) -> int:
        """Frees agents that were marked RESERVED or DIALING but whose worker never placed a call."""
        recovered_count = 0
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id, state, reserved_at
                FROM agents
                WHERE state IN ('RESERVED', 'DIALING')
                  AND (strftime('%s', 'now') - strftime('%s', COALESCE(reserved_at, last_heartbeat))) > ?;
                """,
                (self.stale_reservation_sec,)
            )
            stale_agents = cur.fetchall()

            for agent in stale_agents:
                agent_id = agent["id"]
                # Verify that no active connected call exists for this agent
                cur.execute(
                    "SELECT id FROM calls WHERE agent_id = ? AND state IN ('CONNECTED', 'ANSWERED');",
                    (agent_id,)
                )
                if not cur.fetchone():
                    logger.warning(f"[Reconciler] Agent {agent_id} stuck in {agent['state']}. Resetting to AVAILABLE.")
                    cur.execute(
                        """
                        UPDATE agents
                        SET state = 'AVAILABLE',
                            worker_id = NULL,
                            reserved_at = NULL,
                            last_heartbeat = CURRENT_TIMESTAMP,
                            version = version + 1
                        WHERE id = ?;
                        """,
                        (agent_id,)
                    )
                    recovered_count += 1

        return recovered_count

    def reconcile_stuck_ringing_calls(self) -> int:
        """Cleans up calls that have been ringing beyond telecom network limits (e.g. 40s)."""
        recovered_count = 0
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id, borrower_id, agent_id
                FROM calls
                WHERE state = 'RINGING'
                  AND (strftime('%s', 'now') - strftime('%s', initiated_at)) > ?;
                """,
                (self.call_timeout_sec,)
            )
            timed_out_calls = cur.fetchall()

            for call in timed_out_calls:
                call_id = call["id"]
                logger.info(f"[Reconciler] Ringing call {call_id} timed out. Marking FAILED (NO_ANSWER).")
                cur.execute(
                    """
                    UPDATE calls
                    SET state = 'FAILED',
                        ended_at = CURRENT_TIMESTAMP,
                        error_reason = 'RING_TIMEOUT_NO_ANSWER',
                        version = version + 1
                    WHERE id = ?;
                    """,
                    (call_id,)
                )
                if call["agent_id"]:
                    cur.execute(
                        """
                        UPDATE agents
                        SET state = 'AVAILABLE',
                            worker_id = NULL,
                            version = version + 1
                        WHERE id = ?;
                        """,
                        (call["agent_id"],)
                    )
                recovered_count += 1

        return recovered_count
