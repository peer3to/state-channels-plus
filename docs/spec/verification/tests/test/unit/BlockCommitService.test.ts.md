# BlockCommitService.test.ts

Test file: [test/unit/BlockCommitService.test.ts](../../../../../../test/unit/BlockCommitService.test.ts)
Exercises: [BlockCommitService.ts](../../../../implementation/source/src/stateManager/block/BlockCommitService.ts.md)

## Overview

The mapped pending-join case proves that a later ordinary committed block promotes a receipt-confirmed
`PENDING_PARTICIPANT` to `PARTICIPATING` and clears the recorded force-join height. This is later cooperative
progress, not a gate on the already completed targeted-connect result.

Because promotion happens after the connect result, the case assigns no pending-receipt permutation. The
related requirement is `REQ-TJOIN-3-DCZKS6`.
The signing-stop case stages participant 2 through the real sync decline: it applies a served
threshold-final block at its final height that consumes a later joiner's JOIN, so its own history
is the side chain. Its commit step then refuses to sign its latest stored block while peer 0's
signs the same block, and it holds no own dispute marker.
Spectator spawns in this suite go through the shared `addSpectatorAuthoring` helper (`test/harness/JoinActions.test.ts.md`): the spawn runs unawaited while the named participants keep authoring, bounded by literal minimum and maximum block counts, so no spawn or promotion sits inside an idle authoring window.

## Tests

- `a spectator commit persists state and calls success without signing or gossip`: UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P3
- `a commit inserting the spectator promotes it and signs and gossips once`: REQ-GOSSIP-3-HQZNQX.T1.P6, UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P4
- `dispute replay with a historical union preserves current off-chain eligibility`: UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P5
- `an ordinary block from a participant → signed`: none
- `a block authored by a blacklisted peer → not signed`: none
- `a SYNCED spectator → not signed`: none
- `a participant that joined after the block → outside its union, not signed`: none
- `a block posted on-chain → the next-to-write peer does not sign, others do`: none
- `a block on a fork where a synced proof showed this participant's own history to be the side chain → not signed; a peer without that stop signs it`: UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P10, REQ-SYNC-5-M7W6JX.T2.P4
- `a PENDING joiner's first committed block includes it → PARTICIPATING and the recorded forceJoin height cleared`: UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P1
- `a leaver relays its own leave block but nothing committed after it while its exit is pending`: UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P6, REQ-GOSSIP-3-HQZNQX.T1.P9
