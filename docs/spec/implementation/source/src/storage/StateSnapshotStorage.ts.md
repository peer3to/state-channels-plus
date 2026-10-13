# StateSnapshotStorage.ts

> **Source:** [src/storage/StateSnapshotStorage.ts](../../../../../../src/storage/StateSnapshotStorage.ts)

## Requirements

- [`INV-SNAPSTORE-1-DPHPJE` (Content addressing)](../../../../specification/storage/snapshots-and-states.md#inv-snapstore-1-dphpje)
- [`REQ-SNAPSTORE-1-AJW0HJ` (Genesis index consistency)](../../../../specification/storage/snapshots-and-states.md#req-snapstore-1-ajw0hj)

## UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2

Content addressing and genesis index

- Setup: Store snapshots (genesis and not), repeat stores, store a conflicting genesis (same fork id, later timestamp) for a registered fork, store a later-height snapshot with the genesis data, query both indexes and the logger's store
- Oracle: Round trips exact; repeats idempotent; genesis index maps fork id to its first height-0 genesis only; a conflict is refused by the index, kept by hash and logged as one warning; absence explicit

- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P1` — round trip by hash
- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P2` — genesis registration and lookup
- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P3` — repeat store idempotent
- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P4` — non-genesis not indexed
- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P5` — absent snapshot hash
- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P6` — absent genesis fork id
- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P7` — conflicting genesis refused, first registration kept
- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P8` — refused genesis still stored by its hash
- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P9` — refusal logged as one warning naming both snapshots
- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P10` — genesis of another fork id registers alongside
- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P11` — non-genesis snapshot of a registered fork leaves its genesis unchanged
- [x] `UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P12` — later-height snapshot with the genesis data stored by hash only, index unchanged, no warning
