# SnapshotAssemblyService.test.ts

Test file: [test/unit/SnapshotAssemblyService.test.ts](../../../../../../test/unit/SnapshotAssemblyService.test.ts)
Exercises: [SnapshotAssemblyService.ts](../../../../implementation/source/src/stateManager/block/SnapshotAssemblyService.ts.md).

## Overview

The suite drives `SnapshotAssemblyService` host-side on live harness channels through `execOnHost`
with real storage, real blocks, and the real local state machine. `createStateSnapshot` is
checked for carry-forward when no inbound or outbound block exists, for a real leave that
advances the outbound height and total withdrawals, and for a real join whose consumed inbound
block supplies the inbound hash, height, and total deposits. `getPreviousStateSnapshotOrThrow`
throws for an unknown fork. `assembleFromTransaction` is checked with the writer's real
transaction (a snapshot at the next height that binds the post-inbound state with no participant
changes), the writer-turn rule (own turn succeeds with a new state hash; another peer's header
returns `success: false`), a transaction the state machine refuses, supplied pending inbound
blocks (their head and deposits bound), a leave (`participantChanges.left` names the leaver and
an outbound block is built), and an inbound block the state machine cannot process (the assembly
throws). Oracles are decoded snapshot fields, heights, hashes, and participant changes read from
the assembled result.

## Tests

- `no inbound, no outbound → previous snapshot data carried forward`: UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P1
- `a real leave withdraws → outbound block height and total withdrawals both advance`: UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P2
- `a real join deposits → inbound hash, height and total deposits come from the consumed block`: UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P3
- `unknown fork → throws instead of assembling against nothing`: UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P4
- `the writer's real transaction → snapshot at the next height binding the post-inbound state, no participant changes`: UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P5
- `writer's own turn → success and a new state hash; another peer's header → success false`: UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P6
- `a transaction the state machine refuses → { success: false } and nothing else computed`: UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P7
- `pending inbound blocks supplied → the snapshot binds their head and carries their deposits`: UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P8
- `a leave → participantChanges.left names the leaver and an outbound block is built`: UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P9
- `an inbound block the state machine cannot process → the assembly throws`: UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P10
