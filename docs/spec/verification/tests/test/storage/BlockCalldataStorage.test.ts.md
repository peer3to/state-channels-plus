# BlockCalldataStorage.test.ts

Test file: [test/storage/BlockCalldataStorage.test.ts](../../../../../../test/storage/BlockCalldataStorage.test.ts)
Exercises: [BlockCalldataStorage.ts](../../../../implementation/source/src/storage/BlockCalldataStorage.ts.md)

## Overview

The suite instantiates `BlockCalldataStorage` directly, stores a single signed-block calldata
record with its on-chain timestamp, and asserts the exact-hash matching contract of
`getMatchingBlockCalldata`: the stored block gets its record (and timestamp) back, while a
competing block built from the same transaction and previous-block hash — same (fork, height,
author) coordinates, different content — gets `undefined`. Coordinate-keyed reads and queries
against absent coordinates are not exercised, so the store/read-by-coordinates and
absent-coordinates permutations stay unassigned.

## Tests

- `returns calldata only for the exact signed block hash`: REQ-CDSTORE-1-ECWBNY.T1.P2, REQ-CDSTORE-1-ECWBNY.T1.P3, UNIT-TEST-BLOCK-CALLDATA-STORAGE-1-7MKQEX.P2, UNIT-TEST-BLOCK-CALLDATA-STORAGE-1-7MKQEX.P3
