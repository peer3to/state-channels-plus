# test/e2e/disputeValidation/reducedForkTimestampMismatch.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/reducedForkTimestampMismatch.test.ts](../../../../../../../../test/e2e/disputeValidation/reducedForkTimestampMismatch.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Long-running convergence test across two consecutive dispute reductions (fork A→B→C). Five peers
start; the next-to-write peer submits an invalid state-transition block, the resulting dispute is
resolved through `resolveDisputeWait`, and after the first reduction the test also waits for local
snapshots to change off the pre-dispute fork. A second attacker repeats the pattern on fork B.
After each reduction, and through six further honest state transitions on the twice-reduced fork,
the oracle is `assert.sync.peersInSyncWait` over the surviving honest peers — guarding the
regression where a reduced fork's genesis timestamp mismatch would desynchronize survivors. The
test asserts sync and fork settlement only; it does not inspect reduced-output contents,
slash sets, or on-chain snapshot advancement. The order-independence and canonical-successor spec
permutations near this behavior each bundle several scenarios, so none is assigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                           | Covers |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: dispute validation / reducedForkTimestampMismatch > fork A→B→C: two reductions then sustained honest activity → all survivors stay in sync`](../../../../../../../../test/e2e/disputeValidation/reducedForkTimestampMismatch.test.ts#L16) (line 16) | —      |
