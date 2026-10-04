# test/e2e/E2E-DisputeDecisionForkChange.test.ts — Test Report

> **Test file:** [test/e2e/E2E-DisputeDecisionForkChange.test.ts](../../../../../../test/e2e/E2E-DisputeDecisionForkChange.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite checks that a dispute decision stops when a real fork change happens during one of its
awaited steps. `stageHeldNoReasonDisputeDecision` (`test/fixtures/StateProofLifecycleStaging.ts`)
starts four peers and suppresses dispute initiation on all of them. Peer 3 is marked to leave by
force exit. Peer 2 posts a dispute that names no reason (no timeout, no slashes, no
self-removal). Peers 1–3 skip its kill, so only peer 0 decides it. Peer 0's decision parks at one
step: in the first case its audit parks at the on-chain slashes read; in the second case its kill
parks at the replay-gas read. While peer 0 is parked, `submitFinalDisputeFromStoredEvidence`
uploads peer 3's threshold-final self-removal dispute, and `resolveDisputeWait` waits until the
remaining peers 0 and 1 complete that final dispute on its output fork. Then the fixture releases
the parked step.

In the audit case the oracle waits until peer 0 stores a dispute fraud proof (the audit ran to its
false verdict). In both cases it then holds a 3-second window in which no remaining peer sees
`onDisputeKilled`, and it asserts that peer 0 applied no dispute fraud proof
(`recordDisputeFraudProofApplies` is empty) and that peer 0 is on the final dispute's output fork.
The suite does not observe internal handler steps; the held-step unit cases in
`test/unit/DisputeManager.test.ts` own those.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                      | Covers                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute decision across a real fork change > a threshold-final dispute moves the fork while the audit of a no-reason dispute is held → the audit ends without old-fork evidence, the final fork is completed`](../../../../../../test/e2e/E2E-DisputeDecisionForkChange.test.ts#L11) (line 11) | [`REQ-DISPUTE-PIPE-4-3YVDSA.T1.P13`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa.t1.p13) |
| [`E2E: dispute decision across a real fork change > a threshold-final dispute moves the fork while the kill's replay-gas read is held → no old-fork transaction, the final fork is completed`](../../../../../../test/e2e/E2E-DisputeDecisionForkChange.test.ts#L54) (line 54)                        | [`REQ-DISPUTE-PIPE-4-3YVDSA.T1.P14`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa.t1.p14) |
