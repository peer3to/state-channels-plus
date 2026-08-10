# Contract interfaces, events, errors, and local mirroring

## Status and authority

This chapter defines the manager’s compatibility and recovery surface. Function selectors, ABI struct layouts, event signatures, indexed fields, and error selectors are versioned protocol data.

## 1. Purpose

SDK peers need two contract views: synchronous calls for authoritative checks and an ordered event log for continuous local reconstruction. Typed errors tell callers whether to rebuild stale input, reject bad evidence, retry an external failure, or report a protocol bug.

## 2. Design decisions and rationale

### 2.1 Events are recovery data, not only notifications

Peers run isolated local EVMs and apply canonical manager events to mirror contract state. An event must therefore carry enough information to reproduce the authoritative mutation or identify the exact state that must be fetched.

### 2.2 Event coordinates define replay order

The canonical coordinate is `(chainId, managerAddress, blockNumber, transactionIndex, logIndex, blockHash)`. Contract code receives only part of this, but the SDK journal must retain all of it. A local handler uses the event’s chain order, not arrival order.

### 2.3 Errors are grouped by caller action

Race errors mean the caller’s previously valid expectation became stale and input should be rebuilt. Validation errors mean supplied evidence or state is invalid. Authorization errors mean the caller is not permitted. Execution errors mean an application or asset effect failed. This grouping is more useful than naming every revert “invalid.”

### 2.4 Audit helpers do not become mutation shortcuts

Public verification functions may expose proof and reduction predicates to SDK preflight. If they run by `delegatecall`, they must not leave state-machine or manager storage changed. An audit helper returning true is not authorization to skip checks in the state-changing endpoint.

## 3. Boundary and responsibilities

The interface declares stable external operations. Facets implement them. Events provide append-only observations. SDK event sync handles confirmation depth, duplicates, gaps, and reorganizations. `LocalDiamond` applies accepted events to peer-local EVM storage; it is not a trust source.

## 4. Data model and owned state

### 4.1 External operation groups

| Group                 | Operations                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------- |
| channel and admission | `open`, `isChannelOpen`, `getParticipants`, `joinChannel`, `topUpBalance`                 |
| time and availability | timing getters, `postBlockCalldata`, calldata commitment getter                           |
| proof audit           | state proof, signed-block, milestone, fraud, balance, stream, and snapshot helpers        |
| dispute               | upload with or without data, proof application, reduce, finalize, challenge, window views |
| snapshot              | same-fork and successor-fork update                                                       |
| application adapter   | state transition, deposit, withdrawal, inbound and outbound processing                    |
| batching              | `multicall` for operations whose combined atomic semantics are documented                 |

Internal composition endpoints such as direct asset deposit, withdrawal, or state-machine mutation must be callable only through the manager’s checked flow. A public ABI declaration does not mean arbitrary external callers may use it.

### 4.2 Event catalog

| Event                              | Authoritative meaning                   | Minimum mirror effect                                                           |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| `ChannelOpened`                    | channel genesis adopted                 | store snapshot and encoded genesis state; initialize balance and stream context |
| `InboundMessagesProcessed`         | immutable inbound block appended        | persist block; advance current inbound head, height, deposits                   |
| `BlockCalldataPosted`              | author filled one availability slot     | store commitment and enqueue signed block for validation                        |
| `DisputeCommitted`                 | dispute hash entered a window           | reconstruct exact dispute, window timestamps, author, and fast-path flag        |
| `DisputeCommittedWithAuditingData` | same plus public audit data             | persist and validate audit payload against dispute hash                         |
| `ChainSlashed`                     | participant entered objective slash set | append unique timestamped slash and remove from local eligibility               |
| `DisputeKilled`                    | one dispute commitment removed          | remove exact hash without reordering other commitments                          |
| `DisputeReducedResultCommitted`    | successor proposal committed            | store successor, reduction time, reducer                                        |
| `StateSnapshotUpdated`             | authoritative snapshot adopted          | store exact snapshot and reconcile state/stream material                        |
| `OutboundMessagesProcessed`        | one outbound block effect completed     | journal processed block and total                                               |
| `WithdrawalsUpdated`               | cumulative withdrawal total changed     | store exact application balance                                                 |
| `ChannelStorageCleared`            | named old data became prunable          | prune only data covered by the event’s cleanup contract                         |

### 4.3 Local event cursor

Each event family and channel needs a last accepted coordinate. A single coordinate per family is safe only when every event in that family is totally ordered and no independent fork key can progress out of order. Reduced results need channel plus disputed fork. Duplicate acceptance compares the full coordinate, not only block number.

## 5. Inputs and preconditions

An SDK event is accepted only when:

- emitter equals configured manager address;
- chain ID equals configured chain;
- event signature matches the versioned ABI;
- log belongs to the canonical chain at required confirmation depth;
- coordinate is exactly the next journal position or a known duplicate;
- decoded channel and payload hashes pass event-specific consistency checks.

Direct calls require target bytecode and protocol version match SDK config. Preflight `eth_call` must use the intended sender and a block tag close enough to submission, while still treating the result as non-authoritative until inclusion.

## 6. Processing algorithm

### 6.1 Canonical event ingestion

1. Fetch logs in bounded block ranges from the last durable cursor.
2. Sort by block number, transaction index, and log index.
3. Verify block hash against the canonical provider view.
4. Start a storage transaction for one log.
5. Decode with the ABI version active at that block.
6. Apply the event-specific mirror mutation idempotently.
7. Store inverse data or a before-image sufficient for reorganization rollback.
8. advance the durable cursor and commit;
9. only then notify higher-level managers.

### 6.2 Gap and duplicate handling

A coordinate at or below an already applied identical log is ignored. Same coordinate with different block hash begins reorganization recovery. A forward gap stops live application, fetches the missing range, and resumes only after continuity is restored.

### 6.3 Reorganization handling

1. Find the latest journaled block still canonical.
2. Roll back later event effects in reverse coordinate order.
3. reset cursors and scheduled deadlines derived from orphaned logs;
4. fetch and apply the replacement branch;
5. revalidate pending local actions such as proof, reduction, and snapshot transactions.

### 6.4 Error handling

| Error class                         | Caller action                                                               |
| ----------------------------------- | --------------------------------------------------------------------------- |
| race or expectation mismatch        | refresh views and rebuild; do not blindly retry identical calldata          |
| malformed or invalid proof/state    | reject input and record validation failure                                  |
| authorization or eligibility        | stop this sender path; reconcile membership and slash state                 |
| phase expired                       | move to the next recovery phase                                             |
| application execution or withdrawal | keep finalized evidence, alert, and retry only after external cause changes |
| unknown selector or ABI decode      | treat as deployment/version mismatch                                        |
| out of gas or resource bound        | protocol/operations failure; do not classify as false evidence              |

## 7. Outputs and postconditions

After canonical replay, the local mirror’s manager-visible getters must equal production contract getters for the same block. The durable event cursor advances only with the corresponding state mutation. Higher-level callbacks never observe a cursor without its state or state without its cursor.

## 8. Invariants

- **ABI-INV-1:** a struct layout used by signatures or hashes does not change within a protocol version.
- **ABI-INV-2:** a canonical log is applied at most once.
- **ABI-INV-3:** local event application preserves canonical log order.
- **ABI-INV-4:** cursor and mirror mutation commit atomically.
- **ABI-INV-5:** reorganization rollback removes every derived effect of orphaned logs.
- **ABI-INV-6:** event handlers validate emitter, chain, and payload context.
- **ABI-INV-7:** local helper functions cannot mutate production manager state.
- **ABI-INV-8:** typed failure class does not depend on parsing revert text.

## 9. Ordering, concurrency, and atomicity

Only one event applier may advance a given chain-manager cursor at a time. Other subsystem work starts after durable application. Contract transaction atomicity can emit several logs; the SDK applies them in log order but must roll back the complete transaction group if persistence fails halfway.

`multicall` preserves call order and atomic revert semantics. It must not be used to bypass phase revalidation between logically separate actions, and reentrant self-calls must preserve the original responsible sender where policy depends on it.

## 10. Trust and security assumptions

RPC providers can omit, delay, reorder, or lie about logs. Confirmation depth plus block-hash reconciliation reduces this risk; high-value recovery may need more than one provider. Event payloads are untrusted until commitment and context checks pass.

A local mirror can drift because of handler bugs. Periodic view reconciliation is required for snapshots, balances, slash sets, window results, and calldata slots used in active recovery.

## 11. Failure behavior and recovery

Decode or application failure stops the cursor before the bad log and records a fatal sync error. Skipping a protocol event is not allowed. Provider failure retries with bounded backoff and another provider where configured.

Loss of local mirror state triggers replay from a trusted checkpoint or deployment block. Loss of only higher-level SDK state can recover from the durable event journal and contract views.

## 12. Current implementation

`StateChannelManagerEvents.sol` declares thirteen events. `StateChannelManagerInterface.sol` exposes manager and audit operations. `Errors.sol` uses custom errors, including detailed inbound-range failure data.

`LocalDiamond.sol` implements direct event handlers. Some families use `(blockNumber, logIndex)` guards, while calldata, dispute, slash, and kill handlers use payload deduplication without a full coordinate. It uses swap-with-last for killed commitments, matching the current contract but violating stable survivor order. `onChannelOpened` constructs an inbound block value but does not persist it in the shown path.

## 13. Difference from the intended design

| Classification     | Difference                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| missing            | durable event journal with transaction index, block hash, chain ID, and rollback data                  |
| missing            | full coordinate guards for every event family                                                          |
| bug                | local kill handler reorders surviving commitments                                                      |
| bug                | local open handler does not clearly persist the genesis inbound block it constructs                    |
| missing            | full mirror reconciliation against production getters                                                  |
| documentation debt | interface mixes user endpoints, internal composition calls, and audit helpers without exposure classes |
| missing            | protocol version event and ABI activation by block                                                     |
| missing            | typed SDK policy for every custom error                                                                |

## 14. Dependencies and cross-layer effects

Every SDK manager depends on event sync. Storage durability and reorganization recovery are defined in SDK storage chapters. Contract upgrade architecture determines ABI version activation. Operations depend on cursor lag, provider health, and reconciliation metrics.

## 15. Verification

Tests must deliver every event twice, out of order, with gaps, across restart, and across a simulated reorganization. They must compare all relevant LocalDiamond getters with production contract getters. Tests also need wrong emitter, wrong chain, corrupted payload, ABI version transition, provider disagreement, cursor transaction failure, and multicall rollback.

Custom error tests must confirm selector and fields for each endpoint’s boundary cases. SDK tests must map each class to rebuild, reject, retry, or fatal behavior.

## 16. Future work

Compact events may reduce gas after the replay contract is stable. Removing payload fields is safe only if one bounded getter call can reconstruct the exact event effect at the historical block.
