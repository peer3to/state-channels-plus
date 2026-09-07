# test/stateManager/DisputeCommitReductionSchedule.test.ts — Test Report

> **Test file:** [test/stateManager/DisputeCommitReductionSchedule.test.ts](../../../../../../test/stateManager/DisputeCommitReductionSchedule.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [EventHandler.ts](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

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

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                           | Covers                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`Dispute commit reduction schedule > a commit whose evidence-improvement upload is skipped as already initiated still schedules the reduction`](../../../../../../test/stateManager/DisputeCommitReductionSchedule.test.ts#L15) (line 15) | [`REQ-DISPUTE-PIPE-6-6FZB9M.T1.P5`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m.t1.p5), [`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P11`](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md#unit-test-event-handler-1-rz2c7w.p11) |
