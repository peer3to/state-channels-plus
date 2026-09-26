# test/unit/ReductionExecutor.test.ts — Test Report

> **Test file:** [test/unit/ReductionExecutor.test.ts](../../../../../../test/unit/ReductionExecutor.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [ReductionExecutor.ts](../../../../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A single regression test for the reduction path's dispute-recovery gap: a dispute commitment can
land on-chain before the observer's `onDisputeCommitted` handler stores the struct, and
`tryReduce` firing in that gap used to throw "Missing Dispute in storage". The test runs a real
4-peer channel through the harness session, holds every reduction entry point and the observer's
incoming dispute-committed events, stages a genuine invalid-transition dispute from the other
peers, waits out the kill period, and then calls `reductionManager.tryReduce` by hand via
`execOnHost`. The oracles assert the staged gap is real (at least one on-chain window commitment
missing locally), that `tryReduce` recovers via `EventSyncService.ensureDisputesProcessed` instead
of throwing, that every commitment is stored afterwards, and — the substantive check — that
`getSyncedForkDisputes` hands reduction the complete on-chain window, not just the subset whose
events arrived; the released peers then complete the reduction for real. The other planned
executor permutations (concurrent convergence, empty-window escalation, supersession, provider
failure) are not exercised here and remain with the dispute e2e flows or unassigned.
The `no reduce data` reschedule case stages the lagging peer as peer 1: the staging's invalid block comes from the
next writer (peer 2), which the reduction slashes, so the lagging peer must be a different participant. Before
plan 30 the case passed with peer 2 as the lagging peer only because its aborted runtime kept reducing after
disposal.

The reduced-fork kill-period cases stage a disputed fork with every reduction timer held, let two reducers install the
reduced fork with their sends parked, and open a real self-removal dispute on the reduced fork from one of them. The
simulation case then drives a third reducer, whose bundled simulation hits the freeze; the send case releases a
parked send instead. Both assert the chain records the reduced fork while its snapshot hash is unchanged and the
reduced fork's kill period is still open, the simulating attempt settles with the reduced fork and no rejection,
and no host error remains after the parked sends meet the landed reduce.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                         | Covers                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Unit: ReductionExecutor > getSyncedForkDisputes > committed dispute missing locally → recovers via event replay, then reduces`](../../../../../../test/unit/ReductionExecutor.test.ts#L329) (line 329)                                                                 | [`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P2`](../../../../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md#unit-test-reduction-executor-1-dgad37.p2)                                                                                                                          |
| [`Unit: ReductionExecutor > reduce data unavailable > no reduce data → the attempt reschedules, the peer keeps participating, a later attempt completes`](../../../../../../test/unit/ReductionExecutor.test.ts#L17) (line 17)                                           | —                                                                                                                                                                                                                                                                                                    |
| [`Unit: ReductionExecutor > reduce data unavailable > someone else's reduction while the run is unavailable → not challenged, no throw`](../../../../../../test/unit/ReductionExecutor.test.ts#L104) (line 104)                                                          | —                                                                                                                                                                                                                                                                                                    |
| [`Unit: ReductionExecutor > dispute window unavailable > unreadable dispute window → the attempt defers instead of aborting`](../../../../../../test/unit/ReductionExecutor.test.ts#L190) (line 190)                                                                     | —                                                                                                                                                                                                                                                                                                    |
| [`Unit: ReductionExecutor > dispute window unavailable > a re-dispatched dispute log that fails again → failed attempt, not a fatal`](../../../../../../test/unit/ReductionExecutor.test.ts#L252) (line 252)                                                             | —                                                                                                                                                                                                                                                                                                    |
| [`Unit: ReductionExecutor > dispute window unavailable > unreadable dispute window → the reduction is not challenged`](../../../../../../test/unit/ReductionExecutor.test.ts#L291) (line 291)                                                                            | —                                                                                                                                                                                                                                                                                                    |
| [`Unit: ReductionExecutor > reduced fork already in its kill period > the simulation meets the reduced fork's open window → the reduce lands alone, the chain snapshot waits, no host errors`](../../../../../../test/unit/ReductionExecutor.test.ts#L439) (line 439)    | [`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P16`](../../../../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md#unit-test-reduction-executor-1-dgad37.p16), [`REQ-ENFSNAP-4-ESP98F.T1.P8`](../../../../specification/enforcement/snapshot-adoption.md#req-enfsnap-4-esp98f.t1.p8) |
| [`Unit: ReductionExecutor > reduced fork already in its kill period > the send meets the reduced fork's open window → the reduce is resubmitted alone, the chain snapshot waits, no host errors`](../../../../../../test/unit/ReductionExecutor.test.ts#L444) (line 444) | [`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P15`](../../../../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md#unit-test-reduction-executor-1-dgad37.p15)                                                                                                                        |
| [`Unit: ReductionExecutor > reduced fork already in its kill period > the refused send's outcome arrives after a channel reset → the reduce alone is not resubmitted for the channel left`](../../../../../../test/unit/ReductionExecutor.test.ts#L449) (line 449)       | [`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P18`](../../../../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md#unit-test-reduction-executor-1-dgad37.p18)                                                                                                                        |
