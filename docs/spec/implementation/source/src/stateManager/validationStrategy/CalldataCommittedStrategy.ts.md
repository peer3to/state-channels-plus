# CalldataCommittedStrategy.ts — Source Report

> **Source:** [src/stateManager/validationStrategy/CalldataCommittedStrategy.ts](../../../../../../../src/stateManager/validationStrategy/CalldataCommittedStrategy.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md)

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

The chain-observed context: delegates to the live strategy except authenticity failure, which is an objective fault by the on-chain poster; hooks presupposing extra signers throw as unreachable (the confirmation carries only the author's signature).

## Key design decisions

1. **Delegation keeps one consequence table** — only the poster-fault difference is local.

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

| Source file                                                                                                           | Specification IDs                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [CalldataCommittedStrategy.ts](../../../../../../../src/stateManager/validationStrategy/CalldataCommittedStrategy.ts) | [`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7) |

## Assumptions, dependencies, trust boundaries, and limits

- Hooks run under the caller's execution boundary; consequences must not assume otherwise.

## Specification adherence

- Context-complete consequence profile ([`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7)) — the calldata consequence delta.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                                 | Implementation status | Evidence                                                                                                                                                                                                 | Gap / divergence |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7) | Covered               | **Here:** the calldata consequence delta. **Other files:** verdict production in [ValidationService](../ValidationService.ts.md); base vocabulary in [AValidationStrategy](./AValidationStrategy.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                              | Obligation          | Public entry and setup                                          | Oracle and forbidden effects                                                                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-calldatacommitted-strategy-1-24k7dz"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ` | Consequence profile | Drive every hook in this context incl. impossible-context hooks | Each deviation maps to exactly the documented consequence; impossible hooks throw; keep-connection interpretation correct | <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p1"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P1` — authenticateBlockFailed hook; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p2"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P2` — wrongChannel impossible hook; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p3"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P3` — keep-connection mapping; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p4"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P4` — channelNotOpened hook; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p5"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P5` — noNewSignaturesOnExistingBlock hook; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p6"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P6` — doubleSignDetected hook; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p7"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P7` — invalidStateTransitionDetected hook; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p8"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P8` — forgedInboundMessageBlockDetected hook; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p9"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P9` — wrongGenesisDetected hook; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p10"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P10` — conflictingButNotLinkedBlockDetected hook; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p11"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P11` — blockForkIsDisputed hook; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p12"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P12` — blockIsNotNextAndIsInTheFuture hook; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p13"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P13` — blockIsNotLinkedAndIsNotFirstBlock hook; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p14"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P14` — prepareStateMachineForLeaderCheck hook; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p15"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P15` — objectiveInvalidTimestampDetected hook; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p16"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P16` — notAllSingersAreParticipants impossible hook; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p17"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P17` — goodNewSignaturesOnExistingBlock impossible hook; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p18"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P18` — blockAuthorIsNotParticipant impossible hook; <a id="unit-test-calldatacommitted-strategy-1-24k7dz.p19"></a>`UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P19` — subjectiveInvalidTimestampDetected impossible hook |

## Related source reports

- [ValidationService](../ValidationService.ts.md), [StateManager](../StateManager.ts.md), [FraudProofService](../utils/FraudProofService.ts.md).
