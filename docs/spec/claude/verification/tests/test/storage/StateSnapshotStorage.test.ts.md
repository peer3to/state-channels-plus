# test/storage/StateSnapshotStorage.test.ts — Test Report

> **Test file:** [test/storage/StateSnapshotStorage.test.ts](../../../../../../../test/storage/StateSnapshotStorage.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateSnapshotStorage.ts](../../../../implementation/source/src/storage/StateSnapshotStorage.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives `StateSnapshotStorage` directly with factory snapshots, one rebuilt as genesis
(`forkId === snapshotDataHash`): stores under computed and caller-provided hashes round-trip
exactly (struct deep-equality), a genesis store auto-registers in the fork-id → genesis index,
reads of absent snapshot hashes and unregistered fork ids return `undefined`, and a non-genesis
snapshot never enters the genesis index. Repeated stores, a conflicting genesis registration for
a known fork id, and a single test covering absent keys on both indexes are not present, so the
idempotent-repeat, conflict-refusal, and bundled absent-keys permutations stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                          | Covers                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`StateSnapshotStorage > CREATE - storeStateSnapshot() > Auto-computed hash > should store snapshot with computed hash`](../../../../../../../test/storage/StateSnapshotStorage.test.ts#L27) (line 27)                                    | [`UNIT-TEST-STATE-SNAPSHOT-STORAGE-1.P1`](../../../../implementation/source/src/storage/StateSnapshotStorage.ts.md#unit-test-state-snapshot-storage-1.p1)                                                                                                             |
| [`StateSnapshotStorage > CREATE - storeStateSnapshot() > Auto-computed hash > should store genesis snapshot and auto-add to genesis mapping`](../../../../../../../test/storage/StateSnapshotStorage.test.ts#L37) (line 37)               | [`REQ-SNAPSTORE-1.T1.P1`](../../../../specification/storage/snapshots-and-states.md#req-snapstore-1-t1-p1), [`UNIT-TEST-STATE-SNAPSHOT-STORAGE-1.P2`](../../../../implementation/source/src/storage/StateSnapshotStorage.ts.md#unit-test-state-snapshot-storage-1.p2) |
| [`StateSnapshotStorage > CREATE - storeStateSnapshot() > Provided hash > should store snapshot with provided hash`](../../../../../../../test/storage/StateSnapshotStorage.test.ts#L58) (line 58)                                         | —                                                                                                                                                                                                                                                                     |
| [`StateSnapshotStorage > CREATE - storeStateSnapshot() > Provided hash > should store genesis snapshot with provided hash and auto-add to genesis mapping`](../../../../../../../test/storage/StateSnapshotStorage.test.ts#L71) (line 71) | —                                                                                                                                                                                                                                                                     |
| [`StateSnapshotStorage > READ operations > should get snapshot by hash`](../../../../../../../test/storage/StateSnapshotStorage.test.ts#L101) (line 101)                                                                                  | —                                                                                                                                                                                                                                                                     |
| [`StateSnapshotStorage > READ operations > should return undefined for non-existent snapshot hash`](../../../../../../../test/storage/StateSnapshotStorage.test.ts#L106) (line 106)                                                       | —                                                                                                                                                                                                                                                                     |
| [`StateSnapshotStorage > READ operations > should get genesis snapshot by forkId`](../../../../../../../test/storage/StateSnapshotStorage.test.ts#L112) (line 112)                                                                        | —                                                                                                                                                                                                                                                                     |
| [`StateSnapshotStorage > READ operations > should return undefined for non-existent genesis forkId`](../../../../../../../test/storage/StateSnapshotStorage.test.ts#L121) (line 121)                                                      | —                                                                                                                                                                                                                                                                     |
| [`StateSnapshotStorage > Genesis snapshot logic > should identify genesis snapshot correctly`](../../../../../../../test/storage/StateSnapshotStorage.test.ts#L129) (line 129)                                                            | —                                                                                                                                                                                                                                                                     |
| [`StateSnapshotStorage > Genesis snapshot logic > should not non-genesis snapshots in genesis mapping`](../../../../../../../test/storage/StateSnapshotStorage.test.ts#L134) (line 134)                                                   | [`UNIT-TEST-STATE-SNAPSHOT-STORAGE-1.P4`](../../../../implementation/source/src/storage/StateSnapshotStorage.ts.md#unit-test-state-snapshot-storage-1.p4)                                                                                                             |
