# FraudProofService.ts — Source Report

> **Source:** [src/stateManager/utils/FraudProofService.ts](../../../../../../../../src/stateManager/utils/FraudProofService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md), [architecture/sdk/dispute-pipeline.md](../../../../views/architecture/sdk/dispute-pipeline.md)

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

Builds block-level fraud proofs (double-sign, invalid transition with message-block context,
wrong genesis, invalid timestamp, forged inbound block) from validation deviations and stores
them for escalation.

## Key design decisions

1. **Proof structs mirror exactly what the enforcement handlers verify** — construction is packaging, never judgment (the mirrored predicate already judged).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                           |
| ------------ | ---------------------------------- |
| Inputs       | Deviation context from strategies. |
| Outputs      | Stored `FraudProofStruct`s.        |
| Owned state  | None.                              |
| Side effects | FraudProofStorage writes.          |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                 | Specification IDs  |
| ------------------------------------------------------------------------------------------- | ------------------ |
| [FraudProofService.ts](../../../../../../../../src/stateManager/utils/FraudProofService.ts) | `REQ-BLOCK-PIPE-8` |

## Assumptions, dependencies, trust boundaries, and limits

- Evidence-before-escalation ordering is the caller's (`REQ-BLOCK-PIPE-8`).

## Specification adherence

- Each proof type packaged for its on-chain twin.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence                                                                                  | Gap / divergence |
| ----------------------- | --------------------- | ----------------------------------------------------------------------------------------- | ---------------- |
| `REQ-BLOCK-PIPE-8`      | Covered               | **Here:** proof packaging per fault class. **Other files:** storage + escalation callers. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                  | Obligation      | Public entry and setup                        | Oracle and forbidden effects                                                        | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | --------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-fraud-proof-service-1"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1` | Proof packaging | Build each proof type from fixture deviations | Structs verify under the corresponding canonical handler; stored under content keys | <a id="unit-test-fraud-proof-service-1.p1"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1.P1` — double-sign proof round-trips through the mirrored handler; <a id="unit-test-fraud-proof-service-1.p2"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1.P2` — invalid-transition proof round-trips through the mirrored handler; <a id="unit-test-fraud-proof-service-1.p3"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1.P3` — wrong-genesis proof round-trips through the mirrored handler; <a id="unit-test-fraud-proof-service-1.p4"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1.P4` — invalid-timestamp proof round-trips through the mirrored handler; <a id="unit-test-fraud-proof-service-1.p5"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1.P5` — forged-inbound-block proof round-trips through the mirrored handler |

## Related source reports

- [FraudProofStorage](../../storage/FraudProofStorage.ts.md), [BlockValidationStrategy](../validationStrategy/BlockValidationStrategy.ts.md).
