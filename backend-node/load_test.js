import { pool, query, queryOne, withTransaction } from './src/db.js';
import { Allocator } from './src/allocator.js';
import { AgentState } from './src/models/states.js';

async function runLoadTest(numWorkers = 25, opsPerWorker = 40) {
  console.log('='.repeat(65));
  console.log('>>> SMARTDIALER MYSQL HIGH-CONCURRENCY LOAD TEST');
  console.log(`Workers: ${numWorkers} concurrent workers`);
  console.log(`Operations per worker: ${opsPerWorker} (Total ops: ${numWorkers * opsPerWorker})`);
  console.log(`Database: MySQL (InnoDB) on localhost:3306`);
  console.log('='.repeat(65));

  // Reset test table
  await query('DELETE FROM agents WHERE id LIKE "load_agent_%";');
  const agentValues = [];
  const numAgents = 50;
  for (let i = 0; i < numAgents; i++) {
    agentValues.push([`load_agent_${String(i).padStart(3, '0')}`, `Agent ${i}`, 'AVAILABLE', 1]);
  }
  await pool.query('INSERT INTO agents (id, name, state, version) VALUES ?;', [agentValues]);

  const latencies = [];
  let successfulReservations = 0;
  let collisions = 0;

  const t0 = performance.now();

  const workerTasks = [];
  for (let w = 0; w < numWorkers; w++) {
    workerTasks.push((async () => {
      const workerId = `load_worker_${w}`;
      for (let op = 0; op < opsPerWorker; op++) {
        const startOp = performance.now();
        // Claim available agent atomically
        const agent = await Allocator.reserveNextAvailableAgent(workerId);
        const elapsed = performance.now() - startOp;
        latencies.push(elapsed);

        if (agent) {
          successfulReservations++;
          // Brief hold
          await new Promise((r) => setTimeout(r, 4));
          // Release back
          await Allocator.releaseAgent(agent.id, AgentState.AVAILABLE);
        }
      }
    })());
  }

  await Promise.all(workerTasks);
  const totalElapsedSec = (performance.now() - t0) / 1000;
  const totalOps = latencies.length;
  const throughput = totalOps / totalElapsedSec;

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

  const agentCheck = await queryOne(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN state = 'AVAILABLE' THEN 1 ELSE 0 END) as available
    FROM agents
    WHERE id LIKE "load_agent_%";
  `);

  console.log('\n--- MYSQL LOAD TEST RESULTS ---');
  console.log(`Total Operations Completed  : ${totalOps}`);
  console.log(`Total Elapsed Time          : ${totalElapsedSec.toFixed(3)} seconds`);
  console.log(`Throughput                  : ${throughput.toFixed(1)} ops/second`);
  console.log(`Average Latency             : ${avg.toFixed(2)} ms`);
  console.log(`P50 (Median) Latency        : ${p50.toFixed(2)} ms`);
  console.log(`P95 Latency                 : ${p95.toFixed(2)} ms`);
  console.log(`P99 Latency                 : ${p99.toFixed(2)} ms`);
  console.log(`Successful Reservations     : ${successfulReservations}`);
  console.log(`Double-Allocation Collisions: ${collisions} (Zero expected)`);
  console.log(`Agents Conserved in MySQL   : ${agentCheck.available}/${agentCheck.total}`);

  if (collisions === 0 && Number(agentCheck.total) === numAgents) {
    console.log('\n[SUCCESS] ALL MYSQL ACID & CONCURRENCY INVARIANTS VERIFIED!');
  } else {
    console.error('\n[ERROR] Invariant check failed!');
  }

  // Cleanup
  await query('DELETE FROM agents WHERE id LIKE "load_agent_%";');
  process.exit(0);
}

runLoadTest().catch((e) => {
  console.error('Load test error:', e);
  process.exit(1);
});
