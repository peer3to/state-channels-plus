# ReductionExecutor.test.ts

Test file: [test/unit/ReductionExecutor.test.ts](../../../../../../test/unit/ReductionExecutor.test.ts)
Exercises: [ReductionExecutor.ts](../../../../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md)

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

Adoption-retry cases suppress unrelated writer timeout checks before releasing the reduction. The successor stays idle while adoption is deliberately failed and retried; no second timeout dispute changes the expected target fork. The exact chain fork and two-attempt assertions remain.

The failed re-dispatch case retains its event and reduction-timer holds until
harness disposal. This prevents late on-chain events from restarting a deferred
reduction during teardown; the failed-attempt and participation assertions remain
unchanged. Runtime verification of this cleanup adjustment is pending.

The out-of-gas resend case stages a reducible disputed fork, suppresses timeout checks, and
installs `underfundFirstReducePost` on the reducer: its first reduce multicall is sent with gas
for its calldata and little else, so it is mined and reverts out of gas, and later sends run for
real. After the reduction tasks are released, the test waits until the chain snapshot leaves the
source fork, asserts that the chain fork equals the reduced fork the chain records for the source
fork, and settles detached work, which fails the test on any rejected detached promise. It also reads
the recorded reduce receipts: their statuses are `[0, 1]`, so the first send was mined with a failure
and the resend was mined successfully. The adoption on the chain is the oracle that the executor
treated the mined resend as mined.

## Tests

- `no reduce data → the attempt reschedules, the peer keeps participating, a later attempt completes`: none
- `someone else's reduction while the run is unavailable → not challenged, no throw`: none
- `unreadable dispute window → the attempt defers instead of aborting`: none
- `a re-dispatched dispute log that fails again → failed attempt, not a fatal`: none
- `unreadable dispute window → the reduction is not challenged`: none
- `the reduce lands alone and a failed adopt-only post is retried once → the chain adopts the reduced fork`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P17
- `the reduce is mined out of gas and its resend lands → the reduced fork is adopted and nothing is reported as failed`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P19
- `the adopt-only post and its one retry both fail → no third attempt, the failure surfaces, the reduce stays recorded`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P18
- `committed dispute missing locally → recovers via event replay, then reduces`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P2
