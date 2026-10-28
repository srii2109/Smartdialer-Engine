"""Atomic SQL-based Agent and Borrower Allocator.

Solves the distributed multi-worker concurrency problem using atomic SQL updates
with row-level condition checking (Optimistic Concurrency Control / Compare-And-Swap).
Guarantees that two workers racing for the same agent will NEVER both reserve it.
"""

import sqlite3
from typing import Optional, Dict, Any, List
import logging
from app.database import get_db
from app.models import AgentState, CallState
from app.state_machines import AgentStateMachine

logger = logging.getLogger("smartdialer.allocator")


class AllocationError(Exception):
    pass


class Allocator:
    """Handles atomic allocation of agents and borrowers via transactional SQL."""

    @staticmethod
    def reserve_specific_agent(agent_id: str, worker_id: str) -> Optional[Dict[str, Any]]:
        """Atomically reserves a specific agent by ID.
        
        If another worker beat us to it, the WHERE condition (state = 'AVAILABLE')
        fails and 0 rows are returned.
        """
        with get_db() as conn:
            cur = conn.cursor()
            # Atomic update returning the updated row if and only if state was AVAILABLE
            cur.execute(
                """
                UPDATE agents
                SET state = 'RESERVED',
                    worker_id = ?,
                    reserved_at = CURRENT_TIMESTAMP,
                    last_heartbeat = CURRENT_TIMESTAMP,
                    version = version + 1
                WHERE id = ? AND state = 'AVAILABLE'
                RETURNING id, name, state, worker_id, version;
                """,
                (worker_id, agent_id)
            )
            row = cur.fetchone()
            if row:
                return dict(row)
            return None

    @staticmethod
    def reserve_next_available_agent(worker_id: str) -> Optional[Dict[str, Any]]:
        """Atomically finds and claims one available agent in a single transaction.
        
        Uses an atomic subquery with LIMIT 1.
        """
        with get_db() as conn:
            cur = conn.cursor()
            # Atomic selection and lock in SQLite:
            # We locate an agent id that is currently AVAILABLE, then update it atomically.
            cur.execute(
                """
                UPDATE agents
                SET state = 'RESERVED',
                    worker_id = ?,
                    reserved_at = CURRENT_TIMESTAMP,
                    last_heartbeat = CURRENT_TIMESTAMP,
                    version = version + 1
                WHERE id = (
                    SELECT id FROM agents
                    WHERE state = 'AVAILABLE'
                    ORDER BY id ASC
                    LIMIT 1
                )
                RETURNING id, name, state, worker_id, version;
                """,
                (worker_id,)
            )
            row = cur.fetchone()
            if row:
                return dict(row)
            return None

    @staticmethod
    def reserve_next_borrower() -> Optional[Dict[str, Any]]:
        """Atomically claims the highest priority unprocessed borrower."""
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                UPDATE borrowers
                SET state = 'RESERVED',
                    attempts = attempts + 1,
                    last_attempt_at = CURRENT_TIMESTAMP,
                    version = version + 1
                WHERE id = (
                    SELECT id FROM borrowers
                    WHERE state = 'UNPROCESSED'
                    ORDER BY priority DESC, id ASC
                    LIMIT 1
                )
                RETURNING id, name, phone, priority, state, attempts, version;
                """,
                ()
            )
            row = cur.fetchone()
            if row:
                return dict(row)
            return None

    @staticmethod
    def transition_agent(agent_id: str, target_state: AgentState, worker_id: Optional[str] = None, conn: Optional[sqlite3.Connection] = None) -> bool:
        """Transitions an agent's state while verifying state machine rules."""
        def _do_transition(c: sqlite3.Connection) -> bool:
            cur = c.cursor()
            cur.execute("SELECT id, state, version FROM agents WHERE id = ?;", (agent_id,))
            row = cur.fetchone()
            if not row:
                return False

            current_state = AgentState(row["state"])
            # Validate through state machine
            AgentStateMachine.transition(current_state, target_state)

            worker_sql = ", worker_id = ?" if worker_id is not None else ""
            params = [target_state.value]
            if worker_id is not None:
                params.append(worker_id)
            params.extend([agent_id, row["version"]])

            query = f"""
                UPDATE agents
                SET state = ?{worker_sql},
                    last_heartbeat = CURRENT_TIMESTAMP,
                    version = version + 1
                WHERE id = ? AND version = ?;
            """
            cur.execute(query, tuple(params))
            return cur.rowcount > 0

        if conn is not None:
            return _do_transition(conn)
        with get_db() as c:
            return _do_transition(c)

    @staticmethod
    def release_agent(agent_id: str, new_state: AgentState = AgentState.AVAILABLE, conn: Optional[sqlite3.Connection] = None) -> bool:
        """Releases an agent back to AVAILABLE (or PAUSED/OFFLINE)."""
        def _do_release(c: sqlite3.Connection) -> bool:
            cur = c.cursor()
            cur.execute(
                """
                UPDATE agents
                SET state = ?,
                    worker_id = NULL,
                    reserved_at = NULL,
                    last_heartbeat = CURRENT_TIMESTAMP,
                    version = version + 1
                WHERE id = ?;
                """,
                (new_state.value, agent_id)
            )
            return cur.rowcount > 0

        if conn is not None:
            return _do_release(conn)
        with get_db() as c:
            return _do_release(c)

    @staticmethod
    def reset_borrower(borrower_id: str, mark_failed: bool = False, conn: Optional[sqlite3.Connection] = None) -> None:
        """Resets borrower state if call was not completed or failed."""
        def _do_reset(c: sqlite3.Connection):
            cur = c.cursor()
            new_state = "FAILED" if mark_failed else "UNPROCESSED"
            cur.execute(
                """
                UPDATE borrowers
                SET state = ?,
                    version = version + 1
                WHERE id = ?;
                """,
                (new_state, borrower_id)
            )

        if conn is not None:
            _do_reset(conn)
        else:
            with get_db() as c:
                _do_reset(c)
