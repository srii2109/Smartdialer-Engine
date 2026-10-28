import { pool, withTransaction, query, queryOne } from './db.js';
import { AgentState } from './models/states.js';
import { AgentStateMachine } from './stateMachines.js';

export class Allocator {
  /**
   * Atomically reserve a specific agent by ID.
   * If another worker won the race, affectedRows is 0.
   */
  static async reserveSpecificAgent(agentId, workerId) {
    const [res] = await pool.query(
      `UPDATE agents
       SET state = 'RESERVED',
           worker_id = ?,
           reserved_at = NOW(),
           last_heartbeat = NOW(),
           version = version + 1
       WHERE id = ? AND state = 'AVAILABLE';`,
      [workerId, agentId]
    );

    if (res.affectedRows === 1) {
      return await queryOne('SELECT * FROM agents WHERE id = ?;', [agentId]);
    }
    return null;
  }

  /**
   * Atomically claims the next available agent using MySQL 8.0's FOR UPDATE SKIP LOCKED.
   * Workers never block or collide.
   */
  static async reserveNextAvailableAgent(workerId) {
    return await withTransaction(async (conn) => {
      // 1. Lock next free agent with SKIP LOCKED
      const [rows] = await conn.query(
        `SELECT id, name, state, version 
         FROM agents 
         WHERE state = 'AVAILABLE' 
         ORDER BY id ASC 
         LIMIT 1 
         FOR UPDATE SKIP LOCKED;`
      );

      if (rows.length === 0) return null;
      const agent = rows[0];

      // 2. Claim it
      await conn.query(
        `UPDATE agents
         SET state = 'RESERVED',
             worker_id = ?,
             reserved_at = NOW(),
             last_heartbeat = NOW(),
             version = version + 1
         WHERE id = ?;`,
        [workerId, agent.id]
      );

      return {
        ...agent,
        state: AgentState.RESERVED,
        worker_id: workerId
      };
    });
  }

  /**
   * Atomically claims highest priority unprocessed borrower using FOR UPDATE SKIP LOCKED.
   */
  static async reserveNextBorrower() {
    return await withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT id, name, phone, priority, state, attempts, version
         FROM borrowers
         WHERE state = 'UNPROCESSED'
         ORDER BY priority DESC, id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED;`
      );

      if (rows.length === 0) return null;
      const borrower = rows[0];

      await conn.query(
        `UPDATE borrowers
         SET state = 'RESERVED',
             attempts = attempts + 1,
             last_attempt_at = NOW(),
             version = version + 1
         WHERE id = ?;`,
        [borrower.id]
      );

      return {
        ...borrower,
        state: 'RESERVED',
        attempts: borrower.attempts + 1
      };
    });
  }

  /**
   * Transitions agent state while enforcing state machine invariants.
   */
  static async transitionAgent(agentId, targetState, workerId = null, existingConn = null) {
    const exec = async (conn) => {
      const [rows] = await conn.query('SELECT id, state, version FROM agents WHERE id = ?;', [agentId]);
      if (rows.length === 0) return false;

      const current = rows[0].state;
      AgentStateMachine.transition(current, targetState);

      const workerSql = workerId !== null ? ', worker_id = ?' : '';
      const params = [targetState];
      if (workerId !== null) params.push(workerId);
      params.push(agentId, rows[0].version);

      const [res] = await conn.query(
        `UPDATE agents
         SET state = ?${workerSql},
             last_heartbeat = NOW(),
             version = version + 1
         WHERE id = ? AND version = ?;`,
        params
      );

      return res.affectedRows > 0;
    };

    if (existingConn) {
      return await exec(existingConn);
    }
    return await withTransaction(exec);
  }

  /**
   * Releases an agent back to AVAILABLE (or PAUSED/OFFLINE).
   */
  static async releaseAgent(agentId, newState = AgentState.AVAILABLE, existingConn = null) {
    const sql = `
      UPDATE agents
      SET state = ?,
          worker_id = NULL,
          reserved_at = NULL,
          last_heartbeat = NOW(),
          version = version + 1
      WHERE id = ?;
    `;
    const params = [newState, agentId];

    if (existingConn) {
      const [res] = await existingConn.query(sql, params);
      return res.affectedRows > 0;
    }
    const [res] = await pool.query(sql, params);
    return res.affectedRows > 0;
  }

  /**
   * Resets borrower state when call fails or needs retry.
   */
  static async resetBorrower(borrowerId, markFailed = false, existingConn = null) {
    const newState = markFailed ? 'FAILED' : 'UNPROCESSED';
    const sql = `UPDATE borrowers SET state = ?, version = version + 1 WHERE id = ?;`;
    const params = [newState, borrowerId];

    if (existingConn) {
      await existingConn.query(sql, params);
    } else {
      await pool.query(sql, params);
    }
  }
}
