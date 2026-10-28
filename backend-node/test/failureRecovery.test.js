import test from 'node:test';
import assert from 'node:assert/strict';
import { query, queryOne } from '../src/db.js';
import { Reconciler } from '../src/reconciler.js';
import { SmartDialerEngine } from '../src/dialerEngine.js';

test('Failure Case 1: Worker crash recovery', async () => {
  const reconciler = new Reconciler(1); // 1 second stale threshold

  // Setup test agent, borrower, and stuck call
  await query("DELETE FROM calls WHERE id = 'test_call_crash_1';");
  await query("DELETE FROM agents WHERE id = 'test_agent_crash_1';");
  await query("DELETE FROM borrowers WHERE id = 'test_bor_crash_1';");

  await query("INSERT INTO agents (id, name, state, worker_id, reserved_at) VALUES ('test_agent_crash_1', 'Crash Agent', 'RESERVED', 'crashed_worker_1', DATE_SUB(NOW(), INTERVAL 5 SECOND));");
  await query("INSERT INTO borrowers (id, name, phone, priority, state) VALUES ('test_bor_crash_1', 'Crash Bor', '+15551234', 1, 'RESERVED');");
  await query(`
    INSERT INTO calls (id, borrower_id, agent_id, worker_id, provider_id, state, mode, created_at, initiated_at)
    VALUES ('test_call_crash_1', 'test_bor_crash_1', 'test_agent_crash_1', 'crashed_worker_1', 'PROVIDER_A', 'INITIATED', 'PROGRESSIVE', DATE_SUB(NOW(), INTERVAL 5 SECOND), DATE_SUB(NOW(), INTERVAL 5 SECOND));
  `);

  // Run reconciler sweeper
  const result = await reconciler.reconcileAll();
  assert.ok(result.crashedWorkerCallsRecovered >= 1);

  // Verify agent freed
  const ag = await queryOne("SELECT * FROM agents WHERE id = 'test_agent_crash_1';");
  assert.equal(ag.state, 'AVAILABLE');
  assert.equal(ag.worker_id, null);

  // Verify borrower reset for retry
  const bor = await queryOne("SELECT * FROM borrowers WHERE id = 'test_bor_crash_1';");
  assert.equal(bor.state, 'UNPROCESSED');

  // Verify call marked failed with recovery reason
  const call = await queryOne("SELECT * FROM calls WHERE id = 'test_call_crash_1';");
  assert.equal(call.state, 'FAILED');
  assert.match(call.error_reason, /WORKER_CRASH/);
});

test('Failure Case 4: Duplicate webhook events deduplication', async () => {
  const engine = new SmartDialerEngine();

  // Create active call and clear any previous event
  await query("DELETE FROM events_log WHERE event_id = 'dup_test_event_999';");
  await query("DELETE FROM calls WHERE id = 'test_call_dup_1';");
  await query("DELETE FROM agents WHERE id = 'test_agent_dup_1';");
  await query("DELETE FROM borrowers WHERE id = 'test_bor_dup_1';");

  await query("INSERT INTO agents (id, name, state) VALUES ('test_agent_dup_1', 'Dup Agent', 'DIALING');");
  await query("INSERT INTO borrowers (id, name, phone, priority, state) VALUES ('test_bor_dup_1', 'Dup Bor', '+15558888', 1, 'RESERVED');");
  await query("INSERT INTO calls (id, borrower_id, agent_id, provider_id, state, mode) VALUES ('test_call_dup_1', 'test_bor_dup_1', 'test_agent_dup_1', 'PROVIDER_B', 'RINGING', 'PROGRESSIVE');");

  // Send 1st webhook
  const r1 = await engine.handleProviderWebhook({
    eventId: 'dup_test_event_999',
    callId: 'test_call_dup_1',
    eventType: 'ANSWERED',
    providerId: 'PROVIDER_B'
  });
  assert.equal(r1.status, 'SUCCESS');

  // Send identical 2nd webhook
  const r2 = await engine.handleProviderWebhook({
    eventId: 'dup_test_event_999',
    callId: 'test_call_dup_1',
    eventType: 'ANSWERED',
    providerId: 'PROVIDER_B'
  });
  assert.equal(r2.status, 'IGNORED');
  assert.equal(r2.reason, 'DUPLICATE_EVENT_ID');
});
