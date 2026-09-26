# DisputeStorage.ts — Source Report

> **Source:** [src/storage/DisputeStorage.ts](../../../../../../src/storage/DisputeStorage.ts) > **Status:** Authored — engineer verification pending.
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

Dispute confirmations keyed by the hash of the encoded dispute, one retained copy per hash with its
origin, plus the per-fork disputed/own-dispute flags.

## Key design decisions

The public confirmation method owns insertion and the retention rule, keyed by the hash of the encoded dispute. See [DisputeStorage.ts](../../../../../../src/storage/DisputeStorage.ts#L49).

1. **One copy per dispute; the chain copy wins.** Callers state each copy's origin
   (`DisputeConfirmationOrigin.CHAIN_EVENT` or `SYNC`, [#L11](../../../../../../src/storage/DisputeStorage.ts#L11)). The first stored copy is
   kept and later copies are ignored, with no co-signature union; only a chain-event copy replaces a
   stored sync copy ([#L57](../../../../../../src/storage/DisputeStorage.ts#L57)). Rationale: nothing off-chain reads these co-signatures and
   sync copies are unverified, so a merge only let a sync peer grow the stored set without bound.
2. **Flags are explicit and default false.** `didIDispute` reads absent as `false`
   ([#L92](../../../../../../src/storage/DisputeStorage.ts#L92)) — local knowledge, never chain truth.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                           |
| ------------ | -------------------------------------------------- |
| Inputs       | Dispute confirmations with origin; fork flags.     |
| Outputs      | Confirmations and decoded disputes by hash; flags. |
| Owned state  | `disputes`, `disputedForks`.                       |
| Side effects | None.                                              |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                          | Specification IDs                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [DisputeStorage.ts](../../../../../../src/storage/DisputeStorage.ts) | [`REQ-DSTORE-1-5AQYJX`](../../../../specification/storage/dispute-evidence.md#req-dstore-1-5aqyjx), [`REQ-DSTORE-2-H1DAGX`](../../../../specification/storage/dispute-evidence.md#req-dstore-2-h1dagx) |

## Assumptions, dependencies, trust boundaries, and limits

- Evidence retention obligations are dispute-window bound; loss converts enforceable claims into unenforceable ones.
- In-memory medium for this protocol version: durability across restart is not yet provided; the
  target contract is [durability.md](../../../../specification/storage/durability.md).

## Specification adherence

- First-copy retention with chain-event precedence and no co-signature merge ([`REQ-DSTORE-1-5AQYJX` (Dispute confirmation retention)](../../../../specification/storage/dispute-evidence.md#req-dstore-1-5aqyjx)).
- Explicit per-fork flags with absent-as-false ([`REQ-DSTORE-2-H1DAGX` (Own-dispute guard)](../../../../specification/storage/dispute-evidence.md#req-dstore-2-h1dagx)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                            | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                     | Gap / divergence |
| -------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-DSTORE-1-5AQYJX`](../../../../specification/storage/dispute-evidence.md#req-dstore-1-5aqyjx) | Covered               | **Here:** first-copy retention and chain-event precedence keyed by origin ([#L49](../../../../../../src/storage/DisputeStorage.ts#L49), [#L57](../../../../../../src/storage/DisputeStorage.ts#L57)). **Other files:** [EventHandler](../eventHandlers/EventHandler.ts.md) stores committed-dispute copies as `CHAIN_EVENT`; [SpectateService](../rpc/network/services/spectate/SpectateService.ts.md) stores sync-payload copies as `SYNC`. | None.            |
| [`REQ-DSTORE-2-H1DAGX`](../../../../specification/storage/dispute-evidence.md#req-dstore-2-h1dagx) | Covered               | **Here:** `storeDisputedFork`/`didIDispute` with false default ([#L42](../../../../../../src/storage/DisputeStorage.ts#L42)). **Other files:** flag lifecycle (set/rollback) is [DisputeManager](../disputeManager/DisputeManager.ts.md)'s.                                                                                                                                                                                                  | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                        | Obligation             | Public entry and setup                                                                                      | Oracle and forbidden effects                                                                                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-dispute-storage-1-82mb79"></a>`UNIT-TEST-DISPUTE-STORAGE-1-82MB79` | Confirmation retention | Store confirmation copies of one or several disputes with `SYNC` and `CHAIN_EVENT` origins in varied orders | The first copy is kept exactly; later copies never grow or change the stored co-signatures or signed dispute; only `CHAIN_EVENT` replaces `SYNC`; decode round-trips | <a id="unit-test-dispute-storage-1-82mb79.p3"></a>`UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P3` — duplicate confirmation no-op; <a id="unit-test-dispute-storage-1-82mb79.p4"></a>`UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P4` — decoded dispute matches; <a id="unit-test-dispute-storage-1-82mb79.p5"></a>`UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P5` — first copy stored with exactly its co-signatures; <a id="unit-test-dispute-storage-1-82mb79.p6"></a>`UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P6` — later `SYNC` copy with extra co-signatures ignored; <a id="unit-test-dispute-storage-1-82mb79.p7"></a>`UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P7` — repeated `SYNC` copies do not grow the stored set; <a id="unit-test-dispute-storage-1-82mb79.p8"></a>`UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P8` — `CHAIN_EVENT` copy replaces a stored `SYNC` copy; <a id="unit-test-dispute-storage-1-82mb79.p9"></a>`UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P9` — `SYNC` copy after a `CHAIN_EVENT` copy ignored; <a id="unit-test-dispute-storage-1-82mb79.p10"></a>`UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P10` — second `CHAIN_EVENT` copy keeps the first; <a id="unit-test-dispute-storage-1-82mb79.p11"></a>`UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P11` — different dispute hashes independent |
| <a id="unit-test-dispute-storage-2-94r6xv"></a>`UNIT-TEST-DISPUTE-STORAGE-2-94R6XV` | Fork flags             | Set/read flags across forks                                                                                 | Per-fork isolation; absent reads false                                                                                                                               | <a id="unit-test-dispute-storage-2-94r6xv.p1"></a>`UNIT-TEST-DISPUTE-STORAGE-2-94R6XV.P1` — set/read disputed flag; <a id="unit-test-dispute-storage-2-94r6xv.p2"></a>`UNIT-TEST-DISPUTE-STORAGE-2-94R6XV.P2` — per-fork isolation; <a id="unit-test-dispute-storage-2-94r6xv.p3"></a>`UNIT-TEST-DISPUTE-STORAGE-2-94R6XV.P3` — unset default; <a id="unit-test-dispute-storage-2-94r6xv.p4"></a>`UNIT-TEST-DISPUTE-STORAGE-2-94R6XV.P4` — set/read own-dispute flag                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Related source reports

- [DisputeManager](../disputeManager/DisputeManager.ts.md), [EventHandler](../eventHandlers/EventHandler.ts.md), [SpectateService](../rpc/network/services/spectate/SpectateService.ts.md) (writers), [ReductionManager](../stateManager/reduction/ReductionManager.ts.md) (reader).
