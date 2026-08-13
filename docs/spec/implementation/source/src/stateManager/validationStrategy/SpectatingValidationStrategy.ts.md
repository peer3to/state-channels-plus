# SpectatingValidationStrategy.ts — Source Report

> **Source:** [src/stateManager/validationStrategy/SpectatingValidationStrategy.ts](../../../../../../../src/stateManager/validationStrategy/SpectatingValidationStrategy.ts) > **Status:** Authored — engineer verification pending.
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

The spectator/pending-joiner context: same verdicts, but provable participant fraud aborts the whole spectate (fail-closed) while junk with nobody to slash only drops the sender — a DoS must never force an abort.

## Key design decisions

1. **The abort/drop split is the fail-closed rule:** provable fraud → stop following; unattributable junk → keep spectating ([`INV-SYNC-3-A7A2ED`](../../../../../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed) consumer side).

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

| Source file                                                                                                                 | Specification IDs                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [SpectatingValidationStrategy.ts](../../../../../../../src/stateManager/validationStrategy/SpectatingValidationStrategy.ts) | [`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7), [`INV-SYNC-3-A7A2ED`](../../../../../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed) |

## Assumptions, dependencies, trust boundaries, and limits

- Hooks run under the caller's execution boundary; consequences must not assume otherwise.

## Specification adherence

- Context-complete consequence profile ([`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7)) — the spectating consequence profile.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                                 | Implementation status | Evidence                                                                                                                                                                                                     | Gap / divergence |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7) | Covered               | **Here:** the spectating consequence profile. **Other files:** verdict production in [ValidationService](../ValidationService.ts.md); base vocabulary in [AValidationStrategy](./AValidationStrategy.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                                    | Obligation          | Public entry and setup                                          | Oracle and forbidden effects                                                                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH` | Consequence profile | Drive every hook in this context incl. impossible-context hooks | Each deviation maps to exactly the documented consequence; impossible hooks throw; keep-connection interpretation correct | <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p1"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P1` — authenticateBlockFailed hook; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p2"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P2` — impossible-context hooks; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p3"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P3` — keep-connection mapping; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p4"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P4` — wrongChannel hook; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p5"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P5` — channelNotOpened hook; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p6"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P6` — notAllSingersAreParticipants hook; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p7"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P7` — noNewSignaturesOnExistingBlock hook; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p8"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P8` — goodNewSignaturesOnExistingBlock hook; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p9"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P9` — blockAuthorIsNotParticipant hook; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p10"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P10` — doubleSignDetected hook; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p11"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P11` — invalidStateTransitionDetected hook; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p12"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P12` — forgedInboundMessageBlockDetected hook; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p13"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P13` — wrongGenesisDetected hook; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p14"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P14` — conflictingButNotLinkedBlockDetected hook; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p15"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P15` — blockForkIsDisputed hook; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p16"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P16` — blockIsNotNextAndIsInTheFuture hook; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p17"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P17` — blockIsNotLinkedAndIsNotFirstBlock hook; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p18"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P18` — prepareStateMachineForLeaderCheck hook; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p19"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P19` — objectiveInvalidTimestampDetected hook; <a id="unit-test-spectatingvalidation-strategy-1-ctd8ah.p20"></a>`UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P20` — subjectiveInvalidTimestampDetected hook |

## Related source reports

- [ValidationService](../ValidationService.ts.md), [StateManager](../StateManager.ts.md), [FraudProofService](../utils/FraudProofService.ts.md).
