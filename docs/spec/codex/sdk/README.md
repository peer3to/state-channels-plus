# SDK implementation specification

## Status and authority

This directory specifies the client implementation boundary. It translates protocol rules into component ownership, ordered algorithms, persistence requirements, and failure recovery. Current code is under `src/`; differences are explicit in focused chapters.

## 1. Purpose

The SDK runs one peer of one or more state channels. It connects transports, authenticated RPC, deterministic EVM execution, block and dispute validation, chain event sync, proof construction, storage, timers, and application hooks without letting concurrency create a different protocol result.

## 2. Design decisions and rationale

### 2.1 One state manager owns channel mutation

Network, event, timer, and user inputs all converge on `StateManager`. Expensive preparation may run in parallel, but state-changing decisions for one channel are serialized and revalidated before commit.

### 2.2 Strategy changes policy, not core validation truth

Normal, calldata, dispute, and spectating paths need different consequences for the same validation result. They may decide whether to sign, queue, store, create proof, or abort. They must not define contradictory cryptographic or state-transition predicates.

### 2.3 Local EVM reuses contract predicates

Where on-chain and off-chain behavior must match, the SDK calls the locally deployed manager and facets. TypeScript still controls orchestration, storage, and transport. This reduces duplicated proof logic but makes local contract version and event mirror correctness critical.

### 2.4 Every detached operation is owned and cancelable

Gossip, proof submission, queue retry, timeout, reduction, snapshot update, and worker calls may outlive the input that started them. Each needs channel, fork, operation generation, cancellation, and observed error handling.

### 2.5 Durable state is part of correctness

Blocks, signatures, state snapshots, encoded application state, stream blocks, event cursor, proof evidence, and non-equivocation records must survive restart. In-memory maps are suitable for tests, not production protocol guarantees.

## 3. Boundary, responsibilities, and component map

The SDK owns off-chain orchestration, networking, local replay, evidence construction, durable records, event mirroring, timers, and chain transaction submission. Contracts remain authoritative for adopted state and enforcement predicates. The application owns transaction semantics and balance algebra. A provider supplies untrusted observations that the SDK must reconcile with canonical chain identity.

| Component | Owns |
| --- | --- |
| `P2PManager` and transports | connection lifecycle, sends, request correlation, disconnect |
| RPC services | authenticated method boundary, handshake, block delivery, spectate, join, dispute acknowledgment |
| `StateManager` | channel status, canonical local fork and head, serialized mutation, transition orchestration |
| `BlockQueueManager` | future and waiting block intake, fixed lifetime, recovery requests, dequeue order |
| `ValidationService` | shared structural, ancestry, time, author, replay, and chain evidence checks |
| validation strategies | path-specific response to typed validation result |
| `AgreementManager` | signatures, threshold context, milestones, state proof, reduction source lookup |
| `DisputeManager` and validator | dispute construction, audit data, peer validation, kill candidates |
| reduction services | event-set synchronization, local computation, simulation, submission, race classification |
| snapshot update service | same-fork and successor-fork calldata preparation and submission |
| event sync and handler | canonical logs, local EVM mirror, higher-level callbacks |
| EVM runtime and executors | deterministic contract and state-machine calls, worker isolation |
| storage modules | typed durable records, indexes, atomic transactions, pruning |
| `Clock` and timeout manager | chain-time estimate and cancelable scheduling |

## 4. Document map

| Chapter | Contents |
| --- | --- |
| [Runtime and networking](runtime-and-networking.md) | startup, ownership, transports, RPC, workers, shutdown |
| [Block confirmation pipeline](block-confirmation-pipeline.md) | all intake paths, queue, validation, replay, signatures, finality, escalation |
| [Dispute sync and reduction](dispute-sync-and-reduction.md) | dispute construction, validation, proofs, events, reduction, snapshot update |
| [Storage and crash recovery](storage-and-crash-recovery.md) | schema, transactions, cursors, retention, restart, migration |
| [Chain events and local EVM](chain-events-and-local-evm.md) | log ingestion, mirror handlers, gaps, reorganization, reconciliation |
| [Spectating and joining](spectating-and-joining.md) | fail-closed sync, state proof verification, admission signature, deposit, force inclusion |

## 5. SDK lifecycle

### 5.1 States

| State | Allowed work |
| --- | --- |
| created | configuration validation only |
| initializing | provider, clock, storage, runtime, ABI, and event cursor setup |
| synchronizing | canonical event catch-up and local state reconstruction; no authoring |
| spectating | restricted sync and verification; no channel signatures or deposit |
| active | normal authoring, validation, confirmation, recovery scheduling |
| disputed | validate and exchange evidence; stop normal old-fork authoring |
| transitioning | adopt successor, cancel old work, rebuild local head |
| degraded | read and recovery only because clock, provider, storage, worker, or resource state is unsafe |
| disposing | reject new work and drain owned operations |
| disposed | no callbacks, timers, requests, workers, or writes |

### 5.2 Startup algorithm

1. Validate complete configuration and supported protocol version.
2. Open durable storage and run version migration before network work.
3. Bind provider to expected chain and manager bytecode/version.
4. initialize chain clock with uncertainty gating;
5. start local contract and state-machine runtime;
6. restore durable channel records, queues, timers, and pending operations;
7. replay canonical manager events from durable cursor and reconcile views;
8. choose active, disputed, spectating, or degraded status from authoritative state;
9. start RPC and transport listeners;
10. connect expected mesh and resume cancelable scheduled work;
11. permit authoring only after all prior steps and application state hash check succeed.

### 5.3 Shutdown algorithm

1. Move to disposing and reject new user and network mutations.
2. cancel timers, queue tasks, RPC waiters, provider listeners, and operation generations;
3. stop new worker requests and await or abort active calls;
4. flush durable state, event cursor, and logs;
5. close transports and workers;
6. mark disposed and make later callbacks no-ops with diagnostics.

## 6. Concurrency contract

One channel mutation mutex protects canonical head, fork, snapshots, state, queues, dispute status, and scheduling decisions. No code awaits a peer response or long chain transaction while holding it. The pattern is:

1. lock and capture immutable input version;
2. unlock and perform parallel fetch, signature, or simulation work;
3. lock again;
4. revalidate channel, fork, head, event coordinate, and operation generation;
5. atomically commit or discard stale output.

Worker state is not authority until main-thread storage commit succeeds.

## 7. SDK-wide invariants

- **SDK-INV-1:** one channel has one serialized canonical mutation order.
- **SDK-INV-2:** no signature leaves the node before its signed bytes and context are durable.
- **SDK-INV-3:** detached work cannot mutate after its operation generation is canceled.
- **SDK-INV-4:** canonical chain event cursor and applied state commit atomically.
- **SDK-INV-5:** a local EVM predicate uses the same protocol version as the target manager.
- **SDK-INV-6:** restart cannot make the node sign a conflicting block or dispute.
- **SDK-INV-7:** spectating state grants no active participant permissions.
- **SDK-INV-8:** transport arrival order cannot select canonical block or successor.
- **SDK-INV-9:** every bounded queue, cache, worker, and frame has defined overload behavior.
- **SDK-INV-10:** disposal leaves no live ownerless async work.

## 8. Current implementation

The current SDK has clear components, mutex utilities, worker runtimes, typed storage modules, strategy classes, transport alternatives, and extensive E2E tests. Production durability remains missing because storage modules use in-memory maps. Clock and event reorganization recovery are incomplete. Gossip rate limits are incomplete. Several long asynchronous paths use detached work and need a full ownership audit.

## 9. Difference from the intended design

Current stores are volatile, event replay is not reorg-safe or fully ordered, one emitted settlement event is not mirrored, state-proof construction drops the intended suffix, and no complete gossip work budget exists. The focused SDK chapters classify each difference and its required test.

## 10. Verification

Each focused chapter defines tests. The SDK release gate also needs lifecycle tests for restart at every state, dispose during every active operation, worker crash, provider switch, chain reorganization, storage migration, overload, and multiple independent channels.

## 11. Future work

Non-normative work includes alternate transports, verified-RPC or light-client operation, larger topologies, remote watchtower hosting, and specialized persistent adapters. These must preserve the SDK-wide invariants if adopted.
