# FraudProofStorage.ts — Source Report

> **Source:** [src/storage/FraudProofStorage.ts](../../../../../../../src/storage/FraudProofStorage.ts) > **Status:** Authored — engineer verification pending.
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

Block-level fraud proofs keyed by the hash of the encoded proof, with a participant → proofs
index for construction-time lookup.

## Key design decisions

1. **Content addressing makes overwrite harmless.** Re-storing writes the same content under the
   same key; the participant index is set-backed and idempotent ([#L18](../../../../../../../src/storage/FraudProofStorage.ts#L18)).
2. **First-proof-per-participant lookup.** `getFraudProofForParticipant` returns one proof (set
   iteration order) — sufficient because any single valid proof slashes ([#L38](../../../../../../../src/storage/FraudProofStorage.ts#L38)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                  |
| ------------ | ----------------------------------------- |
| Inputs       | Fraud proofs.                             |
| Outputs      | Proof by hash; one proof per participant. |
| Owned state  | `fraudProofs`, `participantToProofs`.     |
| Side effects | None.                                     |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                   | Specification IDs                                                                                  |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [FraudProofStorage.ts](../../../../../../../src/storage/FraudProofStorage.ts) | [`REQ-DSTORE-3-ZNXSTM`](../../../../specification/storage/dispute-evidence.md#req-dstore-3-znxstm) |

## Assumptions, dependencies, trust boundaries, and limits

- Proof validity is established before storing (pipeline evidence rules); the store only preserves.
- In-memory medium for this protocol version: durability across restart is not yet provided; the
  target contract is [durability.md](../../../../specification/storage/durability.md).

## Specification adherence

- Content-addressed proofs with consistent participant index ([`REQ-DSTORE-3-ZNXSTM`](../../../../specification/storage/dispute-evidence.md#req-dstore-3-znxstm)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                            | Implementation status | Evidence                                                                                                                                                                                                                                           | Gap / divergence |
| -------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-DSTORE-3-ZNXSTM`](../../../../specification/storage/dispute-evidence.md#req-dstore-3-znxstm) | Covered               | **Here:** hash-keyed store + set-backed index ([#L18](../../../../../../../src/storage/FraudProofStorage.ts#L18)). **Other files:** [DisputeFraudProofStorage](./DisputeFraudProofStorage.ts.md) covers the dispute-proof half of the requirement. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                | Obligation      | Public entry and setup                                  | Oracle and forbidden effects                                                                             | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-fraud-proof-storage-1-xjahws"></a>`UNIT-TEST-FRAUD-PROOF-STORAGE-1-XJAHWS` | Store and index | Store proofs incl. repeats and multiple per participant | Round trips exact; repeats idempotent; index returns a stored proof for exactly the indexed participants | <a id="unit-test-fraud-proof-storage-1-xjahws.p1"></a>`UNIT-TEST-FRAUD-PROOF-STORAGE-1-XJAHWS.P1` — store/read by hash; <a id="unit-test-fraud-proof-storage-1-xjahws.p2"></a>`UNIT-TEST-FRAUD-PROOF-STORAGE-1-XJAHWS.P2` — repeat idempotent; <a id="unit-test-fraud-proof-storage-1-xjahws.p3"></a>`UNIT-TEST-FRAUD-PROOF-STORAGE-1-XJAHWS.P3` — multiple proofs one participant; <a id="unit-test-fraud-proof-storage-1-xjahws.p4"></a>`UNIT-TEST-FRAUD-PROOF-STORAGE-1-XJAHWS.P4` — unindexed participant absent |

## Related source reports

- [DisputeManager](../disputeManager/DisputeManager.ts.md) (folds proofs into submissions), [FraudProofService](../stateManager/utils/FraudProofService.ts.md) (producer).
