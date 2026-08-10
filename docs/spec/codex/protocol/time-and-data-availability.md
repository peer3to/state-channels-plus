# Chain time, author windows, and data availability

## Status and authority

This chapter defines time-dependent protocol rules. The base chain is authoritative. Local clock checks are scheduling and early-rejection tools, not final proof.

## 1. Purpose

Deterministic authoring needs a deadline after which peers may recover from a missing author. Data availability needs enough time for peer delivery, agreement, and chain publication. These rules must avoid slashing honest peers near boundaries while keeping recovery finite.

## 2. Design decisions and rationale

### 2.1 Chain time is the protocol clock

Contracts use the canonical block timestamp of the transaction that evaluates a deadline. Peers estimate that clock to schedule work. Local wall time cannot create an objective timeout or fraud proof.

### 2.2 The latest authoritative parent time may change

An off-chain parent has its signed timestamp. If that parent is later posted on chain, its inclusion timestamp may grant the next author extra time, unless the next author already signed the parent and therefore showed it had the data. This prevents a peer from being timed out for data it could not receive before fallback publication.

### 2.3 First block gets recovery grace

The first block of a fork may begin only after genesis time is objectively available. V1 adds `evidenceTime` grace to transaction zero. Later blocks use the normal author window.

### 2.4 Delivery windows have different meanings

- `p2pTime` bounds a valid author timestamp relative to the relevant predecessor time.
- `agreementTime` allows direct propagation, confirmation, and local observation.
- `chainFallbackTime` allows publication and observation through the base chain.
- `evidenceTime` controls dispute phases and also provides first-block grace in current V1.

Using one duration for unrelated purposes is simple but couples tuning. Production may separate them only through a protocol version.

## 3. Boundary and responsibilities

The contract decides objective timestamp, calldata, timeout, and dispute phase predicates. SDK clock tracks chain time, schedules author and recovery work, and delays action when its estimate is uncertain. Transport and RPC provide direct data. The chain event path provides final V1 fallback.

## 4. Data model and derived times

Let:

- `TparentSigned` be the predecessor block timestamp, or fork genesis timestamp;
- `TparentChain` be predecessor calldata inclusion time when a matching commitment exists;
- `A` be the next author;
- `signedParent(A)` state whether A signed the predecessor;
- `G(h)` be `evidenceTime` for height zero and zero otherwise.

The relevant predecessor time is:

```text
Trelevant = TparentSigned
if parent has matching chain calldata and A did not sign parent:
    Trelevant = max(TparentSigned, TparentChain)
```

The authored block timestamp must satisfy:

```text
TparentSigned <= Tblock <= Trelevant + G(height) + p2pTime
```

The latest valid chain publication time for that block is:

```text
TpostMax = Trelevant + G(height) + p2pTime + agreementTime + chainFallbackTime
```

The earliest normal timeout dispute time is `TpostMax`. A timeout window opened earlier cannot later be reused to assert that timeout.

These formulas describe intended V1. Every SDK and Solidity check must use the same overflow-safe arithmetic and equality behavior.

## 5. Inputs and preconditions

### 5.1 Peer clock initialization

A peer needs a reachable chain provider, latest canonical block, a recent block sample, monotonic local timer, configured deliberate lag, and maximum allowed uncertainty. Startup fails closed for authoring and time-based proof submission if it cannot establish these.

### 5.2 Block timestamp assessment

The peer needs the signed parent or genesis snapshot, matching parent calldata record if any, the next-author relation, and optional next-author signature on the parent. A local “late arrival” is subjective until the objective parent context is complete.

### 5.3 Calldata publication

The author needs exact signed block bytes and a `maxTimestamp` no later than the objective publication deadline. A peer must leave enough transaction inclusion margin; submitting at its local estimate of the deadline is unsafe.

## 6. Processing algorithm

### 6.1 Synchronize local protocol clock

1. Fetch latest canonical block and a bounded recent sample.
2. Validate nondecreasing block numbers and chain-specific timestamp rules.
3. Estimate local offset from latest chain timestamp and local wall time.
4. Estimate block interval and observation uncertainty from the sample.
5. Apply a deliberate conservative lag so local protocol time does not run ahead of likely chain time.
6. If absolute offset or uncertainty exceeds configured maximum skew, disable authoring, timeout, and slash submissions until resynchronized.
7. Store sample block number and hash.
8. Periodically resync and immediately resync after provider change, long sleep, large offset jump, or reorganization.

The exact maximum skew, lag, resync period, and sample estimator remain unresolved and require empirical values. They must be deployment config, metrics, and tests, not hidden constants.

### 6.2 Author timestamp selection

1. Compute relevant predecessor time.
2. Set candidate to conservative protocol clock plus a small execution allowance.
3. raise candidate to at least the signed predecessor timestamp;
4. cap candidate at relevant predecessor plus first-block grace plus `p2pTime`;
5. if lower bound exceeds upper bound, do not author and resynchronize context;
6. sign the resulting timestamp as part of block bytes.

### 6.3 Receiver assessment

1. Verify objective lower and upper timestamp bounds.
2. If invalid and authoritative parent context is incomplete, attempt parent calldata recovery before creating a proof.
3. Recompute with a matching parent chain timestamp.
4. If still objectively invalid, build invalid-timestamp proof.
5. If objectively valid but far from local estimated chain time, hold it for up to the fixed agreement deadline instead of calling it fraud.
6. Do not let duplicate delivery reset the first-seen agreement deadline.

### 6.4 Direct availability and agreement

The author gossips immediately. Receivers request missing blocks or confirmations from all known participants. The fixed local waiting lifetime begins at first authenticated sighting. Requeues and duplicates retain the original first-seen time.

### 6.5 Chain fallback

1. When direct delivery or agreement is insufficient and the author still can publish, submit exact signed block with conservative `maxTimestamp`.
2. Wait for canonical `BlockCalldataPosted` event.
3. Verify event commitment from block bytes and inclusion timestamp.
4. Feed the block through ordinary authentication, ordering, and replay.
5. Store inclusion timestamp as objective parent context for the next author.

Chain publication proves availability, not validity.

### 6.6 Timeout construction

1. Determine missing height and deterministic participant expected to author it.
2. Confirm no accepted block exists at that position.
3. Compute relevant predecessor time and timeout minimum.
4. If the predecessor may have chain calldata, query and wait for canonical event sync.
5. At local estimated time near the deadline, query latest chain time directly.
6. Do not submit until authoritative chain time is at or beyond minimum with safety margin.
7. Record whether prior author calldata was present and any timed-out participant signature on the predecessor.
8. Ensure an existing window did not open before the timeout became valid.
9. Build and submit dispute. The contract repeats every race check.

## 7. Outputs and postconditions

Clock sync produces an offset, uncertainty, sample coordinate, and enabled/disabled status. Valid authoring produces a bounded signed timestamp. Calldata fallback produces a chain event and objective inclusion time. Timeout construction produces a dispute claim, not an immediate removal.

## 8. Invariants

- **TIME-INV-1:** contract chain time decides every objective deadline.
- **TIME-INV-2:** block timestamps never move backward from signed predecessor time.
- **TIME-INV-3:** parent chain publication grants extra time only when the next author had not already signed the parent.
- **TIME-INV-4:** duplicate data cannot extend an agreement or queue deadline.
- **TIME-INV-5:** calldata commitment binds exact bytes and exact inclusion timestamp.
- **TIME-INV-6:** chain publication does not bypass block validation.
- **TIME-INV-7:** a timeout window cannot predate the timeout it asserts.
- **TIME-INV-8:** uncertain local clock disables punitive action before it risks false accusation.
- **TIME-INV-9:** deadline equality has one documented side: phase expiry checks use `now >= deadline`.

## 9. Ordering, concurrency, and atomicity

Peer requests, gossip, and chain queries may run in parallel. Only one accepted block or timeout action advances a channel position. A block calldata event racing a timeout transaction is resolved by chain order and contract race checks.

A local timer firing does not mean a deadline passed. It schedules a fresh chain-time and state check. Timers must be cancelable when the block, calldata, dispute, successor, or reorganization changes context.

## 10. Trust and security assumptions

Chain timestamp behavior follows the target network’s consensus bounds. Providers are untrusted for freshness and can delay blocks. One provider can cause premature local scheduling, but the contract prevents objective early action if its checks are complete.

V1 chain-backed data availability adds no separate committee trust, but an adversary can force fees, large calldata, and recovery delay. The author must have funds and chain access. This is an explicit liveness and cost assumption.

## 11. Failure behavior and recovery

Provider failure pauses time-sensitive action and retries through another configured provider. Clock sample inconsistency disables action and resyncs. Late peer data may still validate through on-chain timing. A calldata transaction that misses `maxTimestamp` reverts and may leave timeout as the only recovery path.

Chain reorganization removes orphaned calldata timestamps and window creation times. Peers must roll back derived relevant times, proofs, and timers before replaying the replacement branch.

## 12. Current implementation

`Clock.ts` adjusts local wall time toward the latest block and calculates average interval from up to ten blocks. It recursively resyncs while offset exceeds one average interval. It has no explicit conservative lag, maximum skew, periodic resync, uncertainty state, or reorganization binding.

`ValidationService` calls the local contract timestamp predicate, recovers parent calldata when needed, checks publication deadline, and uses `agreementTime` as a subjective local-arrival window. `StateManager` computes timeout wait as P2P plus agreement plus chain fallback plus first-block grace. `BlockQueueManager` preserves `firstSeenAt` across restore and duplicate delivery.

## 13. Difference from the intended design

| Classification     | Difference                                                                     |
| ------------------ | ------------------------------------------------------------------------------ |
| missing            | accepted maximum clock skew and conservative lag values                        |
| missing            | periodic and event-driven clock resynchronization                              |
| missing            | clock uncertainty state that gates punitive operations                         |
| missing            | sample block-hash binding and reorganization rollback                          |
| documentation debt | `agreementTime` is used for both delivery observation and other agreement work |
| decision pending   | separate first-block grace from dispute evidence duration                      |
| missing            | multi-provider freshness policy                                                |
| missing            | empirical tests and metrics for target-network timestamp behavior              |

## 14. Dependencies and cross-layer effects

Block validation, queue expiry, author scheduling, calldata fallback, timeout disputes, evidence, reduction, event sync, and operations all use this model. Contract formulas live across `FraudProofFacet`, `DisputeFraudProofFacet`, and `DisputeManagerFacet`; they need shared tested helpers.

## 15. Verification

Tests must cover honest positive and negative wall-clock skew, deliberate provider delay, zero and variable block interval, chain timestamp jumps, sleep and resume, provider switch, first block, signed-parent time, later parent calldata, forfeited extra time, exact deadline equality, duplicate queue delivery, calldata-timeout race in both chain orders, transaction inclusion delay, and reorganization.

Property tests must compare SDK and Solidity deadline calculations over overflow edges and random configurations.

## 16. Future work

An alternative availability layer may reduce calldata cost. It must quantify committee, censorship, retention, privacy, and fee assumptions and keep an enforceable escape path.
