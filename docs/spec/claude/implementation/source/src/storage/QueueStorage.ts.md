# QueueStorage.ts — Source Report

> **Source:** [src/storage/QueueStorage.ts](../../../../../../../src/storage/QueueStorage.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

The pre-execution queue store: not-yet-eligible block confirmations keyed by block hash, each
entry carrying the merged signature set, first-seen time, source peers, and per-signature
attribution, with a (fork, height) coordinate index for eligibility queries.

## Key design decisions

1. **Copy-scoped attribution.** A sender is credited only with the signatures _its own copy_
   carried ([#L59](../../../../../../../src/storage/QueueStorage.ts#L59)) — attribution is evidence, and pooling it would
   launder blame across suppliers.
2. **Caps are markers, never gates.** The 128-source structural cap sets `overflowedSources`
   and stops retention growth; it never evicts tracked sources or rejects a later copy
   ([#L586](../../../../../../../src/storage/QueueStorage.ts#L586)).
3. **Storage never schedules.** `restoreEntry` only mutates data — the queue manager reads the
   entry back to (re)schedule ([#L138](../../../../../../../src/storage/QueueStorage.ts#L138)); restores keep the _earliest_
   `firstSeenAt`, so the fixed entry lifetime can never be extended from storage.
4. **Competing bodies coexist.** The primary key is the block hash; two bodies at one
   coordinate are distinct entries and the queue never picks between them — conflict
   resolution stays with validation.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| Inputs       | Blocks with sender attribution; restore of dequeued entries; dequeue/clear commands.                    |
| Outputs      | Queued entries (with attribution) by hash, exact coordinate, lowest-eligible coordinate, or fork clear. |
| Owned state  | `queuedBlocks` (hash → entry), `blocksByCoordinates` index.                                             |
| Side effects | None — no timers, no scheduling, no I/O.                                                                |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                         | Specification IDs                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [QueueStorage.ts](../../../../../../../src/storage/QueueStorage.ts) | [`REQ-QSTORE-1`](../../../../specification/storage/queue.md#req-qstore-1), [`REQ-QSTORE-2`](../../../../specification/storage/queue.md#req-qstore-2), [`REQ-QSTORE-3`](../../../../specification/storage/queue.md#req-qstore-3), [`REQ-BLOCK-PIPE-5`](../../../../specification/block-progression/block-processing.md#req-block-pipe-5) |

## Assumptions, dependencies, trust boundaries, and limits

- Holds unvalidated knowledge by design; everything read back re-enters pipeline validation.
- Frequency bounding is the communication layer's duty ([`REQ-RPC-5`](../../../../specification/peer-communication/rpc.md#req-rpc-5)); this store bounds per-entry structure only.
- In-memory medium for this protocol version: durability across restart is not yet provided; the
  target contract is [durability.md](../../../../specification/storage/durability.md).

## Specification adherence

- Attributed monotone merge with earliest-first-seen and order-independent convergence ([`REQ-QSTORE-1`](../../../../specification/storage/queue.md#req-qstore-1)).
- Overflow markers without eviction or rejection ([`REQ-QSTORE-2`](../../../../specification/storage/queue.md#req-qstore-2)).
- Exact-coordinate dequeue, lowest-height-≤-bound priority dequeue, complete fork clear ([`REQ-QSTORE-3`](../../../../specification/storage/queue.md#req-qstore-3)).
- Mutex-free intake share of [`REQ-BLOCK-PIPE-5`](../../../../specification/block-progression/block-processing.md#req-block-pipe-5): all operations are plain map mutations.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                     | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-QSTORE-1`](../../../../specification/storage/queue.md#req-qstore-1)                              | Covered               | **Here:** copy-scoped `trackSource`, signature-set expansion, earliest `firstSeenAt`, on-chain-timestamp min-merge ([#L53](../../../../../../../src/storage/QueueStorage.ts#L53), [#L138](../../../../../../../src/storage/QueueStorage.ts#L138)).                                           | None.            |
| [`REQ-QSTORE-2`](../../../../specification/storage/queue.md#req-qstore-2)                              | Covered               | **Here:** capped inserts flip the marker, never evict or reject ([#L586](../../../../../../../src/storage/QueueStorage.ts#L586)).                                                                                                                                                            | None.            |
| [`REQ-QSTORE-3`](../../../../specification/storage/queue.md#req-qstore-3)                              | Covered               | **Here:** `tryDequeueAt` exact, `tryDequeuePriority` lowest ≤ bound, `clearFork` reports removals ([#L81](../../../../../../../src/storage/QueueStorage.ts#L81)).                                                                                                                            | None.            |
| [`REQ-BLOCK-PIPE-5`](../../../../specification/block-progression/block-processing.md#req-block-pipe-5) | Covered               | **Here:** merge layer data rules (monotone, idempotent, attributed, capped). **Other files:** [BlockQueueManager](../stateManager/BlockQueueManager.ts.md) owns scheduling/lifetime; [StateManager](../stateManager/StateManager.ts.md) owns the execution boundary the queue stays outside. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                      | Obligation                | Public entry and setup                                                | Oracle and forbidden effects                                                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-queue-storage-1"></a>`UNIT-TEST-QUEUE-STORAGE-1` | Attributed monotone merge | Queue copies of one block from several senders, orders permuted       | Converged signature set and attribution identical for every order; senders credited only with their copies; earliest firstSeenAt kept | <a id="unit-test-queue-storage-1.p1"></a>`UNIT-TEST-QUEUE-STORAGE-1.P1` — disjoint copies; <a id="unit-test-queue-storage-1.p2"></a>`UNIT-TEST-QUEUE-STORAGE-1.P2` — order permutations converge; <a id="unit-test-queue-storage-1.p3"></a>`UNIT-TEST-QUEUE-STORAGE-1.P3` — attribution copy-scoping; <a id="unit-test-queue-storage-1.p4"></a>`UNIT-TEST-QUEUE-STORAGE-1.P4` — restore merges without extending lifetime; <a id="unit-test-queue-storage-1.p5"></a>`UNIT-TEST-QUEUE-STORAGE-1.P5` — overlapping copies; <a id="unit-test-queue-storage-1.p6"></a>`UNIT-TEST-QUEUE-STORAGE-1.P6` — duplicate copies |
| <a id="unit-test-queue-storage-2"></a>`UNIT-TEST-QUEUE-STORAGE-2` | Caps as markers           | Flood one entry past the source cap, then deliver an honest copy      | Marker set; tracked sources retained; later valid copy accepted and processed                                                         | <a id="unit-test-queue-storage-2.p1"></a>`UNIT-TEST-QUEUE-STORAGE-2.P1` — cap reached; <a id="unit-test-queue-storage-2.p2"></a>`UNIT-TEST-QUEUE-STORAGE-2.P2` — pre-flood honest source survives; <a id="unit-test-queue-storage-2.p3"></a>`UNIT-TEST-QUEUE-STORAGE-2.P3` — post-overflow valid copy accepted                                                                                                                                                                                                                                                                                                      |
| <a id="unit-test-queue-storage-3"></a>`UNIT-TEST-QUEUE-STORAGE-3` | Dequeue rules             | Queue entries across forks/heights incl. two bodies at one coordinate | Exact and priority dequeues select correctly; both competing bodies dequeue together; clearFork empties both maps                     | <a id="unit-test-queue-storage-3.p1"></a>`UNIT-TEST-QUEUE-STORAGE-3.P1` — exact coordinate; <a id="unit-test-queue-storage-3.p2"></a>`UNIT-TEST-QUEUE-STORAGE-3.P2` — lowest ≤ bound priority; <a id="unit-test-queue-storage-3.p3"></a>`UNIT-TEST-QUEUE-STORAGE-3.P3` — competing bodies coexist and both return; <a id="unit-test-queue-storage-3.p4"></a>`UNIT-TEST-QUEUE-STORAGE-3.P4` — fork clear completeness; <a id="unit-test-queue-storage-3.p5"></a>`UNIT-TEST-QUEUE-STORAGE-3.P5` — empty coordinate                                                                                                    |

## Related source reports

- [BlockQueueManager](../stateManager/BlockQueueManager.ts.md) (the scheduler over this store), [BlockStorage](./BlockStorage.ts.md) (post-commit destination).
