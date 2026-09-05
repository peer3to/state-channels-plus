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
is recorded. The standalone test empties the on-chain dispute window by killing a tampered
dispute, then shows `startReduction` posts the peer's own replacement evidence and resumes the
same reduction to completion. Oracles are completed-reduction and status queries, on-chain window
commitments, event spies, and quiesced host errors. Real concurrent multi-reducer races and
`ReductionManager`'s completion-mismatch fatal path are not exercised (simulation errors stand in
for the races), so those permutations stay unassigned.
The empty-dispute-window case runs with `evidenceTime: 6` (owner-approved harness evidence floor, plan 30 item 7): the automatic kill and replacement evidence must both land inside one evidence period, which the three-second floor could not hold under gate load.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                            | Covers                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: ReductionManager > ordinary reduction submission outcomes > RaceConditionDisputeAlreadyReduced completes the installed reduction as success`](../../../../../../test/e2e/E2E-ReductionManager.test.ts#L28) (line 28) | [`REQ-DISPUTE-PIPE-4-3YVDSA.T1.P2`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa.t1.p2)                                               |
| [`E2E: ReductionManager > ordinary reduction submission outcomes > RaceConditionBlockHeightTooOld completes the installed reduction as success`](../../../../../../test/e2e/E2E-ReductionManager.test.ts#L45) (line 45)     | [`REQ-DISPUTE-PIPE-4-3YVDSA.T1.P5`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa.t1.p5)                                               |
| [`E2E: ReductionManager > ordinary reduction submission outcomes > RaceConditionReductionExpectationDoesntMatch aborts and rejects the operation`](../../../../../../test/e2e/E2E-ReductionManager.test.ts#L62) (line 62)   | [`INTEGRATION-TEST-DISPUTE-PIPE-1-BPTFY9.P4`](../../../../implementation/views/protocol/dispute-processing.md#integration-test-dispute-pipe-1-bptfy9.p4)                    |
| [`E2E: ReductionManager > an empty dispute set posts replacement evidence and resumes the same reduction`](../../../../../../test/e2e/E2E-ReductionManager.test.ts#L185) (line 185)                                         | [`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P3`](../../../../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md#unit-test-reduction-executor-1-dgad37.p3) |
