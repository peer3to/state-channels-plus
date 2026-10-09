# Storage.test.ts

Test file: [test/storage/Storage.test.ts](../../../../../../test/storage/Storage.test.ts)
Exercises: [Storage.ts](../../../../implementation/source/src/storage/Storage.ts.md)

## Overview

The suite exercises the `Storage` facade's `getStateSnapshot` derived read over a fixture of one
genesis snapshot, one block-committed snapshot, and the block that commits it: negative heights
(−1 and a random negative) resolve the fork's genesis snapshot, height ≥ 0 joins through the
stored block to its committed snapshot, and a missing genesis, missing block, or wrong fork id
each return `undefined`; a final test shows that mutating a returned snapshot leaves the stored
copy untouched. The atomized per-read and per-missing-link permutations for `getStateSnapshot`
are assigned below; the facade permutations for derived reads this suite never calls
(previous-snapshot, participant unions, previous block-or-snapshot, relevant timestamps) and for
mutations of other returned object kinds stay unassigned.

## Tests

- `should return genesis state snapshot when height < 0`: REQ-SNAPSTORE-2-Q7E6TQ.T1.P3
- `should return genesis state snapshot when height is any negative number`: UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P3
- `should return state snapshot from block when height >= 0`: REQ-SNAPSTORE-2-Q7E6TQ.T1.P1, UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P1
- `genesis snapshot doesn't exist`: UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P12
- `block confirmation doesn't exist`: REQ-SNAPSTORE-2-Q7E6TQ.T1.P2, UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P2
- `correct block height, wrong forkId`: none
- `modifying retrieved snapshot doesn't affect stored snapshot`: UNIT-TEST-STORAGE-FACADE-2-KRDP9Q.P1
- `stored lookup equals direct computation with the same snapshots`: UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P16
- `unions overlapping snapshots and canonicalizes addresses without storing a result`: UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P17
- `preserves both sides of disjoint membership changes`: UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P18
- `accepts an absent previous snapshot`: UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P19
- `accepts an absent resulting snapshot`: UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P20
- `returns an empty union for absent or empty snapshots`: UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P21
