# E2E-ReductionManager.test.ts

Test file: [test/e2e/E2E-ReductionManager.test.ts](../../../../../../test/e2e/E2E-ReductionManager.test.ts)
Exercises: [ReductionManager.ts](../../../../implementation/source/src/stateManager/reduction/ReductionManager.ts.md), [ReductionExecutor.ts](../../../../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md)

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

## Tests

- `RaceConditionDisputeAlreadyReduced completes the installed reduction as success`: REQ-DISPUTE-PIPE-4-3YVDSA.T1.P2
- `RaceConditionBlockHeightTooOld completes the installed reduction as success`: REQ-DISPUTE-PIPE-4-3YVDSA.T1.P5
- `RaceConditionReductionExpectationDoesntMatch aborts and rejects the operation`: INTEGRATION-TEST-DISPUTE-PIPE-1-BPTFY9.P4
- `an empty dispute set posts replacement evidence and resumes the same reduction`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P3
- `dispute-window recovery defeated → the reduction defers, the peer is not evicted`: none
