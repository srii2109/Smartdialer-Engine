"""Database connection and atomic transaction management for SmartDialer.

Uses SQLite with WAL mode enabled to support concurrent worker processes and threads,
with full isolation and transactional guarantees.
"""

import os
import sqlite3
from contextlib import contextmanager
from typing import Generator, List, Dict, Any, Optional

DB_FILE = os.getenv("SMARTDIALER_DB", os.path.join(os.path.dirname(__file__), "..", "smartdialer.db"))
SCHEMA_FILE = os.path.join(os.path.dirname(__file__), "schema.sql")


def get_raw_connection() -> sqlite3.Connection:
    """Creates a raw SQLite connection configured for concurrent access."""
    conn = sqlite3.connect(DB_FILE, timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # Enable WAL mode for high concurrency (readers do not block writers, writers do not block readers)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """Context manager for acquiring a database connection with explicit transaction control."""
    conn = get_raw_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(force_reset: bool = False) -> None:
    """Initializes tables using schema.sql and sets initial defaults."""
    if force_reset and os.path.exists(DB_FILE):
        try:
            os.remove(DB_FILE)
        except OSError:
            pass

    with get_db() as conn:
        with open(SCHEMA_FILE, "r", encoding="utf-8") as f:
            conn.executescript(f.read())
        
        # Initialize default campaign config if empty
        defaults = [
            ("mode", "PROGRESSIVE"),
            ("target_abandonment_rate", "0.03"), # Max 3% per FTC / compliance rules
            ("avg_answer_rate", "0.35"),
            ("avg_talk_time_sec", "90"),
            ("active_provider", "PROVIDER_A"),
            ("is_running", "1"),
        ]
        for key, val in defaults:
            conn.execute(
                "INSERT OR IGNORE INTO campaign_config (key, value) VALUES (?, ?);",
                (key, val)
            )


def seed_data(agent_count: int = 50, borrower_count: int = 300) -> None:
    """Seeds agents and borrowers into the database."""
    with get_db() as conn:
        # Check existing count
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) as cnt FROM agents;")
        existing_agents = cur.fetchone()["cnt"]
        
        if existing_agents == 0:
            agent_data = [
                (
                    f"agent_{i+1:03d}",
                    f"Agent {i+1}",
                    "AVAILABLE",
                    1
                )
                for i in range(agent_count)
            ]
            conn.executemany(
                "INSERT INTO agents (id, name, state, version) VALUES (?, ?, ?, ?);",
                agent_data
            )
        
        cur.execute("SELECT COUNT(*) as cnt FROM borrowers;")
        existing_borrowers = cur.fetchone()["cnt"]
        if existing_borrowers == 0:
            borrower_data = [
                (
                    f"bor_{i+1:04d}",
                    f"Customer {i+1}",
                    f"+1-555-01{i%90+10:02d}",
                    (i % 5) + 1,
                    "UNPROCESSED",
                    1
                )
                for i in range(borrower_count)
            ]
            conn.executemany(
                "INSERT INTO borrowers (id, name, phone, priority, state, version) VALUES (?, ?, ?, ?, ?, ?);",
                borrower_data
            )


def query_all(query: str, params: tuple = ()) -> List[Dict[str, Any]]:
    """Helper to query rows as dictionary list."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(query, params)
        return [dict(r) for r in cur.fetchall()]


def query_one(query: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
    """Helper to query single row as dictionary."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(query, params)
        row = cur.fetchone()
        return dict(row) if row else None


def execute_sql(query: str, params: tuple = ()) -> int:
    """Helper to execute DML query and return rowcount."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(query, params)
        return cur.rowcount
