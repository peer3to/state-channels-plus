# test/e2e/disputeValidation/disputeInputFields/disputeAuditingDataHash.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/disputeInputFields/disputeAuditingDataHash.test.ts](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/disputeAuditingDataHash.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Negative-control test for `dispute.input.disputeAuditingDataHash` on the no-calldata path: the
on-chain validator audits the field only when calldata is posted with the upload, so a tampered
hash must be silently ignored. Peer 0's `constructDispute` is stubbed with
`DisputeTampering.tamperAuditingDataHash` (auto-restored, not marked malicious); peer 1's
double-sign block provokes the dispute. The oracles assert the dispute is initiated and committed,
honest peers store the underlying `BlockDoubleSign` block fraud proof against peer 1, no honest
peer fires `onDisputeKilled` during a 3-second quiet window (no `DisputeInvalid*` proof against
the tampered dispute), and resolution excludes the double-signer, leaving 2 participants. The
calldata-path counterpart, where the upload itself reverts with `ErrorAuditingDataHashMismatch`,
lives in `disputeValidation/uploadRevert/disputeAuditingDataHash.test.ts`. Nearby spec
permutations are multi-scenario bundles, so none is assigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                                                                | Covers |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: dispute validation / disputeInputFields / disputeAuditingDataHash > no calldata: dispute.input.disputeAuditingDataHash tampered → dispute commits, no DisputeInvalidStateProof or other audit-data fraud proof`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/disputeAuditingDataHash.test.ts#L15) (line 15) | —      |
