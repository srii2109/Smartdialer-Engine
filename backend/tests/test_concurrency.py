"""Concurrency and Race Condition Tests.

Validates that when multiple workers race to claim the same agent,
SQL atomic operations guarantee that exactly ONE worker succeeds,
with zero duplicate reservations or corruptions.
"""

import concurrent.futures
import pytest
from app.database import init_db, get_db
from app.allocator import Allocator
from app.models import AgentState


@pytest.fixture(autouse=True)
def setup_test_db():
    init_db(force_reset=True)
    with get_db() as conn:
        # Create a single test agent
        conn.execute(
            "INSERT INTO agents (id, name, state, version) VALUES ('agent_race_01', 'Race Agent', 'AVAILABLE', 1);"
        )
        # Create pool of 10 agents
        for i in range(10):
            conn.execute(
                f"INSERT INTO agents (id, name, state, version) VALUES ('pool_agent_{i}', 'Agent {i}', 'AVAILABLE', 1);"
            )


def test_two_workers_race_for_same_agent():
    """Two workers try to reserve the exact same agent at the exact same instant."""
    results = []

    def attempt_reservation(worker_id: str):
        res = Allocator.reserve_specific_agent("agent_race_01", worker_id=worker_id)
        return (worker_id, res)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(attempt_reservation, "worker_A")
        f2 = executor.submit(attempt_reservation, "worker_B")
        results = [f1.result(), f2.result()]

    successes = [r for r in results if r[1] is not None]
    failures = [r for r in results if r[1] is None]

    # Exactly ONE worker must have reserved the agent
    assert len(successes) == 1, f"Expected 1 success, got {len(successes)}"
    assert len(failures) == 1, f"Expected 1 failure, got {len(failures)}"

    winner_worker, reserved_agent = successes[0]
    assert reserved_agent["state"] == "RESERVED"
    assert reserved_agent["worker_id"] == winner_worker


def test_twenty_workers_race_for_single_agent():
    """High concurrency stress: 20 threads simultaneously race to claim agent_race_01."""
    num_threads = 20

    def claim_agent(worker_id: str):
        return Allocator.reserve_specific_agent("agent_race_01", worker_id=f"worker_{worker_id}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=num_threads) as executor:
        futures = [executor.submit(claim_agent, i) for i in range(num_threads)]
        results = [f.result() for f in futures]

    success_count = sum(1 for r in results if r is not None)
    failure_count = sum(1 for r in results if r is None)

    assert success_count == 1, f"Atomic isolation breached! {success_count} workers claimed the same agent."
    assert failure_count == num_threads - 1


def test_concurrent_pool_allocation_no_duplicates():
    """10 workers simultaneously request the 'next available agent' from a pool of 10.
    
    Verifies all 10 are claimed by distinct workers with ZERO collisions.
    """
    num_workers = 10

    def claim_next(worker_idx: int):
        return Allocator.reserve_next_available_agent(worker_id=f"worker_{worker_idx}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=num_workers) as executor:
        futures = [executor.submit(claim_next, i) for i in range(num_workers)]
        claimed_agents = [f.result() for f in futures]

    # All 10 allocations should succeed
    valid_claims = [a for a in claimed_agents if a is not None]
    assert len(valid_claims) == 10

    # Ensure every single claimed agent ID is unique (no two workers got the same agent)
    claimed_ids = [a["id"] for a in valid_claims]
    assert len(set(claimed_ids)) == 10, f"Duplicate agent allocated! IDs: {claimed_ids}"
