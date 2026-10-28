# SmartDialer Architecture Decision Document

## 1. Executive Summary & Stack Choices
For this SmartDialer prototype, we selected:
* **Database**: **MySQL 8.0 (InnoDB Engine)** with ACID transactions, atomic updates, and `FOR UPDATE SKIP LOCKED`.
* **Backend Application**: **Node.js (v24) + Express.js** with asynchronous non-blocking event-driven execution and native connection pooling (`mysql2/promise`).
* **Frontend**: **React 19 (Vite + Tailwind CSS)** with real-time bidirectional WebSocket telemetry.

---

## 2. Architectural Analysis: The Four Core Questions

### Q1: What did you choose?
A **Node.js + Express.js + MySQL 8.0 (InnoDB)** modular architecture paired with an interactive **React** operations dashboard.

### Q2: Why did you choose it?
1. **Telecom is I/O-Bound**: In outbound dialing, >95% of thread time is spent waiting on carrier responses, network round-trips, ringing cadence, and borrower answers. Node.js's single-threaded event loop processes thousands of concurrent in-flight telecom events without thread overhead or stack memory bloat.
2. **Deterministic Concurrency in MySQL**: MySQL 8.0 InnoDB provides ACID row-level locking and native `FOR UPDATE SKIP LOCKED`. It enables multiple independent workers to claim available agents and borrowers concurrently with **strictly zero race conditions and zero lock contention delays**.
3. **Unified Language Ecosystem**: JavaScript across Express backend and React frontend eliminates serialization friction, sharing domain types, states, and validation logic.

### Q3: What problem does it solve?
* **Eliminates Double Allocation**: Prevents two concurrent workers from reserving the same agent at the same millisecond.
* **Guarantees Call Safety via Mandatory Boundary**: The predictive pacing engine is strictly separated from telecom dispatch by an autonomous **Safety Controller** that cannot be bypassed.
* **Tolerates Chaos Webhooks**: Handles out-of-order events (e.g. `COMPLETED` before `ANSWERED`) and duplicate events (`ANSWERED, ANSWERED, ANSWERED`) through monotonic precedence and MySQL unique constraint deduplication.
* **Automatic Failure Recovery**: Periodic reconciler sweeps crashed worker reservations and restores orphaned borrowers and agents to healthy states.

### Q4: What does it make harder?
* **Write Concentration on MySQL**: Concentrating high-frequency state updates on a single MySQL table (`agents` and `calls`) creates write I/O contention at very high scales (e.g., 50,000+ agents). Sharding/partitioning by tenant/campaign becomes necessary at scale.
* **Event Loop Discipline**: CPU-intensive algorithms (e.g., deep simulation or complex mathematical optimizations) must not block Node's main thread; worker threads or separate micro-processes must handle heavy computations.

---

## 3. Deep-Dive Answers to Interview Questions

### Q: Two workers try to reserve the same agent at exactly the same time. Walk us through what happens.
1. Worker 1 and Worker 2 both issue:
   ```sql
   UPDATE agents
   SET state = 'RESERVED', worker_id = :worker_id, reserved_at = NOW(), version = version + 1
   WHERE id = :agent_id AND state = 'AVAILABLE';
   ```
2. MySQL InnoDB places an exclusive row-level lock on the row matching `:agent_id`.
3. Worker 1's transaction evaluates first: the agent state is `'AVAILABLE'`, so MySQL updates the row to `'RESERVED'` and increments `version`. MySQL returns `affectedRows = 1`. Worker 1 proceeds with call setup.
4. Worker 2's transaction executes immediately after: the `WHERE state = 'AVAILABLE'` condition is now FALSE because Worker 1 changed it to `'RESERVED'`.
5. MySQL returns `affectedRows = 0` to Worker 2. Worker 2 recognizes that the agent was already claimed, aborts without error, and requests the next agent.
6. Alternatively, when workers request the next free agent, they execute:
   ```sql
   SELECT id FROM agents WHERE state = 'AVAILABLE' LIMIT 1 FOR UPDATE SKIP LOCKED;
   ```
   MySQL gives Agent A to Worker 1 and automatically skips to Agent B for Worker 2 simultaneously. **Result: Zero double bookings, zero waiting.**

---

### Q: Your database says the agent is AVAILABLE, but your cache says RESERVED. Which one wins?
**The Database ALWAYS wins.**
* **Architectural Decision**: In our design, we **intentionally avoided putting a caching layer in front of mutable agent states**.
* Caching volatile transaction states (like agent availability that changes every 50ms) creates dual-state drift. If a worker crashes mid-write, the cache and DB diverge, causing ghost agents or compliance breaches.
* MySQL InnoDB's in-memory buffer pool already caches hot table pages in RAM with sub-millisecond read latency, while preserving transactional atomicity. If a cache were present, the database is the authoritative Single Source of Truth; the cache must be invalidated.

---

### Q: The provider sends ANSWERED, your worker crashes, and then COMPLETED arrives. What happens?
1. **Worker Crash After ANSWERED**:
   * The call is recorded in MySQL in `ANSWERED` (or `CONNECTED`) state with `agent_id` attached.
   * Because the worker process died, it stops sending heartbeats.
2. **COMPLETED Arrives**:
   * The telecom provider webhook arrives at Express.
   * `CallStateMachine.transitionWithEvent('ANSWERED', 'COMPLETED')` determines this is a valid forward transition.
   * MySQL updates the call to `COMPLETED` and marks the attached agent as `WRAP_UP`.
   * After a brief wrap-up cooldown, the agent is freed back to `AVAILABLE`.
3. **If COMPLETED never arrives (network drop)**:
   * The background **Reconciler Sweeper** detects that the call has been in `ANSWERED`/`CONNECTED` without worker activity past the timeout ceiling.
   * It cleans up the orphaned call, logs `WORKER_CRASH_OR_TIMEOUT_RECOVERED`, and releases the agent safely back to `AVAILABLE`.

---

### Q: Your model predicted a 70% answer rate. It suddenly drops to 10%. How does the system protect itself?
1. The **Safety Controller** monitors historical vs real-time answer rates.
2. When answer rate drops to 10%, the binomial abandonment risk formula:
   $$\mathbb{P}(\text{Answers} > \text{Available Agents})$$
   spikes exponentially if aggressive pacing continues.
3. The Safety Controller detects the risk spike and triggers `PROGRESSIVE_FALLBACK`:
   * It immediately ignores the predictive model's request.
   * It clamps approved calls to the strict progressive ceiling: $\max(0, \text{Available Agents} - \text{Ringing Calls})$.
   * If available agents reach zero, approved calls immediately drop to 0 (`REJECTED`).
   * The predictive algorithm has no code path to override or disable this clamp.

---

### Q: We just went from 1,000 to 100,000 agents. What breaks first and how would you fix it?
**What breaks first:**
1. **Row lock contention on the `agents` and `borrowers` tables**:
   With 100,000 agents and thousands of concurrent calls per second, all workers hitting a single MySQL table causes InnoDB lock queue saturation, buffer pool flushing bottlenecks, and write latency degradation.
2. **WebSocket broadcast fan-out**:
   Broadcasting state changes of 100,000 agents to web clients over a single Node server saturates event loop memory and network bandwidth.

**How to fix it (Without unnecessary complexity):**
1. **Campaign / Pod Partitioning (Horizontal Sharding)**:
   * Real contact centers do not run 100,000 agents on a single dialer queue. Agents are divided into campaigns, teams, or skills (e.g. 500–1,000 agents per campaign).
   * Shard the database by `campaign_id` or deploy isolated dialer pods per campaign. Each pod manages its own MySQL partition, eliminating cross-campaign table contention.
2. **Batch Queue Allocation**:
   * Instead of workers competing for 1 agent at a time, a master scheduler pre-allocates batches of 20–50 available agents to worker threads using `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 50`.
3. **Delta WebSocket Aggregation**:
   * Instead of streaming individual agent state events, aggregate metrics over 500ms intervals and push only summary deltas to frontends.

---

## 4. The Final Question
> *"How would you build a SmartDialer that gets as much of the utilization benefit of predictive dialing as possible, while retaining the deterministic safety characteristics of progressive dialing?"*

### Solution: Reservation-Backed Predictive Pacing (Virtual Agent Reservoirs with Just-In-Time Ring-time Matching)

1. **The Core Dilemma**:
   * **Progressive**: 100% safe, 0% abandonment, but agents sit idle during 20–30s ringing setup.
   * **Predictive**: High utilization, but stochastic answers risk zero free agents $\rightarrow$ illegal call abandonment.

2. **The Hybrid Solution**:
   * **Phase 1: Deterministic Reservoir Sizing**:
     Instead of placing unanchored speculative calls into the telecom network, we calculate a **Deterministic Release Schedule** based on ongoing call talk-time CDF (Cumulative Distribution Function).
     If an agent has been on a call for 110s and average call duration is 90s ($\pm 15$s), their probability of concluding within the next 20 seconds is $>95\%$.
   * **Phase 2: JIT (Just-In-Time) Synthetic Reservation**:
     We place outbound predictive calls *only* when backed by an agent in their final wrap-up/concluding window ($T_{\text{remaining}} \le T_{\text{ring}}$).
   * **Phase 3: The Bailout Bridge (Zero Abandonment Invariant)**:
     If a borrower answers before the anticipated agent hangs up, the dialer holds a tiny **Buffer Reservoir** (e.g. 5% of agents marked in specialized warm reserve) or routes the borrower to an automated interactive AI compliance greeting:
     *"Connecting you with your account specialist in 3 seconds..."*
     This bridges the gap, completely eliminating abandoned calls while keeping agent utilization at $>88\%$.
