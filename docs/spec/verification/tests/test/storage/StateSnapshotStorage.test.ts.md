# StateSnapshotStorage.test.ts

Test file: [test/storage/StateSnapshotStorage.test.ts](../../../../../../test/storage/StateSnapshotStorage.test.ts)
Exercises: [StateSnapshotStorage.ts](../../../../implementation/source/src/storage/StateSnapshotStorage.ts.md)

## Overview

The suite drives `StateSnapshotStorage` directly with factory snapshots, one rebuilt as genesis
(`forkId === snapshotDataHash`): stores under computed and caller-provided hashes round-trip
exactly (struct deep-equality), a genesis store auto-registers in the fork-id → genesis index,
reads of absent snapshot hashes and unregistered fork ids return `undefined`, and a non-genesis
snapshot never enters the genesis index. The atomized absent-key permutations are assigned per
index below. The conflict group registers a genesis, then stores an identical copy (index, hash read
and log unchanged) or a copy with a later timestamp under the same fork id: the index keeps the
first registration, the refused copy is still stored and returned under its own hash, and the
storage's real logger records exactly one warning naming both snapshot hashes. A genesis of another
fork id and a non-genesis snapshot of the registered fork leave the registered genesis unchanged.

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
- `keeps the registered genesis and logs nothing when the same genesis is stored again`: REQ-SNAPSTORE-1-AJW0HJ.T1.P2, INV-SNAPSTORE-1-DPHPJE.T1.P2, UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P3
- `refuses a conflicting genesis for a known fork id and keeps the original registered`: REQ-SNAPSTORE-1-AJW0HJ.T1.P3, UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P7
- `still stores a refused conflicting genesis under its hash`: REQ-SNAPSTORE-1-AJW0HJ.T1.P4, UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P8
- `logs one warning naming the registered and the refused genesis on a conflict`: REQ-SNAPSTORE-1-AJW0HJ.T1.P5, UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P9
- `registers a genesis for a different fork id next to an existing one`: UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P10
- `keeps the registered genesis when a non-genesis snapshot of the same fork is stored`: UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P11
