import test from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from '../src/db.js';
import { Allocator } from '../src/allocator.js';

test('MySQL Atomic Concurrency: Two workers race for the exact same agent', async () => {
  // Setup single test agent
  await query("DELETE FROM agents WHERE id = 'test_agent_race_1';");
  await query(
    "INSERT INTO agents (id, name, state, version) VALUES ('test_agent_race_1', 'Race Agent 1', 'AVAILABLE', 1);"
  );

  // Both workers attempt to reserve the same agent simultaneously
  const [resA, resB] = await Promise.all([
    Allocator.reserveSpecificAgent('test_agent_race_1', 'worker_A'),
    Allocator.reserveSpecificAgent('test_agent_race_1', 'worker_B')
  ]);

  const successes = [resA, resB].filter((r) => r !== null);
  const failures = [resA, resB].filter((r) => r === null);

  assert.equal(successes.length, 1, 'Exactly one worker must succeed in reserving the agent.');
  assert.equal(failures.length, 1, 'The other worker must fail cleanly with 0 rows affected.');
  assert.equal(successes[0].state, 'RESERVED');
});

test('MySQL Atomic Concurrency: 20 simultaneous workers race for a single agent', async () => {
  await query("DELETE FROM agents WHERE id = 'test_agent_race_20';");
  await query(
    "INSERT INTO agents (id, name, state, version) VALUES ('test_agent_race_20', 'Race Agent 20', 'AVAILABLE', 1);"
  );

  const numWorkers = 20;
  const promises = [];
  for (let i = 0; i < numWorkers; i++) {
    promises.push(Allocator.reserveSpecificAgent('test_agent_race_20', `worker_${i}`));
  }

  const results = await Promise.all(promises);
  const successes = results.filter((r) => r !== null);
  const failures = results.filter((r) => r === null);

  assert.equal(successes.length, 1, 'Atomic isolation check: Exactly 1 worker succeeded.');
  assert.equal(failures.length, numWorkers - 1, 'All other 19 workers were rejected.');
});
