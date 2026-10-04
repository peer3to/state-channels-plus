# test/e2e/disputeValidation/outputState.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/outputState.test.ts](../../../../../../../test/e2e/disputeValidation/outputState.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The single test checks that the validator recomputes the post-reduction output commitment from
the verified state proof plus dispute input and rejects mismatches. Peer 2's `constructDispute` is
stubbed to overwrite `dispute.outputSnapshotDataHash` with `hash("0x42")`; peer 1's double-sign
block provokes the dispute. The oracles assert peer 2's dispute is initiated and committed without
auditing data, an honest peer fires `onDisputeKilled`, honest peers store a
`DisputeInvalidOutputState` dispute fraud proof, and the fork resolves via `resolveDisputeWait`.
The selfRemoval-flipped variant that fails through the same proof type lives in
`disputeInputFields/selfRemoval.test.ts`. After the permutation atomization, the
output-correctness check failure, its proof family, and its mirrored-predicate agreement exist
as single-scenario IDs, and this test covers them in full.

The spectator case opens a three-peer channel and adds a spectator while the participants author.
Peer 0's `constructDispute` is stubbed the same way and peer 0 disputes directly as a self-removal
(a stated reason, so its dispute opens the window itself), with no fraudulent block, so the spectator
sees only the posted dispute. The spectator does not audit it: its runtime
closes and its status hook reports `OPENED`. Peers 1 and 2 kill the dispute and store
`DisputeInvalidOutputState`; the kill empties the window, the honest participants upload replacement
evidence on their own, and the window resolves without the spectator.

The final-dispute case adds a spectator to a four-peer channel while the participants author, then
peer 1 double-signs and peer 3 posts a threshold-final dispute while the honest participants open no
ordinary dispute (`submitFinalDispute`), so the final dispute is the first dispute event the spectator
sees. Its runtime closes and its status hook reports `OPENED`; peers 0, 2 and 3 complete the reduction
to the dispute's output fork.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                                                                          | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`E2E: dispute validation / outputState > dispute.outputSnapshotDataHash = random → DisputeInvalidOutputState`](../../../../../../../test/e2e/disputeValidation/outputState.test.ts#L14) (line 14)                                                                                                                                                        | [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P21`](../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-1-xbca09.p21), [`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P10`](../../../../../implementation/source/src/stateManager/dispute/DisputeFraudProofService.ts.md#unit-test-dispute-fraud-proof-service-1-zvpvc0.p10), [`REQ-DISPUTE-PIPE-5-RZZB48.T1.P5`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48.t1.p5) |
| [`E2E: dispute validation / outputState > a spectator does not audit: a non-final dispute (outputSnapshotDataHash = random) → the spectator aborts its runtime instead of auditing; the participants store DisputeInvalidOutputState, kill it and resolve the window`](../../../../../../../test/e2e/disputeValidation/outputState.test.ts#L41) (line 41) | [`REQ-DISPUTE-PIPE-2-MJRJV1.T2.P1`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-2-mjrjv1.t2.p1)                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [`E2E: dispute validation / outputState > a spectator does not follow a final dispute: its first dispute event is threshold-final → the spectator aborts its runtime instead of storing it or adopting its outcome; the participants install the reduced fork`](../../../../../../../test/e2e/disputeValidation/outputState.test.ts#L89) (line 89)        | [`REQ-DISPUTE-PIPE-2-MJRJV1.T2.P2`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-2-mjrjv1.t2.p2)                                                                                                                                                                                                                                                                                                                                                                                                                 |
