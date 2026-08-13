# test/e2e/disputeValidation/stateProof/case2_empty.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case2_empty.test.ts](../../../../../../../../../test/e2e/disputeValidation/stateProof/case2_empty.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Pointer file only. The Trello Case 2 shape — an empty state proof (no milestones, no signed
blocks) whose latest state is the fork genesis snapshot — is exercised in
`test/e2e/disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts` under the
"(1) stateProof empty" describe, in both the no-calldata and calldata-posted paths. The single
declaration here is a skipped cross-reference: it never runs and asserts nothing, so no test
IDs can be assigned in this report.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                 | Covers |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: dispute validation / stateProof / Case 2 (empty stateProof) — see latestStateSnapshotHash > → see disputeInputFields/latestStateSnapshotHash → '(1) stateProof empty'`](../../../../../../../../../test/e2e/disputeValidation/stateProof/case2_empty.test.ts#L7) (line 7) | —      |
