import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, seedData, resetDatabase } from './db.js';
import { SmartDialerEngine } from './dialerEngine.js';
import { Reconciler } from './reconciler.js';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/api/ws' });

app.use(cors());
app.use(express.json());

export const engine = new SmartDialerEngine();
export const reconciler = new Reconciler();

// REST Endpoints
app.get('/api/status', async (req, res) => {
  try {
    const status = await engine.getSystemStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agents', async (req, res) => {
  try {
    const agents = await query('SELECT * FROM agents ORDER BY id ASC LIMIT 100;');
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/calls', async (req, res) => {
  try {
    const calls = await query(`
      SELECT c.*, b.name as borrower_name, b.phone as borrower_phone
      FROM calls c
      JOIN borrowers b ON c.borrower_id = b.id
      ORDER BY c.created_at DESC
      LIMIT 50;
    `);
    res.json(calls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/safety/log', async (req, res) => {
  try {
    const logs = await query('SELECT * FROM safety_decisions ORDER BY id DESC LIMIT 50;');
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/dialer/start', async (req, res) => {
  await query("UPDATE campaign_config SET `value` = '1' WHERE `key` = 'is_running';");
  await engine.start(3);
  res.json({ status: 'started' });
});

app.post('/api/dialer/resume', async (req, res) => {
  await query("UPDATE campaign_config SET `value` = '1' WHERE `key` = 'is_running';");
  await engine.start(3);
  res.json({ status: 'resumed' });
});

app.post('/api/dialer/pause', async (req, res) => {
  await query("UPDATE campaign_config SET `value` = '0' WHERE `key` = 'is_running';");
  res.json({ status: 'paused' });
});

app.post('/api/dialer/reset', async (req, res) => {
  engine.stop();
  await resetDatabase();
  await engine.start(3);
  res.json({ status: 'reset_complete' });
});

app.post('/api/config/mode', async (req, res) => {
  const { mode } = req.body;
  await engine.setMode(mode);
  res.json({ status: 'mode_updated', mode });
});

app.post('/api/config/provider', async (req, res) => {
  const { provider_id } = req.body;
  await engine.setActiveProvider(provider_id);
  res.json({ status: 'provider_updated', provider: provider_id });
});

app.post('/api/agents/drop', async (req, res) => {
  const count = req.body.count || 20;
  // Sudden dropout of agents (simulating lunch / disconnect)
  const rows = await query('SELECT id FROM agents WHERE state = "AVAILABLE" LIMIT ?;', [count]);
  if (rows.length > 0) {
    const ids = rows.map((r) => `'${r.id}'`).join(',');
    await query(`UPDATE agents SET state = 'OFFLINE', worker_id = NULL, version = version + 1 WHERE id IN (${ids});`);
  }
  res.json({ status: 'agents_dropped', count: rows.length });
});

app.post('/api/agents/restore', async (req, res) => {
  const [result] = await query('UPDATE agents SET state = "AVAILABLE", worker_id = NULL, version = version + 1 WHERE state IN ("OFFLINE", "PAUSED");');
  res.json({ status: 'agents_restored', count: result.affectedRows });
});

app.post('/api/scenarios/run', (req, res) => {
  const { scenario } = req.body;
  const provA = engine.providers.PROVIDER_A;
  const provB = engine.providers.PROVIDER_B;

  if (scenario === 'A') {
    // Scenario A: 20% Answer, 120s Talk
    provA.setAnswerRate(0.20);
    provA.setTalkTime(12.0);
    provB.setAnswerRate(0.20);
    provB.setTalkTime(12.0);
    return res.json({ status: 'configured', scenario: 'A', answer_rate: '20%', avg_talk_time: '120s' });
  } else if (scenario === 'B') {
    // Scenario B: 50% Answer, 90s Talk
    provA.setAnswerRate(0.50);
    provA.setTalkTime(9.0);
    provB.setAnswerRate(0.50);
    provB.setTalkTime(9.0);
    return res.json({ status: 'configured', scenario: 'B', answer_rate: '50%', avg_talk_time: '90s' });
  } else if (scenario === 'C') {
    // Scenario C: 70% Answer, 180s Talk
    provA.setAnswerRate(0.70);
    provA.setTalkTime(18.0);
    provB.setAnswerRate(0.70);
    provB.setTalkTime(18.0);
    return res.json({ status: 'configured', scenario: 'C', answer_rate: '70%', avg_talk_time: '180s' });
  } else if (scenario === 'D') {
    // Scenario D: Dynamic / Chaos with Provider B
    provB.setAnswerRate(0.35);
    provB.setTalkTime(10.0);
    engine.setActiveProvider('PROVIDER_B');
    return res.json({ status: 'configured', scenario: 'D', note: 'Dynamic conditions with Provider B active' });
  }
  res.status(400).json({ error: 'Invalid scenario' });
});

app.post('/api/failures/inject', async (req, res) => {
  const { failure_type } = req.body;

  if (failure_type === 'worker_crash') {
    // Failure Case 1: Agent reserved > Borrower reserved > Call initiated > Worker crashes
    const fakeWorkerId = 'crashed_worker_99';
    const callId = `crash_test_${uuidv4().substring(0, 6)}`;

    const agentRow = await queryOne('SELECT id FROM agents WHERE state = "AVAILABLE" LIMIT 1;');
    const agentId = agentRow ? agentRow.id : null;
    if (agentId) {
      await query('UPDATE agents SET state = "RESERVED", worker_id = ? WHERE id = ?;', [fakeWorkerId, agentId]);
    }

    const borRow = await queryOne('SELECT id FROM borrowers WHERE state = "UNPROCESSED" LIMIT 1;');
    const borId = borRow ? borRow.id : 'bor_0001';
    await query('UPDATE borrowers SET state = "RESERVED" WHERE id = ?;', [borId]);

    // Backdate call by 25 seconds
    await query(
      `INSERT INTO calls (id, borrower_id, agent_id, worker_id, provider_id, state, mode, created_at, initiated_at, version)
       VALUES (?, ?, ?, ?, 'PROVIDER_A', 'INITIATED', 'PROGRESSIVE', DATE_SUB(NOW(), INTERVAL 25 SECOND), DATE_SUB(NOW(), INTERVAL 25 SECOND), 1);`,
      [callId, borId, agentId, fakeWorkerId]
    );

    // Run reconciler sweeper immediately
    const recovered = await reconciler.reconcileAll();
    return res.json({
      status: 'worker_crash_simulated_and_recovered',
      call_id: callId,
      reconciler_result: recovered
    });
  } else if (failure_type === 'provider_outage') {
    const provider = engine.getProvider();
    const currentHealth = provider.getHealth();
    const newOutageState = !currentHealth.outageActive;
    provider.setOutage(newOutageState);
    return res.json({
      status: 'outage_toggled',
      provider_id: provider.providerId,
      outage_active: newOutageState
    });
  } else if (failure_type === 'duplicate_event') {
    const callRow = await queryOne('SELECT id FROM calls ORDER BY id DESC LIMIT 1;');
    if (!callRow) return res.status(400).json({ error: 'No active calls found' });

    const callId = callRow.id;
    const dupEventId = `dup_${uuidv4().substring(0, 8)}`;

    const r1 = await engine.handleProviderWebhook({
      eventId: dupEventId,
      callId,
      providerId: 'PROVIDER_B',
      eventType: 'ANSWERED'
    });
    const r2 = await engine.handleProviderWebhook({
      eventId: dupEventId,
      callId,
      providerId: 'PROVIDER_B',
      eventType: 'ANSWERED'
    });
    return res.json({
      status: 'duplicate_events_injected',
      first_response: r1,
      second_response: r2
    });
  } else if (failure_type === 'out_of_order') {
    const callRow = await queryOne('SELECT id FROM calls WHERE state IN ("INITIATED", "RINGING") ORDER BY id DESC LIMIT 1;');
    if (!callRow) return res.status(400).json({ error: 'No ringing/initiated call found' });

    const callId = callRow.id;
    // COMPLETED first
    const r1 = await engine.handleProviderWebhook({
      eventId: `evt_${uuidv4().substring(0, 8)}`,
      callId,
      providerId: 'PROVIDER_B',
      eventType: 'COMPLETED',
      talkTimeSec: 10.0
    });
    // Late ANSWERED after COMPLETED
    const r2 = await engine.handleProviderWebhook({
      eventId: `evt_${uuidv4().substring(0, 8)}`,
      callId,
      providerId: 'PROVIDER_B',
      eventType: 'ANSWERED'
    });
    return res.json({
      status: 'out_of_order_events_injected',
      completed_response: r1,
      late_answered_response: r2
    });
  }

  res.status(400).json({ error: 'Unknown failure type' });
});

// WebSocket Server
wss.on('connection', (ws) => {
  engine.subscribe(ws);

  const sendSnapshot = async () => {
    try {
      const status = await engine.getSystemStatus();
      const recentCalls = await query(`
        SELECT c.id, c.borrower_id, c.agent_id, c.state, c.mode, c.created_at, c.talk_time_sec, c.error_reason,
               b.name as borrower_name
        FROM calls c
        JOIN borrowers b ON c.borrower_id = b.id
        ORDER BY c.created_at DESC
        LIMIT 15;
      `);
      const recentAgents = await query('SELECT id, name, state, total_calls, total_talk_time_sec FROM agents ORDER BY id ASC LIMIT 50;');

      ws.send(JSON.stringify({
        type: 'SNAPSHOT',
        status,
        calls: recentCalls,
        agents: recentAgents
      }));
    } catch (e) {
      // ignore
    }
  };

  const timer = setInterval(sendSnapshot, 1000);
  sendSnapshot();

  ws.on('close', () => {
    clearInterval(timer);
    engine.unsubscribe(ws);
  });
});

// Startup sequence
const PORT = process.env.PORT || 8000;
server.listen(PORT, async () => {
  console.log(`=======================================================`);
  console.log(`🚀 SmartDialer Node.js Backend listening on port ${PORT}`);
  console.log(`💾 Database: MySQL (localhost:3306/smartdialer)`);
  console.log(`=======================================================`);

  await seedData(50, 300);
  reconciler.start(2500);
  await engine.start(3);
});
