import test from 'node:test';
import assert from 'node:assert/strict';
import { DialingMode, SafetyDecisionType } from '../src/models/states.js';
import { PacingEngine } from '../src/pacingEngine.js';
import { SafetyController } from '../src/safetyController.js';
import { query } from '../src/db.js';

test('Pacing Engine: Progressive 1:1 calculation', () => {
  const res = PacingEngine.calculateCalls({
    mode: DialingMode.PROGRESSIVE,
    availableAgents: 50,
    connectedAgents: 0,
    ringingCalls: 0
  });
  assert.equal(res.recommendedCalls, 50);

  const res2 = PacingEngine.calculateCalls({
    mode: DialingMode.PROGRESSIVE,
    availableAgents: 50,
    connectedAgents: 0,
    ringingCalls: 20
  });
  assert.equal(res2.recommendedCalls, 30);
});

test('Pacing Engine: Predictive capacity calculation', () => {
  const res = PacingEngine.calculateCalls({
    mode: DialingMode.PREDICTIVE,
    availableAgents: 10,
    connectedAgents: 20,
    ringingCalls: 5,
    historicalAnswerRate: 0.20,
    avgTalkTimeSec: 120.0
  });
  assert.ok(res.recommendedCalls > 20);
  assert.match(res.rationale, /Predictive Model/);
});

test('Safety Controller: Zero capacity rejection', async () => {
  const safety = new SafetyController();
  const res = await safety.evaluate({
    mode: DialingMode.PROGRESSIVE,
    requestedCalls: 10,
    availableAgents: 0,
    connectedAgents: 0,
    ringingCalls: 0,
    providerHealth: { isHealthy: true, healthPct: 100 }
  });
  assert.equal(res.decision, SafetyDecisionType.REJECTED);
  assert.equal(res.approvedCalls, 0);
});

test('Safety Controller: Provider outage throttling', async () => {
  const safety = new SafetyController();
  const res = await safety.evaluate({
    mode: DialingMode.PREDICTIVE,
    requestedCalls: 15,
    availableAgents: 10,
    connectedAgents: 5,
    ringingCalls: 2,
    providerHealth: { isHealthy: false, healthPct: 20 }
  });
  assert.equal(res.decision, SafetyDecisionType.REJECTED);
  assert.equal(res.approvedCalls, 0);
  assert.match(res.reason, /Provider health degraded/);
});

test('Safety Controller: Sudden agent dropout circuit breaker', async () => {
  const safety = new SafetyController();
  const healthy = { isHealthy: true, healthPct: 100 };

  // Feed prior availability of 100 agents
  for (let i = 0; i < 4; i++) {
    await safety.evaluate({
      mode: DialingMode.PREDICTIVE,
      requestedCalls: 5,
      availableAgents: 100,
      connectedAgents: 20,
      ringingCalls: 5,
      providerHealth: healthy
    });
  }

  // Sudden drop from 100 to 50 agents!
  const res = await safety.evaluate({
    mode: DialingMode.PREDICTIVE,
    requestedCalls: 30,
    availableAgents: 50,
    connectedAgents: 20,
    ringingCalls: 10,
    providerHealth: healthy
  });

  assert.equal(res.decision, SafetyDecisionType.PROGRESSIVE_FALLBACK);
  assert.equal(res.approvedCalls, 40); // 50 - 10 = 40 safe ceiling
  assert.match(res.reason, /Sudden agent availability drop/);
});

test('Safety Controller: Audit log written to MySQL table', async () => {
  const safety = new SafetyController();
  await safety.evaluate({
    mode: DialingMode.PROGRESSIVE,
    requestedCalls: 5,
    availableAgents: 10,
    connectedAgents: 0,
    ringingCalls: 0,
    providerHealth: { isHealthy: true, healthPct: 100 }
  });

  const rows = await query('SELECT * FROM safety_decisions ORDER BY id DESC LIMIT 1;');
  assert.ok(rows.length > 0);
  assert.equal(rows[0].decision, 'APPROVED');
  assert.equal(rows[0].approved_calls, 5);
});
