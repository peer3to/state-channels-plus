# StateSnapshotStorage.ts

> **Source:** [src/storage/StateSnapshotStorage.ts](../../../../../../src/storage/StateSnapshotStorage.ts)
>
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`INV-SNAPSTORE-1-DPHPJE` (Content addressing)](../../../../specification/storage/snapshots-and-states.md#inv-snapstore-1-dphpje)
- [`REQ-SNAPSTORE-1-AJW0HJ` (Genesis index consistency)](../../../../specification/storage/snapshots-and-states.md#req-snapstore-1-ajw0hj)

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
