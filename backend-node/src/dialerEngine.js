import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, withTransaction } from './db.js';
import { AgentState, CallState, DialingMode } from './models/states.js';
import { CallStateMachine } from './stateMachines.js';
import { Allocator } from './allocator.js';
import { PacingEngine } from './pacingEngine.js';
import { SafetyController } from './safetyController.js';
import { ProviderA, ProviderB } from './providers.js';

export class SmartDialerEngine {
  constructor() {
    this.safetyController = new SafetyController(0.03);
    this.providers = {
      PROVIDER_A: new ProviderA(),
      PROVIDER_B: new ProviderB()
    };
    this.isRunning = false;
    this.workers = [];
    this.subscribers = new Set();
    this.abandonedCallsCount = 0;
    this.totalConnectedCalls = 0;
  }

  async getMode() {
    const row = await queryOne("SELECT `value` FROM campaign_config WHERE `key` = 'mode';");
    return row ? row.value : DialingMode.PROGRESSIVE;
  }

  async setMode(mode) {
    await query("UPDATE campaign_config SET `value` = ? WHERE `key` = 'mode';", [mode]);
    console.log(`[Engine] Mode switched to: ${mode}`);
  }

  async getActiveProviderId() {
    const row = await queryOne("SELECT `value` FROM campaign_config WHERE `key` = 'active_provider';");
    return row ? row.value : 'PROVIDER_A';
  }

  async setActiveProvider(providerId) {
    if (this.providers[providerId]) {
      await query("UPDATE campaign_config SET `value` = ? WHERE `key` = 'active_provider';", [providerId]);
      console.log(`[Engine] Active provider set to: ${providerId}`);
    }
  }

  getProvider(providerId = null) {
    if (providerId && this.providers[providerId]) {
      return this.providers[providerId];
    }
    return this.providers.PROVIDER_A;
  }

  async start(numWorkers = 3) {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[Engine] Starting SmartDialer with ${numWorkers} concurrent workers...`);

    for (let i = 1; i <= numWorkers; i++) {
      this.runWorkerLoop(`worker_${i}`);
    }
  }

  stop() {
    this.isRunning = false;
    console.log('[Engine] SmartDialer stopped.');
  }

  async runWorkerLoop(workerId) {
    while (this.isRunning) {
      try {
        const runningRow = await queryOne("SELECT `value` FROM campaign_config WHERE `key` = 'is_running';");
        if (!runningRow || runningRow.value !== '1') {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        const mode = await this.getMode();
        const providerId = await this.getActiveProviderId();
        const provider = this.getProvider(providerId);

        // 1. Fetch current queue statistics
        const stats = await this.queryQueueStats();

        // 2. PACING ENGINE: Calculate recommended calls
        const pacingResult = PacingEngine.calculateCalls({
          mode,
          availableAgents: stats.availableAgents,
          connectedAgents: stats.connectedAgents,
          ringingCalls: stats.ringingCalls,
          historicalAnswerRate: provider.simulatedAnswerRate,
          avgTalkTimeSec: provider.simulatedTalkTime
        });

        // 3. SAFETY CONTROLLER: Non-bypassable gatekeeper
        const safetyEval = await this.safetyController.evaluate({
          mode,
          requestedCalls: pacingResult.recommendedCalls,
          availableAgents: stats.availableAgents,
          connectedAgents: stats.connectedAgents,
          ringingCalls: stats.ringingCalls,
          providerHealth: provider.getHealth(),
          historicalAnswerRate: provider.simulatedAnswerRate
        });

        this.broadcast({
          type: 'PACING_CYCLE',
          workerId,
          mode,
          recommendedCalls: pacingResult.recommendedCalls,
          approvedCalls: safetyEval.approvedCalls,
          decision: safetyEval.decision,
          reason: safetyEval.reason
        });

        // 4. CALL ALLOCATOR & DISPATCH
        if (safetyEval.approvedCalls > 0) {
          const batch = Math.min(safetyEval.approvedCalls, 3);
          for (let b = 0; b < batch; b++) {
            const ok = await this.dispatchSingleCall(workerId, mode, provider);
            if (!ok) break;
            await new Promise((r) => setTimeout(r, 60));
          }
        }

        await new Promise((r) => setTimeout(r, 800));
      } catch (err) {
        console.error(`[${workerId}] Cycle error:`, err.message);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }

  async dispatchSingleCall(workerId, mode, provider) {
    const callId = `call_${uuidv4().substring(0, 10)}`;
    let agent = null;

    // Progressive mode requires reserving agent BEFORE dialing
    if (mode === DialingMode.PROGRESSIVE) {
      agent = await Allocator.reserveNextAvailableAgent(workerId);
      if (!agent) return false;
    }

    // Claim highest priority borrower
    const borrower = await Allocator.reserveNextBorrower();
    if (!borrower) {
      if (agent) await Allocator.releaseAgent(agent.id, AgentState.AVAILABLE);
      return false;
    }

    const agentId = agent ? agent.id : null;

    // Insert call in INITIATED state in MySQL
    await query(
      `INSERT INTO calls (id, borrower_id, agent_id, worker_id, provider_id, state, mode, initiated_at, version)
       VALUES (?, ?, ?, ?, ?, 'INITIATED', ?, NOW(), 1);`,
      [callId, borrower.id, agentId, workerId, provider.providerId, mode]
    );

    if (agent) {
      await Allocator.transitionAgent(agent.id, AgentState.DIALING, workerId);
    }

    this.broadcast({
      type: 'CALL_DISPATCHED',
      callId,
      borrowerId: borrower.id,
      agentId,
      mode,
      providerId: provider.providerId
    });

    try {
      const providerCallId = await provider.initiateCall(
        callId,
        borrower.phone,
        (evt) => this.handleProviderWebhook(evt)
      );

      await query('UPDATE calls SET provider_call_id = ? WHERE id = ?;', [providerCallId, callId]);
      return true;
    } catch (e) {
      console.error(`[Engine] Initiation failure for ${callId}:`, e.message);
      await query(
        `UPDATE calls SET state = 'FAILED', ended_at = NOW(), error_reason = ? WHERE id = ?;`,
        [`INITIATION_ERROR: ${e.message}`, callId]
      );
      if (agent) await Allocator.releaseAgent(agent.id, AgentState.AVAILABLE);
      await Allocator.resetBorrower(borrower.id, false);
      return false;
    }
  }

  /**
   * Webhook Listener: Deduplicates with events_log and validates state machine.
   */
  async handleProviderWebhook(event) {
    const eventId = event.eventId || `gen_${uuidv4().substring(0, 8)}`;
    const { callId, eventType } = event;

    // 1. IDEMPOTENCY: Insert into events_log with UNIQUE key constraint
    try {
      await query(
        `INSERT INTO events_log (event_id, call_id, event_type, raw_payload)
         VALUES (?, ?, ?, ?);`,
        [eventId, callId, eventType, JSON.stringify(event)]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        console.warn(`[Webhook] Duplicate event ${eventId} ignored (MySQL UNIQUE constraint).`);
        return { status: 'IGNORED', reason: 'DUPLICATE_EVENT_ID' };
      }
      throw err;
    }

    // 2. Fetch call from MySQL
    const call = await queryOne('SELECT * FROM calls WHERE id = ?;', [callId]);
    if (!call) {
      return { status: 'ERROR', reason: 'UNKNOWN_CALL_ID' };
    }

    // 3. State Machine check (Out-of-order, duplicates, terminal states)
    const { newState, applied, note } = CallStateMachine.transitionWithEvent(
      call.state,
      eventType,
      eventId
    );

    if (!applied) {
      return { status: 'IGNORED', reason: note };
    }

    // 4. Apply transition
    await this.applyCallTransition(call, newState, event);

    return { status: 'SUCCESS', newState, note };
  }

  async applyCallTransition(call, nextState, event) {
    const { id: callId, borrower_id: borrowerId, mode } = call;
    let agentId = call.agent_id;

    await withTransaction(async (conn) => {
      if (nextState === CallState.RINGING) {
        await conn.query('UPDATE calls SET state = "RINGING", version = version + 1 WHERE id = ?;', [callId]);
      } else if (nextState === CallState.ANSWERED) {
        // In Predictive Mode: call may need an agent allocated now!
        if (!agentId && mode === DialingMode.PREDICTIVE) {
          // Find next available agent
          const [agentRows] = await conn.query(
            `SELECT id, name FROM agents WHERE state = 'AVAILABLE' ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED;`
          );

          if (agentRows.length > 0) {
            agentId = agentRows[0].id;
            await conn.query(
              `UPDATE calls 
               SET state = 'CONNECTED', agent_id = ?, answered_at = NOW(), connected_at = NOW(), version = version + 1
               WHERE id = ?;`,
              [agentId, callId]
            );
            await Allocator.transitionAgent(agentId, AgentState.CONNECTED, null, conn);
            this.totalConnectedCalls++;
          } else {
            // COMPLIANCE ABANDONMENT
            this.abandonedCallsCount++;
            console.error(`[Compliance Violation] Predictive call ${callId} answered but NO agent available!`);
            await conn.query(
              `UPDATE calls 
               SET state = 'FAILED', answered_at = NOW(), ended_at = NOW(), error_reason = 'COMPLIANCE_ABANDONED_NO_AGENT_AVAILABLE', version = version + 1
               WHERE id = ?;`,
              [callId]
            );
            const provider = this.getProvider(call.provider_id);
            provider.hangup(callId);
            return;
          }
        } else {
          await conn.query(
            `UPDATE calls 
             SET state = 'CONNECTED', answered_at = NOW(), connected_at = NOW(), version = version + 1
             WHERE id = ?;`,
            [callId]
          );
          if (agentId) {
            await Allocator.transitionAgent(agentId, AgentState.CONNECTED, null, conn);
          }
          this.totalConnectedCalls++;
        }
      } else if (nextState === CallState.COMPLETED) {
        const talkTime = event.talkTimeSec || 12.0;
        await conn.query(
          `UPDATE calls 
           SET state = 'COMPLETED', ended_at = NOW(), talk_time_sec = ?, version = version + 1
           WHERE id = ?;`,
          [talkTime, callId]
        );
        if (agentId) {
          await conn.query(
            `UPDATE agents 
             SET total_calls = total_calls + 1, total_talk_time_sec = total_talk_time_sec + ?
             WHERE id = ?;`,
            [talkTime, agentId]
          );
          await Allocator.transitionAgent(agentId, AgentState.WRAP_UP, null, conn);

          // Wrap-up delay then back to AVAILABLE
          setTimeout(async () => {
            await Allocator.releaseAgent(agentId, AgentState.AVAILABLE);
            this.broadcast({ type: 'AGENT_STATE_CHANGED', agentId, state: 'AVAILABLE' });
          }, 600);
        }
      } else if ([CallState.FAILED, CallState.CANCELLED].includes(nextState)) {
        const reason = event.errorReason || 'CALL_FAILED';
        await conn.query(
          `UPDATE calls SET state = ?, ended_at = NOW(), error_reason = ?, version = version + 1 WHERE id = ?;`,
          [nextState, reason, callId]
        );
        if (agentId) {
          await Allocator.releaseAgent(agentId, AgentState.AVAILABLE, conn);
        }
        await Allocator.resetBorrower(borrowerId, nextState === CallState.FAILED && reason !== 'NO_ANSWER', conn);
      }
    });

    this.broadcast({
      type: 'CALL_STATE_CHANGED',
      callId,
      newState: nextState,
      agentId
    });
  }

  async queryQueueStats() {
    const [agentRow] = await query(`
      SELECT 
        SUM(CASE WHEN state = 'AVAILABLE' THEN 1 ELSE 0 END) as available,
        SUM(CASE WHEN state = 'CONNECTED' THEN 1 ELSE 0 END) as connected,
        SUM(CASE WHEN state = 'RESERVED' THEN 1 ELSE 0 END) as reserved,
        SUM(CASE WHEN state = 'DIALING' THEN 1 ELSE 0 END) as dialing,
        SUM(CASE WHEN state = 'WRAP_UP' THEN 1 ELSE 0 END) as wrapUp,
        SUM(CASE WHEN state = 'PAUSED' THEN 1 ELSE 0 END) as paused,
        SUM(CASE WHEN state = 'OFFLINE' THEN 1 ELSE 0 END) as offline,
        COUNT(*) as total
      FROM agents;
    `);

    const [callRow] = await query(`
      SELECT
        SUM(CASE WHEN state = 'RINGING' THEN 1 ELSE 0 END) as ringing,
        SUM(CASE WHEN state = 'INITIATED' THEN 1 ELSE 0 END) as initiated,
        SUM(CASE WHEN state = 'CONNECTED' THEN 1 ELSE 0 END) as connectedCalls,
        SUM(CASE WHEN state = 'COMPLETED' THEN 1 ELSE 0 END) as completedCalls,
        SUM(CASE WHEN state = 'FAILED' THEN 1 ELSE 0 END) as failedCalls,
        COUNT(*) as totalCalls
      FROM calls;
    `);

    const [safetyRow] = await query('SELECT COUNT(*) as safetyCnt FROM safety_decisions;');

    return {
      availableAgents: Number(agentRow.available || 0),
      connectedAgents: Number(agentRow.connected || 0),
      reservedAgents: Number(agentRow.reserved || 0),
      dialingAgents: Number(agentRow.dialing || 0),
      wrapUpAgents: Number(agentRow.wrapUp || 0),
      pausedAgents: Number(agentRow.paused || 0),
      offlineAgents: Number(agentRow.offline || 0),
      totalAgents: Number(agentRow.total || 0),
      ringingCalls: Number(callRow.ringing || 0) + Number(callRow.initiated || 0),
      connectedCalls: Number(callRow.connectedCalls || 0),
      completedCalls: Number(callRow.completedCalls || 0),
      failedCalls: Number(callRow.failedCalls || 0),
      totalCalls: Number(callRow.totalCalls || 0),
      safetyCount: Number(safetyRow.safetyCnt || 0)
    };
  }

  async getSystemStatus() {
    const stats = await this.queryQueueStats();
    const mode = await this.getMode();
    const activeProvider = await this.getActiveProviderId();
    const provider = this.getProvider(activeProvider);

    const totalAgents = Math.max(1, stats.totalAgents);
    const busyAgents = stats.connectedAgents + stats.dialingAgents + stats.wrapUpAgents;
    const agentUtilization = Number(((busyAgents / totalAgents) * 100).toFixed(1));

    const totalAnswered = this.totalConnectedCalls + this.abandonedCallsCount;
    const abandonmentRate = totalAnswered > 0 ? Number(((this.abandonedCallsCount / totalAnswered) * 100).toFixed(2)) : 0.0;

    const lastDecision = await queryOne('SELECT * FROM safety_decisions ORDER BY id DESC LIMIT 1;');
    const runningRow = await queryOne("SELECT `value` FROM campaign_config WHERE `key` = 'is_running';");
    const isCampaignRunning = runningRow ? runningRow.value === '1' : this.isRunning;

    return {
      mode,
      activeProvider,
      isRunning: isCampaignRunning,
      totalAgents: stats.totalAgents,
      availableAgents: stats.availableAgents,
      reservedAgents: stats.reservedAgents,
      dialingAgents: stats.dialingAgents,
      connectedAgents: stats.connectedAgents,
      wrapUpAgents: stats.wrapUpAgents,
      pausedAgents: stats.pausedAgents,
      offlineAgents: stats.offlineAgents,
      activeCalls: stats.connectedCalls + stats.ringingCalls,
      ringingCalls: stats.ringingCalls,
      connectedCalls: stats.connectedCalls,
      completedCalls: stats.completedCalls,
      failedCalls: stats.failedCalls,
      abandonedCalls: this.abandonedCallsCount,
      agentUtilizationPct: agentUtilization,
      abandonmentRatePct: abandonmentRate,
      safetyInterventionsCount: stats.safetyCount,
      providerHealth: provider.getHealth(),
      lastSafetyDecision: lastDecision
    };
  }

  subscribe(ws) {
    this.subscribers.add(ws);
  }

  unsubscribe(ws) {
    this.subscribers.delete(ws);
  }

  broadcast(data) {
    const msg = JSON.stringify(data);
    for (const ws of this.subscribers) {
      if (ws.readyState === 1) {
        ws.send(msg);
      }
    }
  }
}
