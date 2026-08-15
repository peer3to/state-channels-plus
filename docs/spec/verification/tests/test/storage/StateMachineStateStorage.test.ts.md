# test/storage/StateMachineStateStorage.test.ts — Test Report

> **Test file:** [test/storage/StateMachineStateStorage.test.ts](../../../../../../test/storage/StateMachineStateStorage.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateMachineStateStorage.ts](../../../../implementation/source/src/storage/StateMachineStateStorage.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite covers `StateMachineStateStorage` round trips — computed keccak key, caller-provided
key, and absent-key reads over random 64-byte payloads — and then, through the `Storage` facade,
the `getGenesisStateMachineState` derived read: a genesis snapshot linked to a stored encoded
state resolves to the exact bytes, while an unknown fork id or a genesis snapshot pointing at an
unstored state hash returns `undefined`. The atomized facade permutations for this derived read
(full join, missing encoded state) are assigned below; empty and large state payloads are not
exercised, and the unknown-fork read has no matching atomized permutation, so those stay
unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                               | Covers                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`StateMachineStateStorage > Basic operations > should store state with auto-computed hash`](../../../../../../test/storage/StateMachineStateStorage.test.ts#L22) (line 22)                                                                    | [`UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P1`](../../../../implementation/source/src/storage/StateMachineStateStorage.ts.md#unit-test-state-machine-state-storage-1-e4m0k6.p1), [`INV-SNAPSTORE-1-DPHPJE.T1.P4`](../../../../specification/storage/snapshots-and-states.md#inv-snapstore-1-dphpje.t1.p4) |
| [`StateMachineStateStorage > Basic operations > should store state with provided hash`](../../../../../../test/storage/StateMachineStateStorage.test.ts#L30) (line 30)                                                                         | [`UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P2`](../../../../implementation/source/src/storage/StateMachineStateStorage.ts.md#unit-test-state-machine-state-storage-1-e4m0k6.p2)                                                                                                                           |
| [`StateMachineStateStorage > Basic operations > should get state by hash`](../../../../../../test/storage/StateMachineStateStorage.test.ts#L41) (line 41)                                                                                      | —                                                                                                                                                                                                                                                                                                               |
| [`StateMachineStateStorage > Basic operations > should return undefined for non-existent hash`](../../../../../../test/storage/StateMachineStateStorage.test.ts#L47) (line 47)                                                                 | [`UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P3`](../../../../implementation/source/src/storage/StateMachineStateStorage.ts.md#unit-test-state-machine-state-storage-1-e4m0k6.p3)                                                                                                                           |
| [`StateMachineStateStorage > getGenesisStateMachineState > should return correct bytes for correct fork ID`](../../../../../../test/storage/StateMachineStateStorage.test.ts#L90) (line 90)                                                    | [`UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P6`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-1-tf3mz1.p6)                                                                                                                                                                      |
| [`StateMachineStateStorage > getGenesisStateMachineState > should return undefined for incorrect fork ID`](../../../../../../test/storage/StateMachineStateStorage.test.ts#L95) (line 95)                                                      | —                                                                                                                                                                                                                                                                                                               |
| [`StateMachineStateStorage > getGenesisStateMachineState > should return undefined when genesis snapshot exists but stateMachineStateHash is not in storage`](../../../../../../test/storage/StateMachineStateStorage.test.ts#L103) (line 103) | [`REQ-SNAPSTORE-2-Q7E6TQ.T1.P6`](../../../../specification/storage/snapshots-and-states.md#req-snapstore-2-q7e6tq.t1.p6), [`UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P13`](../../../../implementation/source/src/storage/Storage.ts.md#unit-test-storage-facade-1-tf3mz1.p13)                                          |
