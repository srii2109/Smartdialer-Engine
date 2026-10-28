import { query, withTransaction } from './db.js';

export class Reconciler {
  constructor(staleReservationSec = 15, callTimeoutSec = 40) {
    this.staleReservationSec = staleReservationSec;
    this.callTimeoutSec = callTimeoutSec;
    this.isRunning = false;
    this.timer = null;
  }

  start(intervalMs = 2500) {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[Reconciler] Recovery sweeper loop active.');
    this.timer = setInterval(async () => {
      try {
        await this.reconcileAll();
      } catch (e) {
        console.error('[Reconciler] Cycle error:', e.message);
      }
    }, intervalMs);
  }

  stop() {
    this.isRunning = false;
    if (this.timer) clearInterval(this.timer);
  }

  async reconcileAll() {
    const crashedCalls = await this.reconcileCrashedWorkerCalls();
    const staleAgents = await this.reconcileStaleAgentReservations();
    const stuckCalls = await this.reconcileStuckRingingCalls();
    return {
      crashedWorkerCallsRecovered: crashedCalls,
      staleAgentReservationsFreed: staleAgents,
      stuckRingingCallsTimedOut: stuckCalls
    };
  }

  /**
   * Recovers orphaned calls where a worker initiated reservation or dialing but died before completion.
   * Demonstrates Failure Case 1: Agent reserved > Borrower reserved > Call initiated > Worker crashes.
   */
  async reconcileCrashedWorkerCalls() {
    const stuckCalls = await query(
      `SELECT id, borrower_id, agent_id, worker_id, state, created_at
       FROM calls
       WHERE state IN ('RESERVED', 'INITIATED')
         AND TIMESTAMPDIFF(SECOND, created_at, NOW()) > ?;`,
      [this.staleReservationSec]
    );

    let recovered = 0;
    for (const call of stuckCalls) {
      console.warn(`[Reconciler] Recovering orphaned call ${call.id} from crashed worker ${call.worker_id}`);
      await withTransaction(async (conn) => {
        await conn.query(
          `UPDATE calls 
           SET state = 'FAILED', ended_at = NOW(), error_reason = 'WORKER_CRASH_OR_TIMEOUT_RECOVERED', version = version + 1
           WHERE id = ?;`,
          [call.id]
        );

        if (call.agent_id) {
          await conn.query(
            `UPDATE agents 
             SET state = 'AVAILABLE', worker_id = NULL, reserved_at = NULL, last_heartbeat = NOW(), version = version + 1
             WHERE id = ?;`,
            [call.agent_id]
          );
        }

        if (call.borrower_id) {
          await conn.query(
            `UPDATE borrowers SET state = 'UNPROCESSED', version = version + 1 WHERE id = ?;`,
            [call.borrower_id]
          );
        }
      });
      recovered++;
    }
    return recovered;
  }

  /**
   * Frees agents stuck in RESERVED or DIALING where worker never placed a call.
   */
  async reconcileStaleAgentReservations() {
    const staleAgents = await query(
      `SELECT id, state 
       FROM agents
       WHERE state IN ('RESERVED', 'DIALING')
         AND TIMESTAMPDIFF(SECOND, COALESCE(reserved_at, last_heartbeat), NOW()) > ?;`,
      [this.staleReservationSec]
    );

    let recovered = 0;
    for (const ag of staleAgents) {
      const activeCalls = await query(
        `SELECT id FROM calls WHERE agent_id = ? AND state IN ('CONNECTED', 'ANSWERED');`,
        [ag.id]
      );
      if (activeCalls.length === 0) {
        console.warn(`[Reconciler] Agent ${ag.id} stuck in ${ag.state}. Resetting to AVAILABLE.`);
        await query(
          `UPDATE agents 
           SET state = 'AVAILABLE', worker_id = NULL, reserved_at = NULL, last_heartbeat = NOW(), version = version + 1
           WHERE id = ?;`,
          [ag.id]
        );
        recovered++;
      }
    }
    return recovered;
  }

  /**
   * Cleans up calls ringing past carrier limits.
   */
  async reconcileStuckRingingCalls() {
    const timedOutCalls = await query(
      `SELECT id, agent_id, borrower_id 
       FROM calls 
       WHERE state = 'RINGING' 
         AND TIMESTAMPDIFF(SECOND, initiated_at, NOW()) > ?;`,
      [this.callTimeoutSec]
    );

    let recovered = 0;
    for (const c of timedOutCalls) {
      console.log(`[Reconciler] Ringing call ${c.id} timed out. Marking FAILED (NO_ANSWER).`);
      await withTransaction(async (conn) => {
        await conn.query(
          `UPDATE calls 
           SET state = 'FAILED', ended_at = NOW(), error_reason = 'RING_TIMEOUT_NO_ANSWER', version = version + 1
           WHERE id = ?;`,
          [c.id]
        );
        if (c.agent_id) {
          await conn.query(
            `UPDATE agents SET state = 'AVAILABLE', worker_id = NULL, version = version + 1 WHERE id = ?;`,
            [c.agent_id]
          );
        }
      });
      recovered++;
    }
    return recovered;
  }
}
