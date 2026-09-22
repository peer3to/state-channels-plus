# CalldataCommittedStrategy.ts

> **Source:** [src/stateManager/validationStrategy/CalldataCommittedStrategy.ts](../../../../../../../src/stateManager/validationStrategy/CalldataCommittedStrategy.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-BLOCK-PIPE-3-WW2SB7` (Strategy-complete deviations)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7)
  Missing: A calldata-authenticity failure returns DISPUTE but builds no fraud proof and opens no dispute (two code TODOs); the required proof type is unresolved. See [`OQ-22-99DDSZ` (Inauthentic on-chain calldata is not escalated)](../../../../open-questions.md#oq-22-99ddsz).

## UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ

Consequence profile

- Setup: Drive every hook in this context incl. impossible-context hooks
- Oracle: Each deviation maps to exactly the documented consequence; impossible hooks throw; keep-connection interpretation correct

- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P1` — authenticateBlockFailed hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P2` — wrongChannel impossible hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P3` — keep-connection mapping
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P4` — channelNotOpened hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P5` — noNewSignaturesOnExistingBlock hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P6` — doubleSignDetected hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P7` — invalidStateTransitionDetected hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P8` — forgedInboundMessageBlockDetected hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P9` — wrongGenesisDetected hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P10` — conflictingButNotLinkedBlockDetected hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P11` — blockForkIsDisputed hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P12` — blockIsNotNextAndIsInTheFuture hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P13` — blockIsNotLinkedAndIsNotFirstBlock hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P14` — prepareStateMachineForLeaderCheck hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P15` — objectiveInvalidTimestampDetected hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P16` — notAllSingersAreParticipants impossible hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P17` — goodNewSignaturesOnExistingBlock impossible hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P18` — blockAuthorIsNotParticipant impossible hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P19` — subjectiveInvalidTimestampDetected impossible hook
- [x] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P20` — calldata strategy rejects the impossible confirmation-bearing shape
