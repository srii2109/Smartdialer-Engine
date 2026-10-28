-- SmartDialer MySQL Schema (Engine: InnoDB)
-- Supports ACID transactions, row-level locking, and optimistic concurrency control.

CREATE DATABASE IF NOT EXISTS smartdialer;
USE smartdialer;

CREATE TABLE IF NOT EXISTS agents (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE',
    worker_id VARCHAR(64) NULL,
    reserved_at DATETIME NULL,
    last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 1,
    total_calls INT NOT NULL DEFAULT 0,
    total_talk_time_sec DOUBLE NOT NULL DEFAULT 0.0,
    INDEX idx_agents_state (state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS borrowers (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    priority INT NOT NULL DEFAULT 1,
    state VARCHAR(32) NOT NULL DEFAULT 'UNPROCESSED',
    attempts INT NOT NULL DEFAULT 0,
    last_attempt_at DATETIME NULL,
    version INT NOT NULL DEFAULT 1,
    INDEX idx_borrowers_state_priority (state, priority DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS calls (
    id VARCHAR(64) PRIMARY KEY,
    borrower_id VARCHAR(64) NOT NULL,
    agent_id VARCHAR(64) NULL,
    worker_id VARCHAR(64) NULL,
    provider_id VARCHAR(64) NOT NULL,
    provider_call_id VARCHAR(128) NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
    mode VARCHAR(32) NOT NULL DEFAULT 'PROGRESSIVE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    initiated_at DATETIME NULL,
    answered_at DATETIME NULL,
    connected_at DATETIME NULL,
    ended_at DATETIME NULL,
    talk_time_sec DOUBLE DEFAULT 0.0,
    error_reason TEXT NULL,
    version INT NOT NULL DEFAULT 1,
    INDEX idx_calls_state (state),
    INDEX idx_calls_agent (agent_id),
    CONSTRAINT fk_calls_borrower FOREIGN KEY (borrower_id) REFERENCES borrowers(id) ON DELETE CASCADE,
    CONSTRAINT fk_calls_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Idempotency log for webhook deduplication
CREATE TABLE IF NOT EXISTS events_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    event_id VARCHAR(128) UNIQUE NOT NULL,
    call_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    raw_payload TEXT NULL,
    INDEX idx_events_call (call_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Safety Controller audit trail
CREATE TABLE IF NOT EXISTS safety_decisions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    mode VARCHAR(32) NOT NULL,
    requested_calls INT NOT NULL,
    approved_calls INT NOT NULL,
    decision VARCHAR(64) NOT NULL,
    reason TEXT NOT NULL,
    available_agents INT NOT NULL,
    ringing_calls INT NOT NULL,
    provider_health_pct DOUBLE NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Campaign settings
CREATE TABLE IF NOT EXISTS campaign_config (
    `key` VARCHAR(64) PRIMARY KEY,
    `value` VARCHAR(256) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
