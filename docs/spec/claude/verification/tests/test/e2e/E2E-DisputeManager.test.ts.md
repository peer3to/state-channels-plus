# test/e2e/E2E-DisputeManager.test.ts — Test Report

> **Test file:** [test/e2e/E2E-DisputeManager.test.ts](../../../../../../../test/e2e/E2E-DisputeManager.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite runs three to four real peer hosts through the MathTestSession harness and drives the
whole dispute pipeline: a byzantine stimulus (invalid state transition, double-sign, or a tampered
dispute posted straight to the contract) triggers detection, dispute construction and upload by
`DisputeManager`, on-chain commitment, kill auditing, and reduction to a successor fork. Oracles
are protocol events (`onInitiatingDispute`, `onDisputeCommitted`, `onDisputeKilled`,
`onStateSnapshotUpdated`), stored dispute fraud-proof types, on-chain slashed participants, fork
settlement via `resolveDisputeWait`, and post-resolution snapshot posting. Both submission paths
run: a settled fork disputes without auditing calldata, a pending-join fork with it. The
fraud-proof group kills internally valid but baseless or tampered disputes (`InvalidDisputeReason`,
`DisputeInvalidStateProof`). The partial-syncing group shows a disconnected peer recovering
committed disputes and reducing from persisted proof data, and peers storing block/state data
delivered by a dispute for heights they never received. The pending-join writer-timeout test is
skipped on a known product race. Per-field dispute-input and state-proof audits are out of scope
(`test/e2e/disputeValidation/*`), as are `DisputeManager` branch permutations
(`test/unit/DisputeManager.test.ts`). After the permutation split, the single-scenario
dispute-input, kill, and recovery permutations demonstrated here are assigned below; per-predicate
audit permutations stay with the `test/e2e/disputeValidation/*` suites.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                         | Covers                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: Dispute Manager > Dispute Resolution and Fork Management > should reduce invalid state transition disputes and create new fork`](../../../../../../../test/e2e/E2E-DisputeManager.test.ts#L18) (line 18)                          | [`INTEGRATION-TEST-DISPUTE-PIPE-1.P1`](../../../../implementation/views/protocol/dispute-processing.md#integration-test-dispute-pipe-1.p1), [`REQ-DIS-1.T1.P1`](../../../../specification/disputes/disputes.md#req-dis-1.t1.p1) |
| [`E2E: Dispute Manager > Dispute Resolution and Fork Management > should post a dispute WITH auditing calldata on a pending-join fork`](../../../../../../../test/e2e/E2E-DisputeManager.test.ts#L37) (line 37)                          | —                                                                                                                                                                                                                               |
| [`E2E: Dispute Manager > Dispute Resolution and Fork Management > should post updated state snapshot after fork resolution`](../../../../../../../test/e2e/E2E-DisputeManager.test.ts#L63) (line 63)                                     | [`REQ-DIS-9.T1.P1`](../../../../specification/disputes/disputes.md#req-dis-9.t1.p1)                                                                                                                                             |
| [`E2E: Dispute Manager > Writer Timeout on a Pending-Join Fork > should dispute a timed-out writer on a pending-join fork with auditing calldata`](../../../../../../../test/e2e/E2E-DisputeManager.test.ts#L92) (line 92)               | —                                                                                                                                                                                                                               |
| [`E2E: Dispute Manager > Fraud Proof Detection > should kill a spam dispute with no legitimate enforcement basis`](../../../../../../../test/e2e/E2E-DisputeManager.test.ts#L133) (line 133)                                             | [`INTEGRATION-TEST-DISPUTE-PIPE-1.P2`](../../../../implementation/views/protocol/dispute-processing.md#integration-test-dispute-pipe-1.p2)                                                                                      |
| [`E2E: Dispute Manager > Fraud Proof Detection > should reject dispute when auditing data is partial and state proof invalid`](../../../../../../../test/e2e/E2E-DisputeManager.test.ts#L164) (line 164)                                 | —                                                                                                                                                                                                                               |
| [`E2E: Dispute Manager > Fraud Proof Detection > should reject dispute when full auditing data reconstructed but both commitment and state proof are invalid`](../../../../../../../test/e2e/E2E-DisputeManager.test.ts#L209) (line 209) | —                                                                                                                                                                                                                               |
| [`E2E: Dispute Manager > Partial Syncing via Dispute Validation > recovers an expired posted-data dispute and reduces from persisted proof data`](../../../../../../../test/e2e/E2E-DisputeManager.test.ts#L231) (line 231)              | [`REQ-DIS-4.T1.P16`](../../../../specification/disputes/disputes.md#req-dis-4.t1.p16)                                                                                                                                           |
| [`E2E: Dispute Manager > Partial Syncing via Dispute Validation > should have missing state Storage when peer receives dispute with blocks it doesn't have`](../../../../../../../test/e2e/E2E-DisputeManager.test.ts#L350) (line 350)   | —                                                                                                                                                                                                                               |
| [`E2E: Dispute Manager > Partial Syncing via Dispute Validation > should handle valid dispute when validating peer is missing snapshot data`](../../../../../../../test/e2e/E2E-DisputeManager.test.ts#L387) (line 387)                  | —                                                                                                                                                                                                                               |
