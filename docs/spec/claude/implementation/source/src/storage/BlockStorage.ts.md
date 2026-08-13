# BlockStorage.ts — Source Report

> **Source:** [src/storage/BlockStorage.ts](../../../../../../../src/storage/BlockStorage.ts) > **Status:** Authored — engineer verification pending.
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

The committed-block store: blocks addressable by hash and by (fork, height), per-fork maximum
height (the local tip), growing confirmation-signature sets, and the optional on-chain posting
timestamp.

## Key design decisions

1. **One object, two indexes.** Hash map and coordinate map point at the _same_ `Block`
   instance ([#L296](../../../../../../../src/storage/BlockStorage.ts#L296)), so index consistency ([`INV-BLKSTORE-1-MK4W8D`](../../../../specification/storage/blocks.md#inv-blkstore-1-mk4w8d)) holds by
   construction; deletes remove from both.
2. **Refuse, then merge.** A store at occupied coordinates aborts (returns absence) when the
   incoming block differs, and merges signatures when equal ([#L310](../../../../../../../src/storage/BlockStorage.ts#L310)) —
   conflict resolution belongs to validation/evidence, never to the store.
3. **Persistence-only stores skip the tip.** `justPersist` lets proof/backfill imports store
   without advancing the fork tip ([#L303](../../../../../../../src/storage/BlockStorage.ts#L303)), keeping imported history
   from masquerading as live progress.
4. **Traversal clamps to the tip.** Backward iteration clamps caller-supplied start heights so
   a remote-supplied absurd height cannot loop over an empty range ([#L254](../../../../../../../src/storage/BlockStorage.ts#L254)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Inputs       | Blocks with signatures (and optional hash/coordinates/justPersist overrides); signature insertions; timestamps; deletes. |
| Outputs      | Blocks by hash or coordinates; latest block; next height; bounded iterators.                                             |
| Owned state  | `hashToBlockMap`, `coordinatesToBlockMap`, `forkIdToMaxHeightMap`.                                                       |
| Side effects | None beyond its maps.                                                                                                    |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                         | Specification IDs                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [BlockStorage.ts](../../../../../../../src/storage/BlockStorage.ts) | [`INV-BLKSTORE-1-MK4W8D`](../../../../specification/storage/blocks.md#inv-blkstore-1-mk4w8d), [`REQ-BLKSTORE-1-KYHTWT`](../../../../specification/storage/blocks.md#req-blkstore-1-kyhtwt), [`REQ-BLKSTORE-2-VWXP2C`](../../../../specification/storage/blocks.md#req-blkstore-2-vwxp2c), [`REQ-BLKSTORE-3-S9V2KC`](../../../../specification/storage/blocks.md#req-blkstore-3-s9v2kc) |

## Assumptions, dependencies, trust boundaries, and limits

- Callers store only pipeline-accepted blocks; the store checks keys and equality, not protocol validity.
- Caller-supplied hash/coordinate overrides are trusted to match content to the extent the producer guarantees (same trust rule as [`INV-SNAPSTORE-1-DPHPJE`](../../../../specification/storage/snapshots-and-states.md#inv-snapstore-1-dphpje)).
- In-memory medium for this protocol version: durability across restart is not yet provided; the
  target contract is [durability.md](../../../../specification/storage/durability.md).

## Specification adherence

- Dual-index consistency including deletes ([`INV-BLKSTORE-1-MK4W8D`](../../../../specification/storage/blocks.md#inv-blkstore-1-mk4w8d)).
- Same-coordinate conflict refusal with original intact; equal-block signature merge ([`REQ-BLKSTORE-1-KYHTWT`](../../../../specification/storage/blocks.md#req-blkstore-1-kyhtwt)).
- Monotone signature merge via set expansion ([`REQ-BLKSTORE-2-VWXP2C`](../../../../specification/storage/blocks.md#req-blkstore-2-vwxp2c), signature clause).
- Tip advances only on non-`justPersist` stores that raise the height; traversal clamped ([`REQ-BLKSTORE-3-S9V2KC`](../../../../specification/storage/blocks.md#req-blkstore-3-s9v2kc)).

## Specification contradictions

**Timestamp overwrite.** [`REQ-BLKSTORE-2-VWXP2C`](../../../../specification/storage/blocks.md#req-blkstore-2-vwxp2c) requires the _earliest_ observed on-chain timestamp to
win, but both `setOnChainTimestamp` ([#L133](../../../../../../../src/storage/BlockStorage.ts#L133)) and the equal-block merge
([#L318](../../../../../../../src/storage/BlockStorage.ts#L318)) overwrite unconditionally — a later timestamp replaces an earlier
one. Earliest-wins is enforced only upstream in the queue's merge
(./QueueStorage.ts.md)); a calldata copy arriving after commitment bypasses that.
Engineer decision: enforce min() here or relax the spec clause.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                      | Implementation status | Evidence                                                                                                                                                                                                                                                                                 | Gap / divergence                                                                                      |
| -------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [`INV-BLKSTORE-1-MK4W8D`](../../../../specification/storage/blocks.md#inv-blkstore-1-mk4w8d) | Covered               | **Here:** shared object identity across both maps ([#L296](../../../../../../../src/storage/BlockStorage.ts#L296)); dual-map deletes ([#L179](../../../../../../../src/storage/BlockStorage.ts#L179)).                                                                                   | None.                                                                                                 |
| [`REQ-BLKSTORE-1-KYHTWT`](../../../../specification/storage/blocks.md#req-blkstore-1-kyhtwt) | Covered               | **Here:** refuse-if-unequal, merge-if-equal ([#L310](../../../../../../../src/storage/BlockStorage.ts#L310)). **Other files:** conflict _resolution_ is [ValidationService](../stateManager/ValidationService.ts.md) evidence rules.                                                     | None.                                                                                                 |
| [`REQ-BLKSTORE-2-VWXP2C`](../../../../specification/storage/blocks.md#req-blkstore-2-vwxp2c) | Contradicts           | **Here:** monotone signature merge ([#L317](../../../../../../../src/storage/BlockStorage.ts#L317)). **Other files:** [QueueStorage](./QueueStorage.ts.md) enforces earliest-wins on the queue-merge path only.                                                                          | Timestamp clause violated here: unconditional overwrite in setter and merge — later replaces earlier. |
| [`REQ-BLKSTORE-3-S9V2KC`](../../../../specification/storage/blocks.md#req-blkstore-3-s9v2kc) | Covered               | **Here:** `_updateMaxHeight` only-increase ([#L328](../../../../../../../src/storage/BlockStorage.ts#L328)); `justPersist` opt-out ([#L303](../../../../../../../src/storage/BlockStorage.ts#L303)); clamped traversal ([#L254](../../../../../../../src/storage/BlockStorage.ts#L254)). | None.                                                                                                 |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                    | Obligation                             | Public entry and setup                                                                       | Oracle and forbidden effects                                                                                      | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-block-storage-1-fy94th"></a>`UNIT-TEST-BLOCK-STORAGE-1-FY94TH` | Index consistency and conflict refusal | Store, merge, delete via both key forms; attempt same-coordinate different-block stores      | Both indexes always agree; conflicting store returns absence with original intact; equal store merges             | <a id="unit-test-block-storage-1-fy94th.p1"></a>`UNIT-TEST-BLOCK-STORAGE-1-FY94TH.P1` — store/read via both keys; <a id="unit-test-block-storage-1-fy94th.p2"></a>`UNIT-TEST-BLOCK-STORAGE-1-FY94TH.P2` — delete via hash key removes both; <a id="unit-test-block-storage-1-fy94th.p3"></a>`UNIT-TEST-BLOCK-STORAGE-1-FY94TH.P3` — conflicting body refused; <a id="unit-test-block-storage-1-fy94th.p4"></a>`UNIT-TEST-BLOCK-STORAGE-1-FY94TH.P4` — equal body merges signatures; <a id="unit-test-block-storage-1-fy94th.p5"></a>`UNIT-TEST-BLOCK-STORAGE-1-FY94TH.P5` — delete via coordinate key removes both |
| <a id="unit-test-block-storage-2-k77eca"></a>`UNIT-TEST-BLOCK-STORAGE-2-K77ECA` | Timestamp semantics                    | Set timestamps by hash and coordinates; merge copies carrying timestamps in both orders      | Documents current overwrite behavior vs the earliest-wins requirement (expected-fail until the engineer decision) | <a id="unit-test-block-storage-2-k77eca.p1"></a>`UNIT-TEST-BLOCK-STORAGE-2-K77ECA.P1` — earlier-then-later; <a id="unit-test-block-storage-2-k77eca.p2"></a>`UNIT-TEST-BLOCK-STORAGE-2-K77ECA.P2` — later-then-earlier; <a id="unit-test-block-storage-2-k77eca.p3"></a>`UNIT-TEST-BLOCK-STORAGE-2-K77ECA.P3` — merge-carried timestamp vs setter                                                                                                                                                                                                                                                                  |
| <a id="unit-test-block-storage-3-zpt4bn"></a>`UNIT-TEST-BLOCK-STORAGE-3-ZPT4BN` | Tip and traversal bounds               | Store extending, backfill (justPersist), and out-of-order blocks; iterate with absurd bounds | Tip reflects only live stores; iteration clamps; latest-block agrees with tip                                     | <a id="unit-test-block-storage-3-zpt4bn.p1"></a>`UNIT-TEST-BLOCK-STORAGE-3-ZPT4BN.P1` — tip advancement; <a id="unit-test-block-storage-3-zpt4bn.p2"></a>`UNIT-TEST-BLOCK-STORAGE-3-ZPT4BN.P2` — justPersist leaves tip; <a id="unit-test-block-storage-3-zpt4bn.p3"></a>`UNIT-TEST-BLOCK-STORAGE-3-ZPT4BN.P3` — absurd remote-supplied bound clamped; <a id="unit-test-block-storage-3-zpt4bn.p4"></a>`UNIT-TEST-BLOCK-STORAGE-3-ZPT4BN.P4` — out-of-order store                                                                                                                                                  |

## Related source reports

- [QueueStorage](./QueueStorage.ts.md) (pre-commit stage), [StateManager](../stateManager/StateManager.ts.md) (commit path), [AgreementManager](../agreementManager/AgreementManager.ts.md) (proof construction reads).
