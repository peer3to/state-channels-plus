# SDK block intake, validation, confirmation, and agreement pipeline

## Status and authority

This chapter defines the complete SDK pipeline for peer RPC, chain calldata, dispute replay, and spectate intake. Shared predicates are fixed; strategies choose consequences.

## 1. Purpose

Every signed block must pass the same authentication, ancestry, leader, time, message, and replay rules regardless of source. The pipeline must tolerate duplicate and out-of-order delivery, collect new signatures on stored blocks, preserve proof evidence, and escalate only the right failures.

## 2. Design decisions and rationale

### 2.1 Authenticate before constructing rich models

The intake verifies the `BlockConfirmation` signature structure before it trusts decoded block fields or allocates long-lived queue records. This limits forged-source attribution and resource work.

### 2.2 Queue by block identity and pool sources

Duplicate copies of the same block merge signatures and source peers into one entry. The entry retains first-seen time, so duplicates cannot extend the agreement window. Signature-to-source attribution lets the SDK disconnect only peers that supplied invalid extra signatures.

### 2.3 One queue timeout performs synchronization probes

Future or unknown-fork data waits through one convergence window. Only timeout asks suppliers to synchronize or prove the fork. Immediate sync probes on every arrival can punish honest peers during ordinary reordering and amplify junk floods.

### 2.4 Strategy callbacks own consequences

Validation returns typed results. Live strategy may disconnect, create fraud evidence, dispute, requeue, store, or broadcast. Dispute strategy converts the same fault into a dispute kill proof. Spectate strategy aborts only for provable channel participant fraud and otherwise drops junk. Calldata strategy treats chain-published bytes as availability evidence but still uses ordinary replay.

### 2.5 Stored block and new block are different paths

A duplicate block with new valid signatures should merge confirmation data without re-executing the state transition. A new block requires full replay and canonical head mutation.

## 3. Boundary and responsibilities

RPC and event sync supply `BlockConfirmation` plus source context. `BlockQueueManager` authenticates, deduplicates, waits, and schedules. `ValidationService` runs shared predicates. `StateManager` holds the channel mutex and executes or merges. Strategies perform path-specific side effects. `AgreementManager` interprets stored signatures and builds proofs.

## 4. Data model and owned state

### 4.1 Queue entry

A queued entry contains block model, block hash, first-seen protocol time, source peer set, signature-to-source map, optional chain timestamp, and validation source. The queue indexes by hash and orders candidates by fork and height. Retention is bounded.

### 4.2 Validation result

| Result            | Shared meaning                                                                      |
| ----------------- | ----------------------------------------------------------------------------------- |
| `SUCCESS`         | input may continue or was accepted                                                  |
| `DUPLICATE`       | no new protocol state beyond already known data                                     |
| `NOT_READY`       | data may become valid after predecessor, channel, or fork synchronization           |
| `NOT_ENOUGH_TIME` | objective rules pass or remain uncertain, but local observation window is not ready |
| `BROADCAST`       | stored block gained useful signatures and should be relayed                         |
| `DISCONNECT`      | source delivered unprovable junk or unauthorized data                               |
| `DISPUTE`         | objective fault or dispute-invalidating evidence exists                             |

The enum value does not itself authorize a slash. Only a concrete proof candidate can do that.

### 4.3 Source modes

| Mode                 | Live gates                            | Consequence                                                                 |
| -------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| peer block           | current fork and next-height gates on | sign, broadcast, proof, requeue, or disconnect                              |
| calldata event       | live gates on                         | recover data, validate, proof if invalid; no trust from chain presence      |
| dispute proof replay | live gates off                        | audit committed historical proof out of current order; create kill evidence |
| spectate sync        | live gates on within staged replica   | persist only verified state; abort safely on channel fraud                  |

## 5. Inputs and preconditions

Intake requires active or permitted synchronizing lifecycle, bounded frame, matching channel scope or explicit wrong-channel handling, source identity for peer punishment, and validation strategy fixed for the operation. Chain intake also needs verified event commitment and inclusion timestamp.

The state manager must have fork genesis and predecessor state before full replay. Missing data is `NOT_READY` in live paths and a validation-data failure in a complete dispute proof.

## 6. Processing algorithm

### 6.1 Peer RPC intake

1. RPC handshake binds transport to peer address.
2. State transition service passes raw `BlockConfirmation` and sender address to queue manager.
3. Enforce encoded block, signature count, signature byte, inbound block, and nested message bounds.
4. Verify original block signature and all parse-critical structure without manager mutation.
5. On authentication failure, invoke strategy and return its keep-connection decision.
6. Construct `Block` model and compute hash.
7. If same hash is stored, create a temporary merge entry and schedule stored-signature merge.
8. Reject wrong channel for a sourced peer; an internal unsourced path may ignore it.
9. If fork is already disputed, clear queued data for it and ignore new unstored block.
10. If fork differs from current, cheaply check whether current fork recovery should be scheduled; queue but do not validate against wrong head.
11. Merge into queue, preserving earliest first-seen and source maps.
12. arm timeout for remaining fixed `agreementTime` and schedule execution for current fork.

### 6.2 Calldata event intake

1. Event sync verifies manager emitter and commitment.
2. Decode block only after event byte bounds.
3. Build a confirmation containing the author signature and set `onChainTimestamp` from event.
4. Store calldata record even if block later proves invalid, because it is objective evidence.
5. Ingest with `CalldataCommittedStrategy` and no untrusted transport source.
6. Deduplicate a block already received through P2P while adding chain timestamp to its stored record.

### 6.3 Queue selection

1. Read next height of current fork.
2. Dequeue candidates with priority at or below that height.
3. Cancel their queue timers.
4. If fork became disputed, clear the fork queue.
5. Schedule each candidate as a separate owned task; do not execute inline from a timer callback.

Candidates above next height remain queued. Equal-height conflicts remain separate entries until validation detects conflict.

### 6.4 Queue timeout

1. Remove the entry so one timeout owns it.
2. If fork became disputed, clear it.
3. If block became stored, schedule signature merge.
4. If entry fork is a known stale fork, drop without punishing honest lagging sources.
5. If entry fork is unknown, request synchronization from all suppliers once.
6. If current-fork height is now executable, schedule validation.
7. If still future, discard bounded queue copy and request sync. Chain calldata can recover it later.

Sync failure may disconnect suppliers only after validating that they claimed an unknown fork and failed the defined proof request. A slow response alone is not Byzantine evidence.

### 6.5 Serialized shared validation

Inside the channel mutation operation:

1. Recheck channel and open state.
2. Derive previous and resulting participant union. Remove or reject signatures from outside it according to strategy.
3. Require block author belongs to previous or transition-authorized context.
4. Look for stored block at the same fork and height.
5. If same author signed different bytes, preserve both and invoke double-sign consequence.
6. If another author conflicts, distinguish linked invalid transition from unlinked ambiguous fork data.
7. For live strategies, check fork is not disputed and block is not above next height.
8. Verify genesis parent or prior block hash.
9. Position state machine at predecessor and require expected next leader equals author.
10. Run objective timestamp and calldata-publication rules; if parent context is incomplete, recover it and retry.
11. Apply subjective local agreement-time gate only on live peer or spectate path.

If any step returns a terminal result, restore state-machine predecessor and queue ownership as required before leaving.

### 6.6 State transition replay

1. Load predecessor snapshot and encoded state by hash.
2. Save a rollback copy or run in isolated execution context.
3. Set state machine to predecessor state.
4. Find pending inbound blocks beginning at predecessor inbound head.
5. Require block-provided inbound blocks match authoritative stored values, ancestry, height, and permitted range.
6. Execute transaction with fixed gas limit.
7. Capture serialized state, participants, and outbound messages.
8. Build outbound message block with deterministic timestamp and order.
9. compute resulting deposits, withdrawals, stream heads, state hash, fork, block height, and timestamp;
10. enforce balance conservation;
11. require exact resulting snapshot hash equals block claim;
12. on mismatch or execution failure, restore predecessor state and invoke invalid-transition consequence.

### 6.7 Atomic success commit

The production transaction writes together:

- signed block and all valid signatures;
- block coordinate and parent/hash indexes;
- resulting snapshot;
- encoded state keyed by its hash;
- inbound and outbound block records;
- participant change point when set changes;
- non-equivocation signed-position record;
- queue removal and validation status.

After commit, decide whether local participant should sign. The signer must be in the threshold context, must not have signed a conflicting history, and must not be in spectator or disputed state. Persist local signature before gossip.

### 6.8 Stored block signature merge

1. Lock channel and load stored block by hash.
2. Authenticate every new signature and map it to eligible participant context.
3. Remove stray signatures and punish only attributed suppliers under strategy.
4. If no new valid signature, return duplicate.
5. Merge distinct valid signatures and persist.
6. Recompute finality and milestones.
7. Broadcast updated confirmation if it adds information.

Do not replay application state.

### 6.9 Agreement and milestone update

After any signature merge:

1. calculate direct signer coverage for the block;
2. update virtual coverage of its accepted ancestors;
3. detect newly final anchors under their membership union;
4. persist milestone proof and paired snapshot context;
5. when final snapshot has new outbound head, schedule same-fork snapshot update after configured policy delay;
6. keep non-final descendants for later proof suffix.

Current `AgreementManager.getStateProof` builds participant-change milestones and a latest milestone, but when any milestone exists it returns an empty signed suffix. It therefore loses a required non-final tail after the last milestone.

### 6.10 Escalation and connection decision

| Failure                                                                        | Live peer strategy                                                                 |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| bad envelope or wrong channel                                                  | disconnect source                                                                  |
| outsider author                                                                | disconnect sources and author; no participant slash                                |
| stray confirmation                                                             | remove it and disconnect only suppliers of that signature                          |
| future block                                                                   | requeue until fixed timeout                                                        |
| disputed fork                                                                  | wait or disconnect only peers known to have acknowledged dispute and kept building |
| double sign                                                                    | build fraud proof and start recovery                                               |
| invalid transition, wrong genesis, forged inbound, objective invalid timestamp | build fraud proof and start recovery                                               |
| subjective late arrival                                                        | wait, request, or use calldata; do not claim fraud                                 |
| malformed unlinked conflict without objective proof                            | disconnect supplier, retain evidence if useful                                     |

## 7. Outputs and postconditions

The pipeline returns whether the source connection should remain. More important outputs are durable accepted state, merged confirmations, final anchors, queue state, fraud-proof records, dispute trigger, and data recovery tasks.

## 8. Invariants

- **BLK-INV-1:** one queued hash has one fixed first-seen deadline.
- **BLK-INV-2:** source attribution is retained per signature.
- **BLK-INV-3:** future data never executes before the next required height.
- **BLK-INV-4:** stored blocks merge signatures without state replay.
- **BLK-INV-5:** new blocks mutate canonical state only after exact replay.
- **BLK-INV-6:** failed validation restores predecessor EVM state.
- **BLK-INV-7:** local signature and non-equivocation record commit before broadcast.
- **BLK-INV-8:** strategy cannot turn a shared invalid predicate into success, only choose consequences where protocol permits.
- **BLK-INV-9:** calldata source does not bypass ordinary validation.
- **BLK-INV-10:** dispute replay does not enforce live current-fork order but still enforces proof ancestry.

## 9. Ordering, concurrency, and atomicity

Queue ingestion can occur concurrently. Queue entry merge is atomic by hash. Execution tasks acquire the state-manager mutex and recheck fork and next height. A dequeued entry has one owner; restore is the only allowed requeue path.

Fork recovery from a mismatched block runs detached to avoid mutex deadlock and is coalesced once per current fork. Suppression lasts until known kill deadline. On fork transition, recovery gates, timeouts, and old queue entries clear.

## 10. Trust and security assumptions

Peers can send authentic but resource-heavy future data, many stray signatures, and unknown forks. Queue cap, fixed lifetime, source pooling, sync coalescing, and network budgets are security controls. They are incomplete without durable and global limits.

Local EVM and TypeScript model must use identical artifacts and encodings. A disagreement can create false fraud proofs or invalid confirmations.

## 11. Failure behavior and recovery

Unexpected exception is not a validation verdict. It logs, releases ownership, restores EVM state, and keeps or quarantines the queue entry under a retry budget. Current broad catch in intake returns false, which can blur internal failure and peer fault; production must keep them separate.

On crash, durable queues restore original first-seen timestamps and source evidence. Expired entries execute timeout logic immediately after sync, without extending lifetime.

## 12. Current implementation

The named managers and four strategies implement most of this flow. `BlockQueueManager` authenticates first, pools sources, preserves fixed lifetime, schedules recovery, and owns restore. `ValidationService` checks channel, open state, author membership, conflicts, disputed fork, future height, linkage, next leader, and time. `StateManager` replays transitions and stores results. `AgreementManager` builds proofs.

Queue and protocol stores are in memory. Queue storage retains at most 128 entries. `AgreementManager.getStateProof` chooses milestones or signed blocks rather than milestone plus suffix. Some strategy branches throw “should not be called,” which makes proof coverage dependent on upstream ordering.

## 13. Difference from the intended design

| Classification     | Difference                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| bug                | state proof builder omits non-final suffix whenever any milestone exists                                  |
| missing            | durable atomic success commit across all storage modules                                                  |
| missing            | durable queue and fixed-deadline restart recovery                                                         |
| missing            | typed distinction between internal verifier failure and peer-invalid input in every catch path            |
| documentation debt | exact replay order of inbound messages and application transaction needs one cross-language test contract |
| missing            | global work budgets beyond 128 queue entries                                                              |
| missing            | complete automatic fraud-proof submission after creation                                                  |
| missing            | proof-safe fallback for all “should not be called” strategy branches                                      |

## 14. Dependencies and cross-layer effects

RPC, event sync, clock, storage, EVM worker, state machine, agreement, fraud, dispute, reduction, and snapshot update all consume pipeline state. A change to accepted block data changes contract fraud proof and state proof semantics.

## 15. Verification

Unit tests need every validation branch under every strategy. Integration tests need duplicate source pooling, fixed timeout, restore, stored merge, future queue, unknown and stale fork, recovery coalescing, state rollback, atomic persistence failure, restart, and dispose. E2E needs peer and calldata intake equivalence, proof creation, non-final suffix, membership milestone, partition, forged RPC source, and queue flood.

## 16. Future work

Parallel signature and proof checks can use worker pools. Final state commit remains serialized and version-checked.
