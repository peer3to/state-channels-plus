# test/storage/BlockCalldataStorage.test.ts — Test Report

> **Test file:** [test/storage/BlockCalldataStorage.test.ts](../../../../../../../test/storage/BlockCalldataStorage.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [BlockCalldataStorage.ts](../../../../implementation/source/src/storage/BlockCalldataStorage.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite instantiates `BlockCalldataStorage` directly, stores a single signed-block calldata
record with its on-chain timestamp, and asserts the exact-hash matching contract of
`getMatchingBlockCalldata`: the stored block gets its record (and timestamp) back, while a
competing block built from the same transaction and previous-block hash — same (fork, height,
author) coordinates, different content — gets `undefined`. Coordinate-keyed reads and queries
against absent coordinates are not exercised, so the store/read-by-coordinates and
absent-coordinates permutations stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                             | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`BlockCalldataStorage > returns calldata only for the exact signed block hash`](../../../../../../../test/storage/BlockCalldataStorage.test.ts#L7) (line 7) | [`REQ-CDSTORE-1.T1.P2`](../../../../specification/storage/calldata-and-timeouts.md#req-cdstore-1-t1-p2), [`REQ-CDSTORE-1.T1.P3`](../../../../specification/storage/calldata-and-timeouts.md#req-cdstore-1-t1-p3), [`UNIT-TEST-BLOCK-CALLDATA-STORAGE-1.P2`](../../../../implementation/source/src/storage/BlockCalldataStorage.ts.md#unit-test-block-calldata-storage-1.p2), [`UNIT-TEST-BLOCK-CALLDATA-STORAGE-1.P3`](../../../../implementation/source/src/storage/BlockCalldataStorage.ts.md#unit-test-block-calldata-storage-1.p3) |
