-- SmartDialer Relational Schema (SQLite / PostgreSQL Compatible)
-- Clean relational design supporting atomic concurrency, optimistic concurrency control, and audit logs.

CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('OFFLINE', 'AVAILABLE', 'RESERVED', 'DIALING', 'CONNECTED', 'WRAP_UP', 'PAUSED')),
    worker_id TEXT,
    reserved_at TIMESTAMP,
    last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    version INTEGER NOT NULL DEFAULT 1,
    total_calls INTEGER NOT NULL DEFAULT 0,
    total_talk_time_sec REAL NOT NULL DEFAULT 0.0
);

CREATE TABLE IF NOT EXISTS borrowers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL CHECK(state IN ('UNPROCESSED', 'RESERVED', 'CALLED', 'CONNECTED', 'FAILED')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMP,
    version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    borrower_id TEXT NOT NULL REFERENCES borrowers(id),
    agent_id TEXT REFERENCES agents(id),
    worker_id TEXT,
    provider_id TEXT NOT NULL,
    provider_call_id TEXT,
    state TEXT NOT NULL CHECK(state IN ('QUEUED', 'RESERVED', 'INITIATED', 'RINGING', 'ANSWERED', 'CONNECTED', 'COMPLETED', 'FAILED', 'CANCELLED')),
    mode TEXT NOT NULL CHECK(mode IN ('PROGRESSIVE', 'PREDICTIVE')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    initiated_at TIMESTAMP,
    answered_at TIMESTAMP,
    connected_at TIMESTAMP,
    ended_at TIMESTAMP,
    talk_time_sec REAL DEFAULT 0.0,
    error_reason TEXT,
    version INTEGER NOT NULL DEFAULT 1
);

-- Idempotency table for deduplication of external provider webhooks
CREATE TABLE IF NOT EXISTS events_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE NOT NULL,
    call_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    raw_payload TEXT,
    processed INTEGER NOT NULL DEFAULT 1
);

-- Full audit log for the Safety Controller
CREATE TABLE IF NOT EXISTS safety_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    mode TEXT NOT NULL,
    requested_calls INTEGER NOT NULL,
    approved_calls INTEGER NOT NULL,
    decision TEXT NOT NULL, -- 'APPROVED', 'REDUCED', 'REJECTED', 'PROGRESSIVE_FALLBACK'
    reason TEXT NOT NULL,
    available_agents INTEGER NOT NULL,
    ringing_calls INTEGER NOT NULL,
    provider_health_pct REAL NOT NULL
);

-- Dialing campaign configuration
CREATE TABLE IF NOT EXISTS campaign_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Performance indexes for fast atomic querying and claiming
CREATE INDEX IF NOT EXISTS idx_agents_state ON agents(state);
CREATE INDEX IF NOT EXISTS idx_borrowers_state ON borrowers(state, priority DESC);
CREATE INDEX IF NOT EXISTS idx_calls_state ON calls(state);
CREATE INDEX IF NOT EXISTS idx_calls_agent ON calls(agent_id);
CREATE INDEX IF NOT EXISTS idx_events_call ON events_log(call_id);
