# BlockCommitService.test.ts

Test file: [test/unit/BlockCommitService.test.ts](../../../../../../test/unit/BlockCommitService.test.ts)
Exercises: [BlockCommitService.ts](../../../../implementation/source/src/stateManager/block/BlockCommitService.ts.md)

## Overview

The mapped pending-join case proves that a later ordinary committed block promotes a receipt-confirmed
`PENDING_PARTICIPANT` to `PARTICIPATING` and clears the recorded force-join height. This is later cooperative
progress, not a gate on the already completed targeted-connect result.

Because promotion happens after the connect result, the case assigns no pending-receipt permutation. The
related requirement is `REQ-TJOIN-3-DCZKS6`.
Spectator spawns in this suite go through the shared `addSpectatorAuthoring` helper (`test/harness/JoinActions.test.ts.md`): the spawn runs unawaited while the named participants keep authoring, bounded by literal minimum and maximum block counts, so no spawn or promotion sits inside an idle authoring window.

The genesis-index case opens a two-participant channel with a third peer present as a SYNCED
non-participant, crafts a block 0 by peer 0 that commits the genesis data at a later timestamp, and
commits it on that peer through the real `BlockCommitService.success` while a record-only stub counts
the snapshot storage's warnings: the result is stored under its hash, the registered genesis is
unchanged and no refusal is logged.

## Tests

- `a spectator commit persists state and calls success without signing or gossip`: UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P3
- `a commit inserting the spectator promotes it and signs and gossips once`: REQ-GOSSIP-3-HQZNQX.T1.P6, UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P4
- `dispute replay with a historical union preserves current off-chain eligibility`: UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P5
- `an ordinary block from a participant → signed`: none
- `a block authored by a blacklisted peer → not signed`: none
- `a SYNCED spectator → not signed`: none
- `a participant that joined after the block → outside its union, not signed`: none
- `a block posted on-chain → the next-to-write peer does not sign, others do`: none
- `a PENDING joiner's first committed block includes it → PARTICIPATING and the recorded forceJoin height cleared`: UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P1
- `a leaver relays its own leave block but nothing committed after it while its exit is pending`: UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P6, REQ-GOSSIP-3-HQZNQX.T1.P9
- `a committed block 0 that changes no state → its result stored by hash, the fork genesis stays registered and no refusal is logged`: REQ-SNAPSTORE-1-AJW0HJ.T2.P1, UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P10
