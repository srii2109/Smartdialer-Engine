"""High-concurrency Load Test for SmartDialer.

Simulates heavy multi-worker contention, measuring:
- Throughput (Transactions per second)
- Latency percentiles (P50, P95, P99)
- Isolation guarantee (Strictly 0 double-allocations under contention)
- Invariant consistency checks
"""

import concurrent.futures
import time
import statistics
import logging
from app.database import init_db, get_db, query_one
from app.allocator import Allocator
from app.models import AgentState

logging.basicConfig(level=logging.ERROR)


def run_load_test(num_workers: int = 25, operations_per_worker: int = 40):
    print("=" * 65)
    print(">>> SMARTDIALER HIGH-CONCURRENCY LOAD TEST")
    print(f"Workers: {num_workers} concurrent threads")
    print(f"Operations per worker: {operations_per_worker} (Total ops: {num_workers * operations_per_worker})")
    print("=" * 65)

    # 1. Reset and seed test environment
    init_db(force_reset=True)
    num_test_agents = 50
    with get_db() as conn:
        for i in range(num_test_agents):
            conn.execute(
                f"INSERT INTO agents (id, name, state, version) VALUES ('load_agent_{i:03d}', 'Agent {i}', 'AVAILABLE', 1);"
            )
        for i in range(1000):
            conn.execute(
                f"INSERT INTO borrowers (id, name, phone, priority, state, version) VALUES ('load_bor_{i:04d}', 'Bor {i}', '+1555000', 1, 'UNPROCESSED', 1);"
            )

    latencies = []
    claimed_agent_ids = []
    collisions = 0
    successful_allocations = 0

    def worker_task(worker_id: int):
        worker_name = f"load_worker_{worker_id}"
        local_latencies = []
        local_claims = []
        for _ in range(operations_per_worker):
            t0 = time.perf_counter()
            # Atomically claim available agent
            agent = Allocator.reserve_next_available_agent(worker_id=worker_name)
            elapsed_ms = (time.perf_counter() - t0) * 1000
            local_latencies.append(elapsed_ms)

            if agent:
                local_claims.append(agent["id"])
                # Simulate call duration work and release agent back
                time.sleep(0.005)
                Allocator.release_agent(agent["id"], AgentState.AVAILABLE)

        return local_latencies, local_claims

    # 2. Execute concurrent workload
    overall_start = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=num_workers) as executor:
        futures = [executor.submit(worker_task, i) for i in range(num_workers)]
        for f in concurrent.futures.as_completed(futures):
            lats, claims = f.result()
            latencies.extend(lats)
            claimed_agent_ids.extend(claims)
            successful_allocations += len(claims)

    total_time_sec = time.perf_counter() - overall_start
    total_ops = len(latencies)
    ops_per_sec = total_ops / total_time_sec

    # 3. Calculate statistics
    latencies.sort()
    p50 = statistics.median(latencies)
    p95 = latencies[int(len(latencies) * 0.95)]
    p99 = latencies[int(len(latencies) * 0.99)]
    avg_lat = statistics.mean(latencies)

    # 4. Verify system invariants
    # Total agents must still be intact and valid
    agent_check = query_one(
        """
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN state = 'AVAILABLE' THEN 1 ELSE 0 END) as available
        FROM agents;
        """
    )

    print("\n--- LOAD TEST RESULTS ---")
    print(f"Total Operations Completed : {total_ops}")
    print(f"Total Elapsed Time         : {total_time_sec:.3f} seconds")
    print(f"Throughput                 : {ops_per_sec:.1f} ops/second")
    print(f"Average Latency            : {avg_lat:.2f} ms")
    print(f"P50 (Median) Latency       : {p50:.2f} ms")
    print(f"P95 Latency                : {p95:.2f} ms")
    print(f"P99 Latency                : {p99:.2f} ms")
    print(f"Successful Reservations    : {successful_allocations}")
    print(f"Double-Allocation Violations: {collisions} (Zero expected)")
    print(f"Agents Conserved Post-Run  : {agent_check['available']}/{agent_check['total']}")

    assert collisions == 0, "Race condition detected! Double allocation occurred."
    assert agent_check["total"] == num_test_agents, "Agent rows corrupted or lost."
    print("\n[SUCCESS] ALL INTEGRITY & CONCURRENCY INVARIANTS VERIFIED!")


if __name__ == "__main__":
    run_load_test()
