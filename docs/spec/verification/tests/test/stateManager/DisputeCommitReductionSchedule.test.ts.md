# DisputeCommitReductionSchedule.test.ts

Test file: [test/stateManager/DisputeCommitReductionSchedule.test.ts](../../../../../../test/stateManager/DisputeCommitReductionSchedule.test.ts)
Exercises: [EventHandler.ts](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md)

## Overview

Proves that a committed dispute schedules the fork's reduction even when the node could add
evidence but its own upload is skipped because it already holds a commitment in the window
A malicious peer commits a real fraud and the node disputes it while its commit
deliveries are dropped by the harness; the node's dispute construction is then staged to claim one
more slash than the dispute it committed, so the evidence-improvement comparison finds a better
outcome whose upload is a no-op; the missed commits are recovered through the production query
path inside the kill period. Oracles are the node's recorded scheduled tasks (a new `reduction-`
task after the recovery, bounded by the kill period that remains, because the expired branch
schedules unconditionally) and the fork change every honest peer reaches through the reduction.
Without the fix the early return into the skipped upload leaves the window without a scheduled
reduction and the bounded wait times out.

## Tests

- `a commit whose evidence-improvement upload is skipped as already initiated still schedules the reduction`: REQ-DISPUTE-PIPE-6-6FZB9M.T1.P5, UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P11
