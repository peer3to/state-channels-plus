# test/stateManager/DisputeCommitReductionSchedule.test.ts — Test Report

> **Test file:** [test/stateManager/DisputeCommitReductionSchedule.test.ts](../../../../../../test/stateManager/DisputeCommitReductionSchedule.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [EventHandler.ts](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Two cases on real channels through the harness session.

The first proves that a committed dispute schedules the fork's reduction even when the node could
add evidence but its own upload is skipped because it already holds a commitment in the window. A
malicious peer commits a real fraud and the node disputes it while its commit deliveries are held
by the harness; the node's dispute construction is then staged to claim one more slash than the
dispute it committed, so the evidence-improvement comparison finds a better outcome whose upload is
a no-op; the missed commits are recovered through the production query path
(`recoverCommittedDisputes`) inside the kill period. Oracles are the node's recorded scheduled
tasks (a new `reduction-` task after the recovery, bounded by the kill period that remains) and
the fork change the node reaches through the reduction. Without the fix the early return into the
skipped upload leaves the window without a scheduled reduction and the bounded wait times out.

The second uses `stageAuditorOfflineThroughKillPeriod` (`test/fixtures/OfflineAuditorStaging.ts`,
every peer's `reduction-*` tasks held, so the fork stays current everywhere): one peer is cut off
with its dispute commits and subscribed block-calldata logs held and its own disputes suppressed,
the others author a block it never sees, then a peer double-signs and a connected peer disputes.
The test checks the premise that the cut-off peer lacks the state of the dispute's head snapshot,
waits until the kill period expired, reconnects the peer, restores its commits and recovers them.
Oracles: the dispute confirmation is stored, the head snapshot's state is now held, and the peer
sees no `DisputeKilled`. The calldata stub drops the subscribed delivery only once, so the test
cannot tell the replay's write of the head state from a calldata log found again by an explicit
query during the recovery.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                    | Covers                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Dispute commit reduction schedule > a commit whose evidence-improvement upload is skipped as already initiated still schedules the reduction`](../../../../../../test/stateManager/DisputeCommitReductionSchedule.test.ts#L16) (line 16)                                                          | [`REQ-DISPUTE-PIPE-6-6FZB9M.T1.P5`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m.t1.p5), [`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P11`](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md#unit-test-event-handler-1-rz2c7w.p11)   |
| [`Dispute commit reduction schedule > a commit recovered after its kill period expired → audited in full: the replay stores the head state the peer missed, the confirmation is kept, nothing is killed`](../../../../../../test/stateManager/DisputeCommitReductionSchedule.test.ts#L99) (line 99) | [`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P17`](../../../../implementation/source/src/eventHandlers/EventHandler.ts.md#unit-test-event-handler-1-rz2c7w.p17), [`REQ-DISPUTE-PIPE-5-RZZB48.T1.P25`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48.t1.p25) |
