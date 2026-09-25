# BlockValidationStrategy.ts

> **Source:** [src/stateManager/validationStrategy/BlockValidationStrategy.ts](../../../../../../../src/stateManager/validationStrategy/BlockValidationStrategy.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-BLOCK-PIPE-3-WW2SB7` (Strategy-complete deviations)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7)
- [`REQ-BLOCK-PIPE-8-N529VH` (Evidence precedes escalation)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh)
- [`REQ-DACK-3-J4Z33Y` (Knowledge-gated consequences)](../../../../../specification/peer-communication/dispute-acknowledgment.md#req-dack-3-j4z33y)
- [`REQ-GOSSIP-3-HQZNQX` (Re-broadcast on growth)](../../../../../specification/peer-communication/block-gossip.md#req-gossip-3-hqznqx)
- [`REQ-DISPUTE-PIPE-8-BVR8XV` (Dispute admission orders block signatures)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv)

## UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH

Consequence profile

- Setup: Drive every hook in this context incl. impossible-context hooks
- Oracle: Each deviation maps to exactly the documented consequence; impossible hooks throw; keep-connection interpretation correct

- [ ] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P1` — authenticateBlockFailed hook
- [ ] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P2` — impossible-context hooks
- [ ] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P3` — keep-connection mapping
- [x] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P4` — wrongChannel hook
- [x] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P5` — channelNotOpened hook
- [ ] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P6` — notAllSingersAreParticipants hook
- [ ] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P7` — noNewSignaturesOnExistingBlock hook
- [ ] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P8` — goodNewSignaturesOnExistingBlock hook
- [x] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P9` — blockAuthorIsNotParticipant hook
- [x] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P10` — doubleSignDetected hook
- [x] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P11` — invalidStateTransitionDetected hook
- [ ] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P12` — forgedInboundMessageBlockDetected hook
- [x] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P13` — wrongGenesisDetected hook
- [ ] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P14` — conflictingButNotLinkedBlockDetected hook
- [ ] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P15` — blockForkIsDisputed hook
- [x] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P16` — blockIsNotNextAndIsInTheFuture hook
- [ ] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P17` — blockIsNotLinkedAndIsNotFirstBlock hook
- [ ] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P18` — prepareStateMachineForLeaderCheck hook
- [x] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P19` — objectiveInvalidTimestampDetected hook
- [x] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P20` — subjectiveInvalidTimestampDetected hook
- [x] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P21` — a pending participant handling live double-sign fraud stores evidence, requests a dispute and stays pending
- [x] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P22` — live normalization without source attribution strips bad confirmations without blaming the author
- [x] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P23` — a malformed-only copy retains its author envelope and charges the rejected confirmation
- [x] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P24` — normalization strips an unrecoverable confirmation and punishes only its supplier
- [x] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P25` — shared malformed confirmation punishes both actual suppliers
- [x] `UNIT-TEST-BLOCKVALIDATION-STRATEGY-1-TXXZHH.P26` — duplicate malformed bytes use one charged slot and are removed once
