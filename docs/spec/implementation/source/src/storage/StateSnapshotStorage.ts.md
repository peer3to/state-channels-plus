# StateSnapshotStorage.ts

> **Source:** [src/storage/StateSnapshotStorage.ts](../../../../../../src/storage/StateSnapshotStorage.ts)

## Requirements

- [`INV-SNAPSTORE-1-DPHPJE` (Content addressing)](../../../../specification/storage/snapshots-and-states.md#inv-snapstore-1-dphpje)
- [`REQ-SNAPSTORE-1-AJW0HJ` (Genesis index consistency)](../../../../specification/storage/snapshots-and-states.md#req-snapstore-1-ajw0hj)
- [`REQ-PROOFSTORE-8-R38KY5` (History pruning)](../../../../specification/storage/proof-store.md#req-proofstore-8-r38ky5)

## UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2

Content addressing and genesis index

- Setup: Store snapshots (genesis and not), repeat stores, query both indexes
- Oracle: Round trips exact; repeats idempotent; genesis index maps fork id to its genesis only; absence explicit

- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P1` — round trip by hash
- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P2` — genesis registration and lookup
- [ ] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P3` — repeat store idempotent
- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P4` — non-genesis not indexed
- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P5` — absent snapshot hash
- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P6` — absent genesis fork id

## UNIT-TEST-STATE-SNAPSHOT-STORAGE-2-HXYQSW

Snapshot deletes keep the genesis unless the whole fork goes, and report the states they referenced.

- Setup: Store a fork genesis and snapshots 0..n of two forks; call `deleteSnapshotsBelow`, `deleteFork` and `getReferencedStateHashes` with excluded snapshots.
- Oracle: The held snapshots per height, the genesis index, and the returned state hashes.

- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-2-HXYQSW.P1` — `deleteSnapshotsBelow` height 2: the fork's snapshots 0 and 1 are gone and their state hashes returned; 2, 3, the fork genesis and another fork's snapshots stay
- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-2-HXYQSW.P2` — `deleteFork`: every snapshot of the fork, its genesis too, is gone and their state hashes returned; another fork's snapshots stay
- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-2-HXYQSW.P3` — `getReferencedStateHashes` with excluded snapshots: the state hashes of every other held snapshot, the genesis included
