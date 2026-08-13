# DisputeValidationService.ts — Source Report

> **Source:** [src/stateManager/DisputeValidationService.ts](../../../../../../../src/stateManager/DisputeValidationService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

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

The auditor: the 17-check ordered audit (inbound-tip reality, proof decode with the unjudgeable
split, header match, block structure, posted-data verification vs final-anchor + local-anchor
availability, suffix replay through the pipeline, latest-state consistency, slash-subset with
chain re-check, balance invariant, disputer-latest-state, the five timeout checks with self-
slash preflight, stated reason, output correctness). Returns invalid iff exactly one dispute
fraud proof was stored.

## Key design decisions

1. **Every predicate with an on-chain twin runs by staticCall against the canonical logic** so the auditor can never disagree with the apply-handler (`REQ-DISPUTE-PIPE-5`).
2. **Unjudgeable-skipped-as-valid:** undecodable-without-posted-data and locally-unanchored disputes are abstained from, never killed on ignorance — honest-peer coverage carries them.
3. **Preflight before self-slashing proof types** (`validateTimeoutCalldataPostedProof.staticCall`) — an auditor never submits a proof that would slash itself.
4. **Stop at the first failure with exactly one stored proof;** invalid-without-proof throws as an internal error.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                    |
| ------------ | ------------------------------------------- |
| Inputs       | Dispute + optional auditing data.           |
| Outputs      | Valid/invalid verdict with stored evidence. |
| Owned state  | None.                                       |
| Side effects | Proof storage; replay through the pipeline. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                      | Specification IDs                                                |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [DisputeValidationService.ts](../../../../../../../src/stateManager/DisputeValidationService.ts) | `INV-DISPUTE-PIPE-1`, `REQ-DISPUTE-PIPE-2`, `REQ-DISPUTE-PIPE-5` |

## Assumptions, dependencies, trust boundaries, and limits

- Kill-window deadlines inherit chain-observation freshness; staleness-sensitive checks re-verify against the chain.

## Specification adherence

- Ordered complete verification with no later-step legitimization (`REQ-DISPUTE-PIPE-2`); auditor equivalence by construction (`INV-DISPUTE-PIPE-1`).

## Specification contradictions

None demonstrated.

## Missing behavior

The cross-audit race where calldata is posted after a kill decision (code TODO) remains an open sequencing question in the view.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence                                                                                                                                                                                                                                                      | Gap / divergence |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `REQ-DISPUTE-PIPE-5`    | Covered               | **Here:** mirrored predicates, one-proof rule, preflight, abstention. **Other files:** kill submission in [DisputeManager](../disputeManager/DisputeManager.ts.md); proof construction in [DisputeFraudProofService](./utils/DisputeFraudProofService.ts.md). | None.            |
| `REQ-DISPUTE-PIPE-2`    | Covered               | **Here:** the fixed 17-check order incl. replay.                                                                                                                                                                                                              | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                | Obligation                 | Public entry and setup                                                                                            | Oracle and forbidden effects                                                                                             | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-dispute-validation-service-1"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1` | Audit order and abstention | Corrupt each check alone; serve unjudgeable disputes; force local/chain predicate divergence; drive the preflight | First failure stores exactly one proof; abstention on unanchorable; canonical logic decides; preflight blocks self-slash | <a id="unit-test-dispute-validation-service-1.p1"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P1` — inbound-tip reality check failure; <a id="unit-test-dispute-validation-service-1.p2"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P2` — abstention on undecodable-without-posted-data; <a id="unit-test-dispute-validation-service-1.p3"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P3` — invalid-without-proof throws; <a id="unit-test-dispute-validation-service-1.p4"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P4` — preflight rejection; <a id="unit-test-dispute-validation-service-1.p5"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P5` — chain re-check on staleness-sensitive checks; <a id="unit-test-dispute-validation-service-1.p6"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P6` — proof-decode check failure; <a id="unit-test-dispute-validation-service-1.p7"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P7` — header-match check failure; <a id="unit-test-dispute-validation-service-1.p8"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P8` — block-structure check failure; <a id="unit-test-dispute-validation-service-1.p9"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P9` — posted-data verification check failure; <a id="unit-test-dispute-validation-service-1.p10"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P10` — suffix-replay check failure; <a id="unit-test-dispute-validation-service-1.p11"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P11` — latest-state consistency check failure; <a id="unit-test-dispute-validation-service-1.p12"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P12` — slash-subset check failure; <a id="unit-test-dispute-validation-service-1.p13"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P13` — balance-invariant check failure; <a id="unit-test-dispute-validation-service-1.p14"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P14` — disputer-latest-state check failure; <a id="unit-test-dispute-validation-service-1.p15"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P15` — timeout-not-linked check failure; <a id="unit-test-dispute-validation-service-1.p16"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P16` — timeout-participant-not-next check failure; <a id="unit-test-dispute-validation-service-1.p17"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P17` — timeout-too-early check failure; <a id="unit-test-dispute-validation-service-1.p18"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P18` — timeout-threshold check failure; <a id="unit-test-dispute-validation-service-1.p19"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P19` — timeout-calldata-posted check failure; <a id="unit-test-dispute-validation-service-1.p20"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P20` — stated-reason check failure; <a id="unit-test-dispute-validation-service-1.p21"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P21` — output-correctness check failure; <a id="unit-test-dispute-validation-service-1.p22"></a>`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P22` — abstention on locally-unanchored dispute |

## Related source reports

- [DisputeValidationStrategy](./validationStrategy/DisputeValidationStrategy.ts.md) (replay context), [DisputeFraudProofService](./utils/DisputeFraudProofService.ts.md), [EventHandler](../eventHandlers/EventHandler.ts.md) (caller).
