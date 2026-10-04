# test/unit/SnapshotAssemblyService.test.ts — Test Report

> **Test file:** [test/unit/SnapshotAssemblyService.test.ts](../../../../../../test/unit/SnapshotAssemblyService.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [SnapshotAssemblyService.ts](../../../../implementation/source/src/stateManager/block/SnapshotAssemblyService.ts.md).

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives `SnapshotAssemblyService` host-side on live harness channels through `execOnHost`
with real storage, real blocks, and the real local state machine. `createStateSnapshot` is
checked for carry-forward when no inbound or outbound block exists, for a real leave that
advances the outbound height and total withdrawals, and for a real join whose consumed inbound
block supplies the inbound hash, height, and total deposits. `getPreviousStateSnapshotOrThrow`
throws for an unknown fork. `assembleFromTransaction` is checked with the writer's real
transaction (a snapshot at the next height that binds the post-inbound state with no participant
changes), coordinates on a fork the stored history does not hold (the writer's real transaction
assembled from the passed previous snapshot succeeds and carries its inbound head and origin fork,
as a dispute replay of its own chain needs), the writer-turn rule (own turn succeeds with a new state hash; another peer's header
returns `success: false`), a transaction the state machine refuses, supplied pending inbound
blocks (their head and deposits bound), a leave (`participantChanges.left` names the leaver and
an outbound block is built), and an inbound block the state machine cannot process (the assembly
throws). Oracles are decoded snapshot fields, heights, hashes, and participant changes read from
the assembled result.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                              | Covers                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Unit: SnapshotAssemblyService > createStateSnapshot > no inbound, no outbound → previous snapshot data carried forward`](../../../../../../test/unit/SnapshotAssemblyService.test.ts#L14) (line 14)                                                         | [`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P1`](../../../../implementation/source/src/stateManager/block/SnapshotAssemblyService.ts.md#unit-test-snapshot-assembly-1-4g64j7.p1)   |
| [`Unit: SnapshotAssemblyService > createStateSnapshot > a real leave withdraws → outbound block height and total withdrawals both advance`](../../../../../../test/unit/SnapshotAssemblyService.test.ts#L55) (line 55)                                        | [`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P2`](../../../../implementation/source/src/stateManager/block/SnapshotAssemblyService.ts.md#unit-test-snapshot-assembly-1-4g64j7.p2)   |
| [`Unit: SnapshotAssemblyService > createStateSnapshot > a real join deposits → inbound hash, height and total deposits come from the consumed block`](../../../../../../test/unit/SnapshotAssemblyService.test.ts#L103) (line 103)                            | [`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P3`](../../../../implementation/source/src/stateManager/block/SnapshotAssemblyService.ts.md#unit-test-snapshot-assembly-1-4g64j7.p3)   |
| [`Unit: SnapshotAssemblyService > getPreviousStateSnapshotOrThrow > unknown fork → throws instead of assembling against nothing`](../../../../../../test/unit/SnapshotAssemblyService.test.ts#L148) (line 148)                                                | [`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P4`](../../../../implementation/source/src/stateManager/block/SnapshotAssemblyService.ts.md#unit-test-snapshot-assembly-1-4g64j7.p4)   |
| [`Unit: SnapshotAssemblyService > assembleFromTransaction > the writer's real transaction → snapshot at the next height binding the post-inbound state, no participant changes`](../../../../../../test/unit/SnapshotAssemblyService.test.ts#L172) (line 172) | [`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P5`](../../../../implementation/source/src/stateManager/block/SnapshotAssemblyService.ts.md#unit-test-snapshot-assembly-1-4g64j7.p5)   |
| [`Unit: SnapshotAssemblyService > assembleFromTransaction > coordinates the stored history does not hold (a dispute's own chain) → assembled from the passed previous snapshot`](../../../../../../test/unit/SnapshotAssemblyService.test.ts#L256) (line 256) | [`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P11`](../../../../implementation/source/src/stateManager/block/SnapshotAssemblyService.ts.md#unit-test-snapshot-assembly-1-4g64j7.p11) |
| [`Unit: SnapshotAssemblyService > assembleFromTransaction > writer's own turn → success and a new state hash; another peer's header → success false`](../../../../../../test/unit/SnapshotAssemblyService.test.ts#L335) (line 335)                            | [`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P6`](../../../../implementation/source/src/stateManager/block/SnapshotAssemblyService.ts.md#unit-test-snapshot-assembly-1-4g64j7.p6)   |
| [`Unit: SnapshotAssemblyService > assembleFromTransaction > a transaction the state machine refuses → { success: false } and nothing else computed`](../../../../../../test/unit/SnapshotAssemblyService.test.ts#L388) (line 388)                             | [`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P7`](../../../../implementation/source/src/stateManager/block/SnapshotAssemblyService.ts.md#unit-test-snapshot-assembly-1-4g64j7.p7)   |
| [`Unit: SnapshotAssemblyService > assembleFromTransaction > pending inbound blocks supplied → the snapshot binds their head and carries their deposits`](../../../../../../test/unit/SnapshotAssemblyService.test.ts#L451) (line 451)                         | [`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P8`](../../../../implementation/source/src/stateManager/block/SnapshotAssemblyService.ts.md#unit-test-snapshot-assembly-1-4g64j7.p8)   |
| [`Unit: SnapshotAssemblyService > assembleFromTransaction > a leave → participantChanges.left names the leaver and an outbound block is built`](../../../../../../test/unit/SnapshotAssemblyService.test.ts#L561) (line 561)                                  | [`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P9`](../../../../implementation/source/src/stateManager/block/SnapshotAssemblyService.ts.md#unit-test-snapshot-assembly-1-4g64j7.p9)   |
| [`Unit: SnapshotAssemblyService > assembleFromTransaction > an inbound block the state machine cannot process → the assembly throws`](../../../../../../test/unit/SnapshotAssemblyService.test.ts#L636) (line 636)                                            | [`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P10`](../../../../implementation/source/src/stateManager/block/SnapshotAssemblyService.ts.md#unit-test-snapshot-assembly-1-4g64j7.p10) |
