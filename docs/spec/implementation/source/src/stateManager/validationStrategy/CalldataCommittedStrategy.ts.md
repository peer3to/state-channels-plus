# CalldataCommittedStrategy.ts

> **Source:** [src/stateManager/validationStrategy/CalldataCommittedStrategy.ts](../../../../../../../src/stateManager/validationStrategy/CalldataCommittedStrategy.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-BLOCK-PIPE-3-WW2SB7` (Strategy-complete deviations)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7)
- [`REQ-DISPUTE-PIPE-12-F85KF2` (Force a timeout only over a rejected posted block)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-12-f85kf2)

## UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ

Consequence profile

- Setup: Drive every hook in this context incl. impossible-context hooks
- Oracle: Each deviation maps to exactly the documented consequence; the only impossible hook (subjective timing) throws; keep-connection interpretation correct

- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P1` — authenticateBlockFailed hook
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P2` — wrongChannel delegates the live consequence
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
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P15` — objectiveInvalidTimestampDetected hook
- [x] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P16` — notAllSingersAreParticipants delegates the live consequence for a merged gossip signature set
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P17` — goodNewSignaturesOnExistingBlock delegates: a merged copy's new signature is stored and re-gossiped
- [x] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P18` — blockAuthorIsNotParticipant delegates the live consequence
- [ ] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P19` — subjectiveInvalidTimestampDetected impossible hook
- [x] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P20` — calldata strategy strips a merged malformed confirmation as the live strategy does
- [x] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P21` — failed author authentication on posted calldata requests exactly one forced check for that author and height, with no delay
- [x] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P22` — a posted block not linked to the latest proved state requests a forced check and still applies the live linkage consequence
- [x] `UNIT-TEST-CALLDATACOMMITTED-STRATEGY-1-24K7DZ.P23` — a merged copy carrying a genuine new signature is stored and re-gossiped, as the live context does
