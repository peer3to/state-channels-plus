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

Dispute confirmations keyed by the hash of the encoded dispute, with monotone co-signature
merging, plus the per-fork disputed/own-dispute flags.

## Key design decisions

1. **Merge keeps the original signed dispute.** A repeated store set-unions co-signatures while
   the `signedDispute` itself is never replaced ([#L100](../../../../../../src/storage/DisputeStorage.ts#L100)) — evidence identity is immutable.
2. **Flags are explicit and default false.** `didIDispute` reads absent as `false`
   ([#L84](../../../../../../src/storage/DisputeStorage.ts#L84)) — local knowledge, never chain truth.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                     |
| ------------ | ------------------------------------------------------------ |
| Inputs       | Signed disputes / confirmations (optional hash); fork flags. |
| Outputs      | Confirmations and decoded disputes by hash; flags.           |
| Owned state  | `disputes`, `disputedForks`.                                 |
| Side effects | None.                                                        |

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

- Monotone, idempotent co-signature merge with immutable signed dispute ([`REQ-DSTORE-1-5AQYJX`](../../../../specification/storage/dispute-evidence.md#req-dstore-1-5aqyjx)).
- Explicit per-fork flags with absent-as-false ([`REQ-DSTORE-2-H1DAGX`](../../../../specification/storage/dispute-evidence.md#req-dstore-2-h1dagx)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                            | Implementation status | Evidence                                                                                                                                                                                                                                    | Gap / divergence |
| -------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-DSTORE-1-5AQYJX`](../../../../specification/storage/dispute-evidence.md#req-dstore-1-5aqyjx) | Covered               | **Here:** set-union merge, empty-set creation from a bare signed dispute ([#L34](../../../../../../src/storage/DisputeStorage.ts#L34), [#L100](../../../../../../src/storage/DisputeStorage.ts#L100)).                                      | None.            |
| [`REQ-DSTORE-2-H1DAGX`](../../../../specification/storage/dispute-evidence.md#req-dstore-2-h1dagx) | Covered               | **Here:** `storeDisputedFork`/`didIDispute` with false default ([#L47](../../../../../../src/storage/DisputeStorage.ts#L47)). **Other files:** flag lifecycle (set/rollback) is [DisputeManager](../disputeManager/DisputeManager.ts.md)'s. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                        | Obligation         | Public entry and setup                                                                   | Oracle and forbidden effects                                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-dispute-storage-1-82mb79"></a>`UNIT-TEST-DISPUTE-STORAGE-1-82MB79` | Confirmation merge | Store signed disputes and confirmations with overlapping signature sets in varied orders | Sets merge monotonically and idempotently; signed dispute unchanged; decode round-trips | <a id="unit-test-dispute-storage-1-82mb79.p1"></a>`UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P1` — bare signed dispute creates empty set; <a id="unit-test-dispute-storage-1-82mb79.p2"></a>`UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P2` — merge order permutations; <a id="unit-test-dispute-storage-1-82mb79.p3"></a>`UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P3` — duplicate confirmation no-op; <a id="unit-test-dispute-storage-1-82mb79.p4"></a>`UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P4` — decoded dispute matches |
| <a id="unit-test-dispute-storage-2-94r6xv"></a>`UNIT-TEST-DISPUTE-STORAGE-2-94R6XV` | Fork flags         | Set/read flags across forks                                                              | Per-fork isolation; absent reads false                                                  | <a id="unit-test-dispute-storage-2-94r6xv.p1"></a>`UNIT-TEST-DISPUTE-STORAGE-2-94R6XV.P1` — set/read disputed flag; <a id="unit-test-dispute-storage-2-94r6xv.p2"></a>`UNIT-TEST-DISPUTE-STORAGE-2-94R6XV.P2` — per-fork isolation; <a id="unit-test-dispute-storage-2-94r6xv.p3"></a>`UNIT-TEST-DISPUTE-STORAGE-2-94R6XV.P3` — unset default; <a id="unit-test-dispute-storage-2-94r6xv.p4"></a>`UNIT-TEST-DISPUTE-STORAGE-2-94R6XV.P4` — set/read own-dispute flag                                   |

## Related source reports

- [DisputeManager](../disputeManager/DisputeManager.ts.md), [EventHandler](../eventHandlers/EventHandler.ts.md) (writers), [ReductionManager](../stateManager/reduction/ReductionManager.ts.md) (reader).
