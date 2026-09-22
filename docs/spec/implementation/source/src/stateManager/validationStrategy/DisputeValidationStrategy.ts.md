# DisputeValidationStrategy.ts

> **Source:** [src/stateManager/validationStrategy/DisputeValidationStrategy.ts](../../../../../../../src/stateManager/validationStrategy/DisputeValidationStrategy.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md), [architecture/sdk/dispute-pipeline.md](../../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-BLOCK-PIPE-3-WW2SB7` (Strategy-complete deviations)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7)
  Missing: Fraud proofs discovered during replay are stored but not applied without opening a dispute (code TODO); dispute-replay strategy only.
- [`REQ-DISPUTE-PIPE-5-RZZB48` (Mirrored canonical audit)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48)

## UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6

Consequence profile

- Setup: Drive every hook in this context incl. impossible-context hooks
- Oracle: Each deviation maps to exactly the documented consequence; impossible hooks throw; keep-connection interpretation correct

- [ ] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P1` — authenticateBlockFailed hook
- [ ] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P2` — wrongChannel impossible hook
- [x] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P3` — keep-connection mapping
- [ ] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P4` — notAllSingersAreParticipants hook
- [ ] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P5` — noNewSignaturesOnExistingBlock hook
- [ ] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P6` — goodNewSignaturesOnExistingBlock hook
- [ ] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P7` — blockAuthorIsNotParticipant hook
- [ ] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P8` — doubleSignDetected hook
- [ ] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P9` — invalidStateTransitionDetected hook
- [ ] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P10` — forgedInboundMessageBlockDetected hook
- [ ] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P11` — wrongGenesisDetected hook
- [ ] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P12` — conflictingButNotLinkedBlockDetected hook
- [ ] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P13` — blockIsNotLinkedAndIsNotFirstBlock hook
- [x] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P14` — prepareStateMachineForLeaderCheck hook
- [ ] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P15` — objectiveInvalidTimestampDetected hook
- [ ] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P16` — subjectiveInvalidTimestampDetected hook
- [ ] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P17` — channelNotOpened impossible hook
- [ ] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P18` — blockForkIsDisputed impossible hook
- [ ] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P19` — blockIsNotNextAndIsInTheFuture impossible hook
- [x] `UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P20` — sourceless replay strips irrelevant malformed confirmations without transport punishment
