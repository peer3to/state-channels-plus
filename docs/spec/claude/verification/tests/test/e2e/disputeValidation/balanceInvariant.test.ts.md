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
other invariant sub-checks are out of scope. The candidate spec permutations for this area bundle
several scenarios (valid plus invalid cases, every audit layer), so no ID is fully covered by this
single test and the Covers column stays empty.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                          | Covers |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: dispute validation / balanceInvariant > peer 2 uploads a dispute whose committed snapshot breaks the balance invariant → DisputeInvalidBalanceInvariant`](../../../../../../../../test/e2e/disputeValidation/balanceInvariant.test.ts#L6) (line 6) | —      |
