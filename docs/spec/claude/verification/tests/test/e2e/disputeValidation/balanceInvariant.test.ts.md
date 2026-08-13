# test/e2e/disputeValidation/balanceInvariant.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/balanceInvariant.test.ts](../../../../../../../../test/e2e/disputeValidation/balanceInvariant.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The single test drives the dispute audit-and-kill pipeline end-to-end on a live `MathTestSession`
channel. After `preDisputeSetup`, peer 2 posts a tampered dispute whose committed latest snapshot
is a forged copy with `totalDeposits.amount` incremented by 1; the tamper callback rewrites the
state proof's latest block (signed-block or milestone variant), the auditing data, and both
`latestStateSnapshotHash` and `disputeAuditingDataHash` so the forgery is internally consistent
and only the balance invariant is broken. The oracles assert the dispute commits on-chain, honest
peers 0-1 store a `DisputeInvalidBalanceInvariant` dispute fraud proof and fire `onDisputeKilled`,
and the fork still resolves to a successor via `resolveDisputeWait`. Upload-revert behavior and
other invariant sub-checks are out of scope. After the permutation atomization, the
balance-invariant check failure, its proof family, and its mirrored-predicate agreement exist as
single-scenario IDs, and this test covers them in full.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                          | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`E2E: dispute validation / balanceInvariant > peer 2 uploads a dispute whose committed snapshot breaks the balance invariant → DisputeInvalidBalanceInvariant`](../../../../../../../../test/e2e/disputeValidation/balanceInvariant.test.ts#L6) (line 6) | [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P13`](../../../../../implementation/source/src/stateManager/DisputeValidationService.ts.md#unit-test-dispute-validation-service-1-xbca09.p13), [`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P8`](../../../../../implementation/source/src/stateManager/utils/DisputeFraudProofService.ts.md#unit-test-dispute-fraud-proof-service-1-zvpvc0.p8), [`REQ-DISPUTE-PIPE-5-RZZB48.T1.P7`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48.t1.p7) |
