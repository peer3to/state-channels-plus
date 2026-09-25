# BlockCalldataStorage.ts

> **Source:** [src/storage/BlockCalldataStorage.ts](../../../../../../src/storage/BlockCalldataStorage.ts)
>
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-CDSTORE-1-ECWBNY` (Coordinate-keyed calldata with exact matching)](../../../../specification/storage/calldata-and-timeouts.md#req-cdstore-1-ecwbny)

## UNIT-TEST-BLOCK-CALLDATA-STORAGE-1-7MKQEX

Keying and matching

- Setup: Store records; query by coordinates and by matching blocks with equal/unequal hashes
- Oracle: Coordinate reads exact; match only on hash equality; absent coordinates explicit

- [ ] `UNIT-TEST-BLOCK-CALLDATA-STORAGE-1-7MKQEX.P1` — store/read by coordinates
- [x] `UNIT-TEST-BLOCK-CALLDATA-STORAGE-1-7MKQEX.P2` — match equal hash
- [x] `UNIT-TEST-BLOCK-CALLDATA-STORAGE-1-7MKQEX.P3` — same coordinates different hash → no match
- [ ] `UNIT-TEST-BLOCK-CALLDATA-STORAGE-1-7MKQEX.P4` — absent coordinates
