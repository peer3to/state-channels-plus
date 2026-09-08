# QueueStorage.ts — Source Report

> **Source:** [src/storage/QueueStorage.ts](../../../../../../src/storage/QueueStorage.ts) > **Status:** Authored — engineer verification pending.
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

Queue entries no longer carry a proof-replay flag. The caller selects a validation strategy through the existing ingest option. See [QueueStorage.ts](../../../../../../src/storage/QueueStorage.ts#L42).

isBlockQueued and tryDequeueAt remain public for existing test callers. Their test-only use is retained rather than deleting the tests.

Queue insertion and restoration merge through mergeBlockCapped, which bounds the retained confirmation-signature set at MAX_ENTRY_SIGNATURES and carries the defined timestamp; the creating copy is trimmed by capSignatures. All three write paths -- createEntry, queueBlock and restoreEntry -- are capped, because ingress authenticates only the signed block a copy carries. The three coordinate-index operations call coordinateKey directly. Entry attribution, source caps, earliest arrival and replay state still merge in QueueStorage. See [QueueStorage.ts](../../../../../../src/storage/QueueStorage.ts#L66).

1. **Copy-scoped attribution.** A sender is credited only with the signatures _its own copy_
   carried ([#L60](../../../../../../src/storage/QueueStorage.ts#L54)) — attribution is evidence, and pooling it would
   launder blame across suppliers.
2. **Caps are markers, never gates.** The 128-source structural cap sets `overflowedSources`
   and stops retention growth; it never evicts tracked sources or rejects a later copy
   ([#L292](../../../../../../src/storage/QueueStorage.ts#L286)).
3. **Storage never schedules.** `restoreEntry` only mutates data — the queue manager reads the
   entry back to (re)schedule ([#L138](../../../../../../src/storage/QueueStorage.ts#L138)); restores keep the _earliest_
   `firstSeenAt`, so the fixed entry lifetime can never be extended from storage.
4. **Competing bodies coexist.** The primary key is the block hash; two bodies at one
   coordinate are distinct entries and the queue never picks between them — conflict
   resolution stays with validation.
5. **Replay policy belongs to the strategy.** Queue entries carry block and source data. The ingest caller selects SpectatingValidationStrategy for verified history; storage carries no replay flag.

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

| Source file                                                      | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [QueueStorage.ts](../../../../../../src/storage/QueueStorage.ts) | [`REQ-QSTORE-1-PS769J`](../../../../specification/peer-communication/block-gossip.md#req-qstore-1-ps769j), [`REQ-QSTORE-2-VYWJAQ`](../../../../specification/storage/queue.md#req-qstore-2-vywjaq), [`REQ-QSTORE-3-DEKYG6`](../../../../specification/storage/queue.md#req-qstore-3-dekyg6), [`REQ-BLOCK-PIPE-5-WJ31RG`](../../../../specification/block-progression/block-processing.md#req-block-pipe-5-wj31rg) |

## Assumptions, dependencies, trust boundaries, and limits

- Holds unvalidated knowledge by design; everything read back re-enters pipeline validation.
- Frequency bounding is the communication layer's duty ([`REQ-RPC-5-CV1R1Y`](../../../../specification/peer-communication/rpc.md#req-rpc-5-cv1r1y)); this store bounds per-entry structure only.
- In-memory medium for this protocol version: durability across restart is not yet provided; the
  target contract is [durability.md](../../../../specification/storage/durability.md).

## Specification adherence

- Attributed signature/source merge with earliest-first-seen; signatures and attribution converge independently of copy order ([`REQ-QSTORE-1-PS769J`](../../../../specification/peer-communication/block-gossip.md#req-qstore-1-ps769j)).
- Overflow markers without eviction or rejection, in two dimensions ([`REQ-QSTORE-2-VYWJAQ`](../../../../specification/storage/queue.md#req-qstore-2-vywjaq)): sources at MAX_ENTRY_SOURCES, retained confirmation signatures at MAX_ENTRY_SIGNATURES. Signature retention is first-come, so a signature offered while the entry is overflowed is not retained. Attribution is recorded after capping, so signatureSources never holds a key the block does not.
- Exact-coordinate dequeue, lowest-height-≤-bound priority dequeue, complete fork clear ([`REQ-QSTORE-3-DEKYG6`](../../../../specification/storage/queue.md#req-qstore-3-dekyg6)).
- Mutex-free intake share of [`REQ-BLOCK-PIPE-5-WJ31RG`](../../../../specification/block-progression/block-processing.md#req-block-pipe-5-wj31rg): all operations are plain map mutations.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                              | Implementation status | Evidence                                                                                                                                                                                                                                                                                                        | Gap / divergence                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`REQ-QSTORE-1-PS769J`](../../../../specification/peer-communication/block-gossip.md#req-qstore-1-ps769j)            | Covered               | **Here:** copy-scoped `trackSource`, signature-set expansion, earliest `firstSeenAt`, defined on-chain-timestamp overwrite ([#L54](../../../../../../src/storage/QueueStorage.ts#L54), [#L138](../../../../../../src/storage/QueueStorage.ts#L138)).                                                            | None.                                                                                                                                                                                                                                                                                                                                         |
| [`REQ-QSTORE-2-VYWJAQ`](../../../../specification/storage/queue.md#req-qstore-2-vywjaq)                              | Partial               | **Here:** capped inserts in both dimensions flip the marker, never evict or reject; all three write paths trim ([#L286](../../../../../../src/storage/QueueStorage.ts#L286)).                                                                                                                                   | MAX_ENTRY_SIGNATURES is set above any plausible participant union rather than derived from an enforced one: neither `StateChannelManagerProxy.openChannel` nor `JoinChannelFacet` bounds union size, so the headroom the requirement relies on is assumed. No end-to-end coverage of the peer-observable flood, loss and punishment path yet. |
| [`REQ-QSTORE-3-DEKYG6`](../../../../specification/storage/queue.md#req-qstore-3-dekyg6)                              | Covered               | **Here:** `tryDequeueAt` exact, `tryDequeuePriority` lowest ≤ bound, `clearFork` reports removals ([#L81](../../../../../../src/storage/QueueStorage.ts#L75)).                                                                                                                                                  | None.                                                                                                                                                                                                                                                                                                                                         |
| [`REQ-BLOCK-PIPE-5-WJ31RG`](../../../../specification/block-progression/block-processing.md#req-block-pipe-5-wj31rg) | Partial               | **Here:** merge layer data rules (monotone, idempotent, attributed, capped in both dimensions). **Other files:** [BlockQueueManager](../stateManager/BlockQueueManager.ts.md) owns scheduling/lifetime; [StateManager](../stateManager/StateManager.ts.md) owns the execution boundary the queue stays outside. | Signature retention is first-come, so merge is arrival-order independent only within the cap.                                                                                                                                                                                                                                                 |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                      | Obligation                   | Public entry and setup                                                                                                                      | Oracle and forbidden effects                                                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-queue-storage-1-6w5syt"></a>`UNIT-TEST-QUEUE-STORAGE-1-6W5SYT`   | Attributed monotone merge    | Queue copies of one block from several senders, orders permuted                                                                             | Converged signature set and attribution identical for every order; senders credited only with their copies; earliest firstSeenAt kept | <a id="unit-test-queue-storage-1-6w5syt.p1"></a>`UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P1` — disjoint copies; <a id="unit-test-queue-storage-1-6w5syt.p2"></a>`UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P2` — order permutations converge; <a id="unit-test-queue-storage-1-6w5syt.p3"></a>`UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P3` — attribution copy-scoping; <a id="unit-test-queue-storage-1-6w5syt.p4"></a>`UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P4` — restore merges without extending lifetime; <a id="unit-test-queue-storage-1-6w5syt.p5"></a>`UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P5` — overlapping copies; <a id="unit-test-queue-storage-1-6w5syt.p6"></a>`UNIT-TEST-QUEUE-STORAGE-1-6W5SYT.P6` — duplicate copies |
| <a id="unit-test-queue-storage-2-k2f40f"></a>`UNIT-TEST-QUEUE-STORAGE-2-K2F40F`   | Caps as markers              | Flood one entry past the source cap, then deliver an honest copy                                                                            | Marker set; tracked sources retained; later valid copy accepted and processed                                                         | <a id="unit-test-queue-storage-2-k2f40f.p1"></a>`UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P1` — cap reached; <a id="unit-test-queue-storage-2-k2f40f.p2"></a>`UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P2` — pre-flood honest source survives; <a id="unit-test-queue-storage-2-k2f40f.p3"></a>`UNIT-TEST-QUEUE-STORAGE-2-K2F40F.P3` — post-overflow valid copy accepted                                                                                                                                                                                                                                                                                                                                                |
| <a id="unit-test-queue-storage-3-1s43mc"></a>`UNIT-TEST-QUEUE-STORAGE-3-1S43MC`   | Dequeue rules                | Queue entries across forks/heights incl. two bodies at one coordinate                                                                       | Exact and priority dequeues select correctly; both competing bodies dequeue together; clearFork empties both maps                     | <a id="unit-test-queue-storage-3-1s43mc.p1"></a>`UNIT-TEST-QUEUE-STORAGE-3-1S43MC.P1` — exact coordinate; <a id="unit-test-queue-storage-3-1s43mc.p2"></a>`UNIT-TEST-QUEUE-STORAGE-3-1S43MC.P2` — lowest ≤ bound priority; <a id="unit-test-queue-storage-3-1s43mc.p3"></a>`UNIT-TEST-QUEUE-STORAGE-3-1S43MC.P3` — competing bodies coexist and both return; <a id="unit-test-queue-storage-3-1s43mc.p4"></a>`UNIT-TEST-QUEUE-STORAGE-3-1S43MC.P4` — fork clear completeness; <a id="unit-test-queue-storage-3-1s43mc.p5"></a>`UNIT-TEST-QUEUE-STORAGE-3-1S43MC.P5` — empty coordinate                                                                                                                  |
| <a id="unit-test-queue-storage-32-5ekhv0"></a>`UNIT-TEST-QUEUE-STORAGE-32-5EKHV0` | Queued block timestamp merge | Queue or restore factory-built copies of the same block and inspect the resulting timestamp; undefined preserves and defined zero replaces. | Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.                          | <a id="unit-test-queue-storage-32-5ekhv0.p1"></a>`UNIT-TEST-QUEUE-STORAGE-32-5EKHV0.P1` — restoring a copy without time preserves the queued timestamp; <a id="unit-test-queue-storage-32-5ekhv0.p2"></a>`UNIT-TEST-QUEUE-STORAGE-32-5EKHV0.P2` — restoring a copy with zero time replaces the queued timestamp; <a id="unit-test-queue-storage-32-5ekhv0.p3"></a>`UNIT-TEST-QUEUE-STORAGE-32-5EKHV0.P3` — duplicate queue insertion preserves time when the incoming copy has none                                                                                                                                                                                                                     |

## Related source reports

- [BlockQueueManager](../stateManager/BlockQueueManager.ts.md) (the scheduler over this store), [BlockStorage](./BlockStorage.ts.md) (post-commit destination).

Shared operation owners: [Block.ts.md](../models/Block.ts.md), [StoredBlockMergeService.ts.md](../stateManager/ingest/StoredBlockMergeService.ts.md), [keys.ts.md](keys.ts.md).
