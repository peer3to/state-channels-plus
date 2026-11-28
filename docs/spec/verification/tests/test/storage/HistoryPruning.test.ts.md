# HistoryPruning.test.ts

Test file: [test/storage/HistoryPruning.test.ts](../../../../../../test/storage/HistoryPruning.test.ts)
Exercises: [Storage.ts](../../../../implementation/source/src/storage/Storage.ts.md)

## Overview

The suite builds a real `Storage` and stores one or two fork histories through the real stores
(`PruningStaging.storeForkHistory`): a fork genesis with its state and blocks 0..n, each with its
own snapshot, state and change point; some cases let two heights, a height and the genesis, or a
second fork's genesis share one state. It then calls each store's new delete and the three
`Storage` prune operations, and asserts the returned counts or hashes and, per height, which blocks,
snapshots, states and change points stay. Two cases read `getPreviousRelevantTimestamp` after
`pruneSkippedHistory`: at the final point (its block below deleted) and right above it (the
final-point block held).

## Tests

- `deleteBlocksInRange of heights 1..2 of blocks 0..3 → exactly those blocks are gone, their snapshot hashes are returned, the latest height stays 3`: UNIT-TEST-BLOCK-STORAGE-33-1C8V5X.P1
- `deleteFork → every block of the fork is gone, also one stored above its head, its latest height is -1, and another fork's blocks stay`: UNIT-TEST-BLOCK-STORAGE-33-1C8V5X.P2
- `deleteSnapshotsBelow height 2 → the fork's snapshots 0 and 1 are gone and their state hashes returned; 2, 3, the fork genesis and another fork's snapshots stay`: UNIT-TEST-STATE-SNAPSHOT-STORAGE-2-HXYQSW.P1
- `deleteFork → every snapshot of the fork, its genesis too, is gone and their state hashes returned; another fork's snapshots stay`: UNIT-TEST-STATE-SNAPSHOT-STORAGE-2-HXYQSW.P2
- `getReferencedStateHashes with excluded snapshots → the state hashes of every other held snapshot, the genesis included`: UNIT-TEST-STATE-SNAPSHOT-STORAGE-2-HXYQSW.P3
- `deleteStateMachineState → true and the state is gone; a second delete is false; other states stay`: UNIT-TEST-STATE-MACHINE-STATE-STORAGE-2-9YS74X.P1
- `deleteChangePointsBelow height 2 → 2 deleted, the points at 2 and 3 and another fork's points stay`: UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-2-ZRP0DK.P1
- `deleteFork → every change point of the fork is gone and counted; another fork's points stay`: UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-2-ZRP0DK.P2
- `anchor 0 and final point 3 over blocks 0..4 → blocks and states 1 and 2 are gone; their snapshots, the anchor and final-point blocks, the tail and the change points stay`: UNIT-TEST-STORAGE-FACADE-3-5EA2ND.P1
- `an anchor at the fork genesis (-1) → block 0 is skipped history too`: UNIT-TEST-STORAGE-FACADE-3-5EA2ND.P2
- `a skipped block whose state is also the final point's → that shared state stays, the other skipped state is gone`: UNIT-TEST-STORAGE-FACADE-3-5EA2ND.P3
- `a final point right above the anchor → nothing is skipped, nothing is deleted`: UNIT-TEST-STORAGE-FACADE-3-5EA2ND.P4
- `the block below a final point pruned as skipped history → undefined`: UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P22
- `the final-point block kept below the next height → that block's timestamp`: UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P23
- `anchor 2 over blocks 0..4 → blocks, snapshots, states and change points 0 and 1 are gone; the anchor block, its snapshot and state, the blocks above and the fork genesis with its state stay`: UNIT-TEST-STORAGE-FACADE-3-5EA2ND.P5
- `a pruned block whose state is also the fork genesis state → the genesis state stays`: UNIT-TEST-STORAGE-FACADE-3-5EA2ND.P6
- `an anchor at height 0 → nothing is below it, nothing is deleted`: UNIT-TEST-STORAGE-FACADE-3-5EA2ND.P7
- `a left fork → its blocks, snapshots (the genesis too), states and change points are gone; a state the next fork's genesis also holds stays, and the next fork is untouched`: UNIT-TEST-STORAGE-FACADE-3-5EA2ND.P8
