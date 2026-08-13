# MessageBlockStorage.ts — Source Report

> **Source:** [src/storage/MessageBlockStorage.ts](../../../../../../../src/storage/MessageBlockStorage.ts) > **Status:** Authored — engineer verification pending.
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

One hash-linked message-block chain (the facade instantiates it twice: inbound and outbound):
blocks keyed by the hash of their canonical encoding, a latest-tip pointer (hash and height),
and backward `[upper, lower)` range reads following `previousBlockHash` linkage.

## Key design decisions

1. **Content addressing with a caller-hash escape.** The key defaults to the canonical-encoding
   hash; a caller-supplied hash is trusted per the producer-guarantee rule ([#L28](../../../../../../../src/storage/MessageBlockStorage.ts#L28)).
2. **`justPersist` skips the tip.** Backfill imports store without touching the latest pointer
   ([#L38](../../../../../../../src/storage/MessageBlockStorage.ts#L38})).
3. **Ranges are generators over linkage.** Reads walk `previousBlockHash` strictly; no index by
   height exists, so linkage is the only traversal truth ([#L60](../../../../../../../src/storage/MessageBlockStorage.ts#L60)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                         |
| ------------ | ---------------------------------------------------------------- |
| Inputs       | Message blocks (optional hash/justPersist); range/tip queries.   |
| Outputs      | Blocks by hash; latest tip hash/height; backward linked ranges.  |
| Owned state  | `blockMap`, `latestBlockHash`, `latestBlockHeight` per instance. |
| Side effects | None.                                                            |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                       | Specification IDs                                                                                                                                                                                          |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [MessageBlockStorage.ts](../../../../../../../src/storage/MessageBlockStorage.ts) | [`REQ-MSGSTORE-1-6ME9D7`](../../../../specification/storage/message-blocks.md#req-msgstore-1-6me9d7), [`REQ-MSGSTORE-2-8RDXPZ`](../../../../specification/storage/message-blocks.md#req-msgstore-2-8rdxpz) |

## Assumptions, dependencies, trust boundaries, and limits

- Chain validity (height increments, cumulative totals) is settlement's and enforcement's to verify; this store keeps and returns what was committed.
- The two facade instances (inbound/outbound) share no state.
- In-memory medium for this protocol version: durability across restart is not yet provided; the
  target contract is [durability.md](../../../../specification/storage/durability.md).

## Specification adherence

- Content-addressed storage with idempotent duplicate stores ([`REQ-MSGSTORE-1-6ME9D7`](../../../../specification/storage/message-blocks.md#req-msgstore-1-6me9d7), addressing clause).
- Backward `[upper, lower)` walks follow linkage only — no gap-bridging or height substitution ([`REQ-MSGSTORE-2-8RDXPZ`](../../../../specification/storage/message-blocks.md#req-msgstore-2-8rdxpz), linkage clause).

## Specification contradictions

Two divergences, both needing an engineer decision (align code or relax spec):

1. **Tip update uses `>=`.** [`REQ-MSGSTORE-1-6ME9D7`](../../../../specification/storage/message-blocks.md#req-msgstore-1-6me9d7) says the tip advances only when the height
   _exceeds_ the current tip; the code replaces the tip on equal height too ([#L41](../../../../../../../src/storage/MessageBlockStorage.ts#L41)).
   Benign while heights are unique per honest stream, but an equal-height store silently
   repoints the tip.
2. **A gap throws.** [`REQ-MSGSTORE-2-8RDXPZ`](../../../../specification/storage/message-blocks.md#req-msgstore-2-8rdxpz) says an absent block _ends the walk_ with the blocks
   proven so far; the iterator throws on a missing middle block ([#L72](../../../../../../../src/storage/MessageBlockStorage.ts#L72)),
   propagating to range callers.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                              | Implementation status | Evidence                                                                                                                                          | Gap / divergence                                                                            |
| ---------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [`REQ-MSGSTORE-1-6ME9D7`](../../../../specification/storage/message-blocks.md#req-msgstore-1-6me9d7) | Contradicts           | **Here:** content addressing, idempotent duplicates, `justPersist` opt-out ([#L28](../../../../../../../src/storage/MessageBlockStorage.ts#L28)). | Tip clause: `>=` lets an equal-height store repoint the tip (spec requires strictly newer). |
| [`REQ-MSGSTORE-2-8RDXPZ`](../../../../specification/storage/message-blocks.md#req-msgstore-2-8rdxpz) | Contradicts           | **Here:** strict linkage walks, `[upper, lower)` bounds ([#L60](../../../../../../../src/storage/MessageBlockStorage.ts#L60)).                    | Gap behavior: missing middle block throws instead of ending the walk with proven blocks.    |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                    | Obligation              | Public entry and setup                                                                         | Oracle and forbidden effects                                                                                           | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-message-block-storage-1-ehbrd1"></a>`UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1` | Store and tip semantics | Store extending, equal-height, historical, duplicate, and justPersist blocks in both instances | Addressing exact; duplicates idempotent; tip behavior documented incl. the equal-height divergence; instances isolated | <a id="unit-test-message-block-storage-1-ehbrd1.p1"></a>`UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P1` — tip advance on extension; <a id="unit-test-message-block-storage-1-ehbrd1.p2"></a>`UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P2` — equal-height store (documents divergence); <a id="unit-test-message-block-storage-1-ehbrd1.p3"></a>`UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P3` — justPersist leaves tip; <a id="unit-test-message-block-storage-1-ehbrd1.p4"></a>`UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P4` — duplicate idempotent; <a id="unit-test-message-block-storage-1-ehbrd1.p5"></a>`UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P5` — instance isolation                                                                                                  |
| <a id="unit-test-message-block-storage-2-9nc6vv"></a>`UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV` | Range reads             | Read ranges over complete, gapped, and unlinked chains with each bound shape                   | Complete ranges exact; gap behavior documented (throw — divergence); unknown upper returns empty; equal bounds empty   | <a id="unit-test-message-block-storage-2-9nc6vv.p1"></a>`UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P1` — complete range; <a id="unit-test-message-block-storage-2-9nc6vv.p2"></a>`UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P2` — missing middle block (documents divergence); <a id="unit-test-message-block-storage-2-9nc6vv.p3"></a>`UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P3` — bound at genesis; <a id="unit-test-message-block-storage-2-9nc6vv.p4"></a>`UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P4` — unknown upper bound; <a id="unit-test-message-block-storage-2-9nc6vv.p5"></a>`UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P5` — bound at tip; <a id="unit-test-message-block-storage-2-9nc6vv.p6"></a>`UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P6` — equal bounds |

## Related source reports

- [Storage.ts](./Storage.ts.md) (instantiates inbound/outbound), [StateManager](../stateManager/StateManager.ts.md) and [DisputeManager](../disputeManager/DisputeManager.ts.md) (range consumers).
