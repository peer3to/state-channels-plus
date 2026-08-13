# DisputeValidationStrategy.ts — Source Report

> **Source:** [src/stateManager/validationStrategy/DisputeValidationStrategy.ts](../../../../../../../../src/stateManager/validationStrategy/DisputeValidationStrategy.ts) > **Status:** Authored — engineer verification pending.
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

The audit-replay context: live gates off, per-block pre-state positioning, deviations mapped to dispute fraud proofs (structure/author/apply classes), local-gap observations continue as valid, and a discovered double-sign stores ordinary evidence without aborting the replay.

## Key design decisions

1. **Kill only on canonical failure:** a local linkage gap alone must not kill an honest dispute — the canonical structure predicate decides ([`REQ-DISPUTE-PIPE-5-RZZB48`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48)).
2. **Replay survives discovered double-signs** (the dispute may still be honest); the proof is stored for separate enforcement.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                    |
| ------------ | ----------------------------------------------------------- |
| Inputs       | Deviation hook calls with block context.                    |
| Outputs      | Verdicts + context consequences.                            |
| Owned state  | None.                                                       |
| Side effects | Evidence storage, escalation, penalties, restores per hook. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                              | Specification IDs                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [DisputeValidationStrategy.ts](../../../../../../../../src/stateManager/validationStrategy/DisputeValidationStrategy.ts) | [`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7), [`REQ-DISPUTE-PIPE-5-RZZB48`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48) |

## Assumptions, dependencies, trust boundaries, and limits

- Hooks run under the caller's execution boundary; consequences must not assume otherwise.

## Specification adherence

- Context-complete consequence profile ([`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7)) — the replay deviation mapping.

## Specification contradictions

None demonstrated.

## Missing behavior

Fraud proofs discovered during replay are stored but not applied without opening a dispute (code TODO) — dispute-replay strategy only.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                                 | Implementation status | Evidence                                                                                                                                                                                               | Gap / divergence |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7) | Covered               | **Here:** the replay deviation mapping. **Other files:** verdict production in [ValidationService](../ValidationService.ts.md); base vocabulary in [AValidationStrategy](./AValidationStrategy.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                              | Obligation          | Public entry and setup                                          | Oracle and forbidden effects                                                                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-disputevalidation-strategy-1-4tztj6"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6` | Consequence profile | Drive every hook in this context incl. impossible-context hooks | Each deviation maps to exactly the documented consequence; impossible hooks throw; keep-connection interpretation correct | <a id="unit-test-disputevalidation-strategy-1-4tztj6.p1"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P1` — authenticateBlockFailed hook; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p2"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P2` — wrongChannel impossible hook; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p3"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P3` — keep-connection mapping; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p4"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P4` — notAllSingersAreParticipants hook; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p5"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P5` — noNewSignaturesOnExistingBlock hook; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p6"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P6` — goodNewSignaturesOnExistingBlock hook; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p7"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P7` — blockAuthorIsNotParticipant hook; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p8"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P8` — doubleSignDetected hook; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p9"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P9` — invalidStateTransitionDetected hook; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p10"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P10` — forgedInboundMessageBlockDetected hook; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p11"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P11` — wrongGenesisDetected hook; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p12"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P12` — conflictingButNotLinkedBlockDetected hook; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p13"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P13` — blockIsNotLinkedAndIsNotFirstBlock hook; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p14"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P14` — prepareStateMachineForLeaderCheck hook; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p15"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P15` — objectiveInvalidTimestampDetected hook; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p16"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P16` — subjectiveInvalidTimestampDetected hook; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p17"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P17` — channelNotOpened impossible hook; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p18"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P18` — blockForkIsDisputed impossible hook; <a id="unit-test-disputevalidation-strategy-1-4tztj6.p19"></a>`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P19` — blockIsNotNextAndIsInTheFuture impossible hook |

## Related source reports

- [ValidationService](../ValidationService.ts.md), [StateManager](../StateManager.ts.md), [FraudProofService](../utils/FraudProofService.ts.md).
