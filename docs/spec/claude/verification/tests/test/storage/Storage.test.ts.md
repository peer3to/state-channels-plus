# test/storage/Storage.test.ts — Test Report

> **Test file:** [test/storage/Storage.test.ts](../../../../../../../test/storage/Storage.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [Storage.ts](../../../../implementation/source/src/storage/Storage.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite exercises the `Storage` facade's `getStateSnapshot` derived read over a fixture of one
genesis snapshot, one block-committed snapshot, and the block that commits it: negative heights
(−1 and a random negative) resolve the fork's genesis snapshot, height ≥ 0 joins through the
stored block to its committed snapshot, and a missing genesis, missing block, or wrong fork id
each return `undefined`; a final test shows that mutating a returned snapshot leaves the stored
copy untouched. The facade's bundled permutations — a full join for every derived read, each
missing link in one test, participant unions, and mutation of each returned object kind —
exceed what any single test here performs, so they stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                          | Covers                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [`Storage > getStateSnapshot > should return genesis state snapshot when height < 0`](../../../../../../../test/storage/Storage.test.ts#L67) (line 67)                    | [`REQ-SNAPSTORE-2.T1.P3`](../../../../specification/storage/snapshots-and-states.md#req-snapstore-2-t1-p3)                   |
| [`Storage > getStateSnapshot > should return genesis state snapshot when height is any negative number`](../../../../../../../test/storage/Storage.test.ts#L81) (line 81) | [`UNIT-TEST-STORAGE-FACADE-1.P3`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-1.p3) |
| [`Storage > getStateSnapshot > should return state snapshot from block when height >= 0`](../../../../../../../test/storage/Storage.test.ts#L96) (line 96)                | [`REQ-SNAPSTORE-2.T1.P1`](../../../../specification/storage/snapshots-and-states.md#req-snapstore-2-t1-p1)                   |
| [`Storage > getStateSnapshot > genesis snapshot doesn't exist`](../../../../../../../test/storage/Storage.test.ts#L108) (line 108)                                        | —                                                                                                                            |
| [`Storage > getStateSnapshot > block confirmation doesn't exist`](../../../../../../../test/storage/Storage.test.ts#L120) (line 120)                                      | —                                                                                                                            |
| [`Storage > getStateSnapshot > correct block height, wrong forkId`](../../../../../../../test/storage/Storage.test.ts#L129) (line 129)                                    | —                                                                                                                            |
| [`Storage > getStateSnapshot > modifying retrieved snapshot doesn't affect stored snapshot`](../../../../../../../test/storage/Storage.test.ts#L140) (line 140)           | —                                                                                                                            |
