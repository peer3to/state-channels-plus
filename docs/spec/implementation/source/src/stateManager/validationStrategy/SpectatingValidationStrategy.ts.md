# SpectatingValidationStrategy.ts

> **Source:** [src/stateManager/validationStrategy/SpectatingValidationStrategy.ts](../../../../../../../src/stateManager/validationStrategy/SpectatingValidationStrategy.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-BLOCK-PIPE-3-WW2SB7` (Strategy-complete deviations)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7)
- [`INV-SYNC-3-A7A2ED` (Fail-closed with caller-owned consequence)](../../../../../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed)
- [`REQ-BLOCK-PIPE-8-N529VH` (Evidence precedes escalation)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh)
- [`REQ-GOSSIP-3-HQZNQX` (Re-broadcast on growth)](../../../../../specification/peer-communication/block-gossip.md#req-gossip-3-hqznqx)
- [`REQ-MSG-9-BFN9P5` (Spectating MUST be fail-closed)](../../../../../specification/settlement/cross-layer-messages.md#req-msg-9-bfn9p5)

## UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH

Consequence profile

- Setup: Drive every hook in this context incl. impossible-context hooks
- Oracle: Each deviation maps to exactly the documented consequence; impossible hooks throw; keep-connection interpretation correct

- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P1` — authenticateBlockFailed hook
- [ ] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P2` — impossible-context hooks
- [ ] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P3` — keep-connection mapping
- [ ] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P4` — wrongChannel hook
- [ ] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P5` — channelNotOpened hook
- [ ] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P6` — notAllSingersAreParticipants hook
- [ ] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P7` — noNewSignaturesOnExistingBlock hook
- [ ] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P8` — goodNewSignaturesOnExistingBlock hook
- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P9` — blockAuthorIsNotParticipant hook
- [ ] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P10` — doubleSignDetected hook
- [ ] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P11` — invalidStateTransitionDetected hook
- [ ] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P12` — forgedInboundMessageBlockDetected hook
- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P13` — wrongGenesisDetected hook
- [ ] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P14` — conflictingButNotLinkedBlockDetected hook
- [ ] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P15` — blockForkIsDisputed hook
- [ ] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P16` — blockIsNotNextAndIsInTheFuture hook
- [ ] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P17` — blockIsNotLinkedAndIsNotFirstBlock hook
- [ ] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P18` — prepareStateMachineForLeaderCheck hook
- [ ] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P19` — objectiveInvalidTimestampDetected hook
- [ ] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P20` — subjectiveInvalidTimestampDetected hook
- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P21` — observer replay of a real double sign aborts without fraud evidence or a dispute request
- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P22` — committed replay of a real double sign stores fraud evidence and requests a dispute
- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P23` — the same late authentic block is refused live and accepted as synchronization history without a subjective warning
- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P24` — committed replay delegates a known-genesis fault and stores WrongGenesis evidence
- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P25` — committed replay delegates an invalid transition and requests a dispute
- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P26` — committed replay delegates an objective timestamp fault and stores InvalidTimestamp evidence
- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P27` — committed replay delegates a disputed-fork entry and discards it without requeueing or a dispute request
- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P28` — committed replay delegates a forged inbound block and stores evidence plus a dispute request
- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P29` — a pending peer replaying real double-sign fraud stores evidence, requests a dispute and stays pending
- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P30` — a synced observer aborts on a known-genesis fault without requesting a dispute
- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P31` — a synced observer aborts on an invalid transition without requesting a dispute
- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P32` — a synced observer aborts on an objective timestamp fault without requesting a dispute
- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P33` — a synced observer aborts on a forged inbound block without requesting a dispute
- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P34` — a synced observer discards a disputed-fork entry without requeueing, aborting or requesting a dispute
- [x] `UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P35` — spectating normalization preserves valid confirmations after a malformed first value
