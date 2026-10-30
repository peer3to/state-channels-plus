# StateSnapshotStorage.test.ts

Test file: [test/storage/StateSnapshotStorage.test.ts](../../../../../../test/storage/StateSnapshotStorage.test.ts)
Exercises: [StateSnapshotStorage.ts](../../../../implementation/source/src/storage/StateSnapshotStorage.ts.md)

## Overview

The suite drives `StateSnapshotStorage` directly with factory snapshots, one rebuilt as genesis
(`forkId === snapshotDataHash`): stores under computed and caller-provided hashes round-trip
exactly (struct deep-equality), a genesis store auto-registers in the fork-id → genesis index,
reads of absent snapshot hashes and unregistered fork ids return `undefined`, and a non-genesis
snapshot never enters the genesis index. The atomized absent-key permutations are assigned per
index below; repeated stores and a conflicting genesis registration for a known fork id are not
present, so the idempotent-repeat and conflict-refusal permutations stay unassigned.

## Tests

- `should store snapshot with computed hash`: UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P1, INV-SNAPSTORE-1-DPHPJE.T1.P1
- `should store genesis snapshot and auto-add to genesis mapping`: REQ-SNAPSTORE-1-AJW0HJ.T1.P1, UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P2
- `should store snapshot with provided hash`: none
- `should store genesis snapshot with provided hash and auto-add to genesis mapping`: none
- `should get snapshot by hash`: none
- `should return undefined for non-existent snapshot hash`: INV-SNAPSTORE-1-DPHPJE.T1.P3, UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P5
- `should get genesis snapshot by forkId`: none
- `should return undefined for non-existent genesis forkId`: UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P6
- `should identify genesis snapshot correctly`: none
- `should not non-genesis snapshots in genesis mapping`: UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P4
