# AValidationStrategy.ts

> **Source:** [src/stateManager/validationStrategy/AValidationStrategy.ts](../../../../../../../src/stateManager/validationStrategy/AValidationStrategy.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-BLOCK-PIPE-3-WW2SB7` (Strategy-complete deviations)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7)

## UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR

Consequence profile

- Setup: Drive every hook in this context incl. impossible-context hooks
- Oracle: Each deviation maps to exactly the documented consequence; impossible hooks throw; keep-connection interpretation correct

- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P1` — authenticateBlockFailed hook
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P2` — impossible-context hooks
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P3` — keep-connection mapping
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P4` — wrongChannel hook
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P5` — channelNotOpened hook
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P6` — notAllSingersAreParticipants hook
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P7` — noNewSignaturesOnExistingBlock hook
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P8` — goodNewSignaturesOnExistingBlock hook
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P9` — blockAuthorIsNotParticipant hook
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P10` — doubleSignDetected hook
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P11` — invalidStateTransitionDetected hook
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P12` — forgedInboundMessageBlockDetected hook
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P13` — wrongGenesisDetected hook
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P14` — conflictingButNotLinkedBlockDetected hook
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P15` — blockForkIsDisputed hook
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P16` — blockIsNotNextAndIsInTheFuture hook
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P17` — blockIsNotLinkedAndIsNotFirstBlock hook
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P18` — prepareStateMachineForLeaderCheck hook
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P19` — objectiveInvalidTimestampDetected hook
- [ ] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P20` — subjectiveInvalidTimestampDetected hook
- [x] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P21` — normalization strips an unrecoverable confirmation and punishes only its supplier
- [x] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P22` — spectating normalization preserves valid confirmations after a malformed first value
- [x] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P23` — sourceless replay strips irrelevant malformed confirmations without transport punishment
- [x] `UNIT-TEST-AVALIDATION-STRATEGY-1-N6Z4YR.P24` — calldata strategy rejects the impossible confirmation-bearing shape
