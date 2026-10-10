# TimeoutStorage.ts

> **Source:** [src/storage/TimeoutStorage.ts](../../../../../../src/storage/TimeoutStorage.ts)

## Requirements

- [`REQ-TOSTORE-3-H0MH84` (Newest timeout candidate)](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-3-h0mh84)
- [`REQ-TOSTORE-2-WX7VMH` (Drop a refused candidate by identity)](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-2-wx7vmh)
- [`REQ-DISPUTE-PIPE-13-R2QJZN` (Time out only the next height)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-13-r2qjzn)

## UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD

Newest-candidate store and identity drop

- Setup: Store candidates per fork at a lower then a higher height, at the same height, and on two forks; drop by identity
- Oracle: The latest store is retained; forks independent; only the identical non-forced candidate is dropped

- [x] `UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P1` — a later store at a higher height replaces the lower one
- [x] `UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P2` — equal-height store refreshes the candidate
- [x] `UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P3` — per-fork isolation
- [x] `UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P4` — a drop naming the stored non-forced candidate removes it
- [x] `UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P5` — a forced candidate stored over the same slot survives the drop
- [x] `UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P6` — a drop naming another height leaves the candidate
- [x] `UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P7` — a drop naming another participant at the same height leaves the candidate
