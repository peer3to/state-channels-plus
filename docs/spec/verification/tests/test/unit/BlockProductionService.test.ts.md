# BlockProductionService.test.ts

Test file: [test/unit/BlockProductionService.test.ts](../../../../../../test/unit/BlockProductionService.test.ts)
Exercises: [BlockProductionService.ts](../../../../implementation/source/src/stateManager/block/BlockProductionService.ts.md)

## Overview

The suite drives local authoring through a live math-channel signer. It covers writer and channel
gates, inbound-message selection, timestamp adjustment, block linkage, and two local submissions
constructed for the same coordinate. The concurrency case holds the state mutex until both calls
are queued, then proves that only one block commits. The rollback case makes the writer's state
machine refuse a real pending top-up and checks that the failed candidate leaves the next writer,
the live VM state hash and the height unchanged, then authors once the refusal is lifted. The
post-commit case makes the writer's `leaveChannelService.onBlockCommitted` throw once, after the
block is stored: the candidate rejects with that error, the next height moves past the stored
block, and the live VM state hash equals the stored state hash, not the pre-assembly one. The
shutdown rollback case has the writer's refusal start the runtime's real stop mid-assembly; a
record-only wrapper counts local state writes and snapshot-assembly error logs after the stop began.
The candidate rejects with the refusal, both records stay empty, the height is unchanged, and a
state-mutex hold then enters, so the failed candidate released the mutex. The failed-restore case
repeats the refused top-up with a one-shot fault on the writer's next local state write and holds the
runtime abort it triggers: the candidate rejects with the refusal, the snapshot assembly logs exactly
one "failed to restore … aborting" error, one abort is held, the height is unchanged and a state-mutex
hold enters; once the abort is released the writer's `onAbort` fires. The parked-candidate case holds the runtime
disposal and the state mutex, parks a real `add(1)` behind the mutex, aborts the runtime for real and
then frees the mutex: the candidate rejects with "Channel participation stopped" and the height is
unchanged. The two skipped defensive cases
remain unassigned gaps.
Spectator spawns in this suite go through the shared `addSpectatorAuthoring` helper (`test/harness/JoinActions.test.ts.md`): the spawn runs unawaited while the named participants keep authoring, bounded by literal minimum and maximum block counts, so no spawn or promotion sits inside an idle authoring window.

## Tests

- `next-to-write → true; any other peer → false`: UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P1
- `no inbound message ever stored → empty`: UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P2
- `inbound arrived but not yet consumed → returned; once consumed → empty`: UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P3
- `own head above a missing inbound log → the block is produced with no inbound carry`: UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P4, REQ-MSGSTORE-1-6ME9D7.T2.P3
- `two same-peer submissions built for one height → only the winner authors`: INV-BLOCK-PIPE-1-1AB2ME.T1.P9, UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P5
- `a follower behind by the writer's parked block stamps a slot that was never its own → the candidate is dropped, nothing authored`: INV-BLOCK-PIPE-1-1AB2ME.T1.P10, UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P13
- `a reduction replaces the fork before the candidate takes the mutex → the candidate is dropped, nothing authored`: INV-BLOCK-PIPE-1-1AB2ME.T1.P11, UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P14
- `not my turn → throws instead of authoring`: UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P6
- `the state machine refuses a pending inbound message → throws, turn and VM state unchanged, the same writer authors once the inbound is processable`: UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P15, UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P11
- `a post-commit step throws once after the block is stored → throws, the block stays stored and the VM keeps the stored state`: UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P19, INV-BLOCK-PIPE-1-1AB2ME.T1.P7
- `the restore after a refused pending inbound message fails → the runtime aborts, the candidate rejects with its own error and the mutex is released`: UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P17, UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P13, INV-BLOCK-PIPE-1-1AB2ME.T1.P13
- `an assembly that fails after the runtime started stopping → restores nothing, logs no restore error, rejects with its own error and releases the mutex`: UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P16, UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P12
- `a candidate parked on the state mutex when the runtime aborts → rejects without authoring once the mutex frees`: UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P18, INV-BLOCK-PIPE-1-1AB2ME.T1.P14
- `connected but never synced → throws Channel not open`: UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P7
- `authored promptly → timestamp is the local clock, one second ahead`: UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P9
- `authored after the window closed → timestamp clamped back below the local clock`: UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P11
- `height 0 links to the fork genesis snapshot; height 1 links to block 0`: UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P12
