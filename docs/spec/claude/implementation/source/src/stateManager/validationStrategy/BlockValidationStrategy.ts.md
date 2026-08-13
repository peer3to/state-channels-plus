# BlockValidationStrategy.ts — Source Report

> **Source:** [src/stateManager/validationStrategy/BlockValidationStrategy.ts](../../../../../../../../src/stateManager/validationStrategy/BlockValidationStrategy.ts) > **Status:** Authored — engineer verification pending.
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

The live-participant context: objective faults build fraud evidence and escalate; unattributable junk disconnects/excludes suppliers; not-ready situations restore to the queue; re-broadcast on good new signatures; dead-fork blocks from recorded acknowledgers lose straggler tolerance.

## Key design decisions

1. **Evidence-before-escalation is enforced here:** every DISPUTE verdict stores the proof via the fraud-proof service, then calls `dispute(forkId)` (REQ-BLOCK-PIPE-8).
2. **Acknowledgment-gated tolerance** consumes the dispute-ack records (REQ-DACK-3).

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

| Source file                                                                                                          | Specification IDs                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [BlockValidationStrategy.ts](../../../../../../../../src/stateManager/validationStrategy/BlockValidationStrategy.ts) | `REQ-BLOCK-PIPE-3`, `REQ-BLOCK-PIPE-8`, [`REQ-DACK-3`](../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-3) |

## Assumptions, dependencies, trust boundaries, and limits

- Hooks run under the caller's execution boundary; consequences must not assume otherwise.

## Specification adherence

- Context-complete consequence profile (`REQ-BLOCK-PIPE-3`) — the live consequence profile.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence                                                                                                                                                                                               | Gap / divergence |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `REQ-BLOCK-PIPE-3`      | Covered               | **Here:** the live consequence profile. **Other files:** verdict production in [ValidationService](../ValidationService.ts.md); base vocabulary in [AValidationStrategy](./AValidationStrategy.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                            | Obligation          | Public entry and setup                                          | Oracle and forbidden effects                                                                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-blockvalidation-strategy-1"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1` | Consequence profile | Drive every hook in this context incl. impossible-context hooks | Each deviation maps to exactly the documented consequence; impossible hooks throw; keep-connection interpretation correct | <a id="unit-test-blockvalidation-strategy-1.p1"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P1` — authenticateBlockFailed hook; <a id="unit-test-blockvalidation-strategy-1.p2"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P2` — impossible-context hooks; <a id="unit-test-blockvalidation-strategy-1.p3"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P3` — keep-connection mapping; <a id="unit-test-blockvalidation-strategy-1.p4"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P4` — wrongChannel hook; <a id="unit-test-blockvalidation-strategy-1.p5"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P5` — channelNotOpened hook; <a id="unit-test-blockvalidation-strategy-1.p6"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P6` — notAllSingersAreParticipants hook; <a id="unit-test-blockvalidation-strategy-1.p7"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P7` — noNewSignaturesOnExistingBlock hook; <a id="unit-test-blockvalidation-strategy-1.p8"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P8` — goodNewSignaturesOnExistingBlock hook; <a id="unit-test-blockvalidation-strategy-1.p9"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P9` — blockAuthorIsNotParticipant hook; <a id="unit-test-blockvalidation-strategy-1.p10"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P10` — doubleSignDetected hook; <a id="unit-test-blockvalidation-strategy-1.p11"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P11` — invalidStateTransitionDetected hook; <a id="unit-test-blockvalidation-strategy-1.p12"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P12` — forgedInboundMessageBlockDetected hook; <a id="unit-test-blockvalidation-strategy-1.p13"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P13` — wrongGenesisDetected hook; <a id="unit-test-blockvalidation-strategy-1.p14"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P14` — conflictingButNotLinkedBlockDetected hook; <a id="unit-test-blockvalidation-strategy-1.p15"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P15` — blockForkIsDisputed hook; <a id="unit-test-blockvalidation-strategy-1.p16"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P16` — blockIsNotNextAndIsInTheFuture hook; <a id="unit-test-blockvalidation-strategy-1.p17"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P17` — blockIsNotLinkedAndIsNotFirstBlock hook; <a id="unit-test-blockvalidation-strategy-1.p18"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P18` — prepareStateMachineForLeaderCheck hook; <a id="unit-test-blockvalidation-strategy-1.p19"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P19` — objectiveInvalidTimestampDetected hook; <a id="unit-test-blockvalidation-strategy-1.p20"></a>`UNIT-TEST-BLOCKVALIDATION-STRATEGY-1.P20` — subjectiveInvalidTimestampDetected hook |

## Related source reports

- [ValidationService](../ValidationService.ts.md), [StateManager](../StateManager.ts.md), [FraudProofService](../utils/FraudProofService.ts.md).
