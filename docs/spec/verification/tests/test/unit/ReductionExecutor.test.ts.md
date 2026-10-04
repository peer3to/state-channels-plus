# test/unit/ReductionExecutor.test.ts — Test Report

> **Test file:** [test/unit/ReductionExecutor.test.ts](../../../../../../test/unit/ReductionExecutor.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [ReductionExecutor.ts](../../../../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite runs real channels through the harness session and drives the reduction attempt and the
reduced-result check host-side (`execOnHost`, `validation.probeDisputeReductionChallenge`).

- **Reduce data unavailable** — `stageDisputeOverHeldInboundGap` holds a lagging peer's inbound
  log handler over a committed dispute. Its reduced-result check of a random reduced fork does not
  throw, answers `true` (follow the chain) and sends no challenge; a peer that can rebuild the run
  answers `false` and challenges once, so the probe really observes challenges. The former
  "no reduce data → the attempt reschedules" case is gone: an auditing peer cannot store a dispute
  whose inbound run it lacks, because its audit throws first, so the executor's deferral branch
  has no test.
- **Dispute window unavailable** — `disputeWithSuppressedCommitEvents` holds the observer's
  dispute-committed events and reductions. After the kill period, with chain log queries failing,
  a hand-driven `tryReduce` does not throw, keeps the fork, keeps the peer `PARTICIPATING`,
  schedules `reduction-<forkId>` again and adds no on-chain window commitment; after the queries
  return, the next attempt moves the fork. A re-dispatched dispute log whose handler throws again
  ends as a failed attempt (no throw, peer `PARTICIPATING`, the handler really ran). With log
  queries failing, the reduced-result check answers `true` and sends no challenge.
- **Fork adoption after the reduce** — on `stageReducibleDisputedFork` only peer 0 reduces. With
  the first adopt-only post failing, the recorded sends hold `reduceAndFinalize` alone, never
  bundled with `updateStateSnapshotFork`, two adopt-only posts happen and the chain's snapshot
  ends on the reduced fork. With both posts failing, one `adoptReducedFork-` retry is scheduled,
  no third post follows, the injected failure surfaces as a detached error, the reduced result
  stays recorded and the chain snapshot stays on the source fork.
- **getSyncedForkDisputes** — the observer's dispute-committed events are held while a genuine
  invalid-transition dispute commits; after the kill period a hand-driven `tryReduce` recovers the
  missing commitments through `EventSyncService.ensureDisputesProcessed` instead of throwing
  "Missing Dispute in storage", every commitment is stored afterwards, and `getSyncedForkDisputes`
  returns the complete on-chain window; the released peers then complete the reduction.

Concurrent convergence, empty-window escalation, supersession and provider failure are not
exercised here and stay with the dispute e2e flows or unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                          | Covers                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Unit: ReductionExecutor > fork adoption after the reduce > the reduce lands alone and a failed adopt-only post is retried once → the chain adopts the reduced fork`](../../../../../../test/unit/ReductionExecutor.test.ts#L234) (line 234)             | [`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P17`](../../../../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md#unit-test-reduction-executor-1-dgad37.p17) |
| [`Unit: ReductionExecutor > fork adoption after the reduce > the adopt-only post and its one retry both fail → no third attempt, the failure surfaces, the reduce stays recorded`](../../../../../../test/unit/ReductionExecutor.test.ts#L277) (line 277) | [`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P18`](../../../../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md#unit-test-reduction-executor-1-dgad37.p18) |
| [`Unit: ReductionExecutor > getSyncedForkDisputes > committed dispute missing locally → recovers via event replay, then reduces`](../../../../../../test/unit/ReductionExecutor.test.ts#L335) (line 335)                                                  | [`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P2`](../../../../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md#unit-test-reduction-executor-1-dgad37.p2)   |
| [`Unit: ReductionExecutor > reduce data unavailable > someone else's reduction while the run is unavailable → not challenged, no throw`](../../../../../../test/unit/ReductionExecutor.test.ts#L14) (line 14)                                             | —                                                                                                                                                                             |
| [`Unit: ReductionExecutor > dispute window unavailable > unreadable dispute window → the attempt defers instead of aborting`](../../../../../../test/unit/ReductionExecutor.test.ts#L100) (line 100)                                                      | —                                                                                                                                                                             |
| [`Unit: ReductionExecutor > dispute window unavailable > a re-dispatched dispute log that fails again → failed attempt, not a fatal`](../../../../../../test/unit/ReductionExecutor.test.ts#L162) (line 162)                                              | —                                                                                                                                                                             |
| [`Unit: ReductionExecutor > dispute window unavailable > unreadable dispute window → the reduction is not challenged`](../../../../../../test/unit/ReductionExecutor.test.ts#L201) (line 201)                                                             | —                                                                                                                                                                             |
