# test/e2e/E2E-ReductionManager.test.ts — Test Report

> **Test file:** [test/e2e/E2E-ReductionManager.test.ts](../../../../../../test/e2e/E2E-ReductionManager.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [ReductionManager.ts](../../../../implementation/source/src/stateManager/reduction/ReductionManager.ts.md), [ReductionExecutor.ts](../../../../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Drives ordinary (non-final) reduction submission outcomes on a real four-peer channel. The grouped
tests hold every peer's `reduction-*` timer tasks, provoke an invalid-state-transition dispute,
wait out the evidence period, then release the target peer's reduction with an injected contract
simulation error. The two benign race reverts (`RaceConditionDisputeAlreadyReduced`,
`RaceConditionBlockHeightTooOld`) must complete the installed reduction as success with the peer
`PARTICIPATING`; `RaceConditionReductionExpectationDoesntMatch` must abort fatally — status falls
to `OPENED`, the error surfaces as a host error and a detached error, and no completed reduction
is recorded. The two standalone empty-window cases are one line each: both hand the session
harness to `assertEmptyWindowRedispute` in `test/fixtures/EmptyWindowRedisputeStaging.ts`, which
holds the staging they share — a four-peer session whose dispute initiation is suppressed, a
tampered dispute that is killed automatically, a wait until the on-chain window holds no
commitments, and the target peer's reduction started by hand — and branches only on the
`"wins" | "losesRace"` outcome it is given. The winner posts its own replacement evidence: the
oracle is that the window's commitments become non-empty and that the peer's completed reduction
for the source fork equals its current fork, so the same reduction resumed to completion. The
loser's submission is armed to fail at send with the contract's
`RaceConditionDisputeEvidencePeriodExpired`, standing in for the peer that got there first; the
oracle is the pair `{ disposed, uploads }` read a full participant-timeout window after exactly
one upload was recorded — the runtime is not disposed and no second upload was attempted against
the closed window. That is the observable difference the containment makes: the refusal reaches
`ReductionManager.failCompletion`, which rejects the shared completion and calls
`StateManager.abort()`, so reverting the escalation to a bare `disputeManager.dispute(forkId)`
turns the losing case red while the winning case stays green. The losing case does not observe a
real winner's commitment re-driving the reduction — no other peer uploads in this staging — so it
is not evidence for that. Other oracles are completed-reduction and status queries, on-chain
window commitments, event spies, and quiesced host errors. Real concurrent multi-reducer races and
`ReductionManager`'s completion-mismatch fatal path are not exercised (simulation errors stand in
for the races), so those permutations stay unassigned.
Both empty-dispute-window cases run with `evidenceTime: 6` (owner-approved harness evidence floor, plan 30 item 7): the automatic kill and replacement evidence must both land inside one evidence period, which the three-second floor could not hold under gate load.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                            | Covers                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: ReductionManager > ordinary reduction submission outcomes > RaceConditionDisputeAlreadyReduced completes the installed reduction as success`](../../../../../../test/e2e/E2E-ReductionManager.test.ts#L29) (line 29) | [`REQ-DISPUTE-PIPE-4-3YVDSA.T1.P2`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa.t1.p2)                                                                                                                                                                                  |
| [`E2E: ReductionManager > ordinary reduction submission outcomes > RaceConditionBlockHeightTooOld completes the installed reduction as success`](../../../../../../test/e2e/E2E-ReductionManager.test.ts#L46) (line 46)     | [`REQ-DISPUTE-PIPE-4-3YVDSA.T1.P5`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa.t1.p5)                                                                                                                                                                                  |
| [`E2E: ReductionManager > ordinary reduction submission outcomes > RaceConditionReductionExpectationDoesntMatch aborts and rejects the operation`](../../../../../../test/e2e/E2E-ReductionManager.test.ts#L63) (line 63)   | [`INTEGRATION-TEST-DISPUTE-PIPE-1-BPTFY9.P4`](../../../../implementation/views/protocol/dispute-processing.md#integration-test-dispute-pipe-1-bptfy9.p4)                                                                                                                                                       |
| [`E2E: ReductionManager > an empty dispute set posts replacement evidence and resumes the same reduction`](../../../../../../test/e2e/E2E-ReductionManager.test.ts#L182) (line 182)                                         | [`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P3`](../../../../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md#unit-test-reduction-executor-1-dgad37.p3)                                                                                                                                    |
| [`E2E: ReductionManager > an empty dispute set whose replacement evidence loses the race leaves the reducer participating`](../../../../../../test/e2e/E2E-ReductionManager.test.ts#L186) (line 186)                        | [`REQ-DISPUTE-PIPE-6-6FZB9M.T1.P10`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m.t1.p10), [`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P19`](../../../../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md#unit-test-reduction-executor-1-dgad37.p19) |
| [`E2E: ReductionManager > dispute-window recovery defeated → the reduction defers, the peer is not evicted`](../../../../../../test/e2e/E2E-ReductionManager.test.ts#L88) (line 88)                                         | —                                                                                                                                                                                                                                                                                                              |
