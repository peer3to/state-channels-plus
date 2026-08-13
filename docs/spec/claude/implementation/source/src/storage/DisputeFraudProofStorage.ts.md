# DisputeFraudProofStorage.ts — Source Report

> **Source:** [src/storage/DisputeFraudProofStorage.ts](../../../../../../../src/storage/DisputeFraudProofStorage.ts) > **Status:** Authored — engineer verification pending.
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

Dispute fraud proofs keyed by the hash of the _disputed dispute's_ encoding — at most one
retained per dispute, explicit first-write-wins.

## Key design decisions

1. **First write wins, explicitly.** A second proof for the same dispute is dropped
   ([#L26](../../../../../../../src/storage/DisputeFraudProofStorage.ts#L26)) — pairing with the audit invariant that an invalid verdict stores exactly one proof.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                         |
| ------------ | -------------------------------- |
| Inputs       | Dispute fraud proofs.            |
| Outputs      | Proof for a dispute; all proofs. |
| Owned state  | `disputeFraudProofs`.            |
| Side effects | None.                            |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                 | Specification IDs                                                                                  |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [DisputeFraudProofStorage.ts](../../../../../../../src/storage/DisputeFraudProofStorage.ts) | [`REQ-DSTORE-3-ZNXSTM`](../../../../specification/storage/dispute-evidence.md#req-dstore-3-znxstm) |

## Assumptions, dependencies, trust boundaries, and limits

- One-proof-per-dispute pairs with the audit stopping at the first failing check.
- In-memory medium for this protocol version: durability across restart is not yet provided; the
  target contract is [durability.md](../../../../specification/storage/durability.md).

## Specification adherence

- Dispute-keyed, first-write-wins retention ([`REQ-DSTORE-3-ZNXSTM`](../../../../specification/storage/dispute-evidence.md#req-dstore-3-znxstm)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                            | Implementation status | Evidence                                                                                                                                                                                                                              | Gap / divergence |
| -------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-DSTORE-3-ZNXSTM`](../../../../specification/storage/dispute-evidence.md#req-dstore-3-znxstm) | Covered               | **Here:** dispute-hash keying with explicit first-write-wins ([#L26](../../../../../../../src/storage/DisputeFraudProofStorage.ts#L26)). **Other files:** [FraudProofStorage](./FraudProofStorage.ts.md) covers the block-proof half. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                                | Obligation                   | Public entry and setup                                                  | Oracle and forbidden effects                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-dispute-fraud-proof-storage-1-wfrdhk"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-STORAGE-1-WFRDHK` | First-write-wins per dispute | Store proofs for a dispute, then a different proof for the same dispute | First retained; second dropped; lookup by dispute exact | <a id="unit-test-dispute-fraud-proof-storage-1-wfrdhk.p1"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-STORAGE-1-WFRDHK.P1` — store/lookup; <a id="unit-test-dispute-fraud-proof-storage-1-wfrdhk.p2"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-STORAGE-1-WFRDHK.P2` — second write dropped; <a id="unit-test-dispute-fraud-proof-storage-1-wfrdhk.p3"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-STORAGE-1-WFRDHK.P3` — distinct disputes independent |

## Related source reports

- [DisputeValidationService](../stateManager/DisputeValidationService.ts.md) (producer), [DisputeManager](../disputeManager/DisputeManager.ts.md) (kill submitter).
