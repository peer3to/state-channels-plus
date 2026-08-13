# DisputeFraudProofService.ts — Source Report

> **Source:** [src/stateManager/utils/DisputeFraudProofService.ts](../../../../../../../../src/stateManager/utils/DisputeFraudProofService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/dispute-pipeline.md](../../../../views/architecture/sdk/dispute-pipeline.md)

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

Builds dispute fraud proofs across the content and timeout families (invalid state proof/
structure/header, inbound-hash, slashes-subset, balance-invariant, not-latest-state, output,
reason, and the `Timeout*` set) — one per audited dispute, first failure wins.

## Key design decisions

1. **One proof per dispute** pairs with first-write-wins storage and the audit's stop-at-first rule.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                           |
| ------------ | ---------------------------------- |
| Inputs       | Audit failure context.             |
| Outputs      | Stored `DisputeFraudProofStruct`s. |
| Owned state  | None.                              |
| Side effects | DisputeFraudProofStorage writes.   |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                               | Specification IDs    |
| --------------------------------------------------------------------------------------------------------- | -------------------- |
| [DisputeFraudProofService.ts](../../../../../../../../src/stateManager/utils/DisputeFraudProofService.ts) | `REQ-DISPUTE-PIPE-5` |

## Assumptions, dependencies, trust boundaries, and limits

- Self-slashing types are preflighted by the auditor before submission ever happens.

## Specification adherence

- Kill evidence packaged for the canonical dispute-proof handlers (`REQ-DISPUTE-PIPE-5`).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence                                                                                                                                                                                        | Gap / divergence |
| ----------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `REQ-DISPUTE-PIPE-5`    | Covered               | **Here:** per-family construction. **Other files:** [DisputeValidationService](../DisputeValidationService.ts.md) decides; [DisputeManager](../../disputeManager/DisputeManager.ts.md) submits. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                  | Obligation       | Public entry and setup          | Oracle and forbidden effects                                      | Required permutations                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------- | ---------------- | ------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-dispute-fraud-proof-service-1"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1` | Family packaging | Build each family from fixtures | Each struct verifies under its canonical handler; one per dispute | <a id="unit-test-dispute-fraud-proof-service-1.p1"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1.P1` — each family; <a id="unit-test-dispute-fraud-proof-service-1.p2"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1.P2` — one-per-dispute discipline |

## Related source reports

- [DisputeFraudProofStorage](../../storage/DisputeFraudProofStorage.ts.md).
