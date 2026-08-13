# test/e2e/disputeValidation/uploadRevert/disputeAuditingDataHash.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/uploadRevert/disputeAuditingDataHash.test.ts](../../../../../../../../../test/e2e/disputeValidation/uploadRevert/disputeAuditingDataHash.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A single upload-gate case for auditing-data hash binding on the calldata path:
`preDisputeSetupCalldataPath` makes peer 3 construct a dispute that posts auditing data,
`DisputeTampering.tamperAuditingDataHash` breaks `dispute.input.disputeAuditingDataHash`, and
the harness asserts the upload reverts with the decoded custom error
`ErrorAuditingDataHashMismatch` — the chain refuses a dispute whose claimed hash does not
match the posted calldata. No window state is created and the audit pipeline is never
reached, so auditor behavior is out of scope. The matching gate permutation
(`UNIT-TEST-DISPUTE-MANAGER-FACET-1.P1`, "each gate revert") bundles all upload gates and is
not covered in full by this one case, so no ID is assigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                              | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: dispute validation / uploadRevert / disputeAuditingDataHash > with calldata: dispute.input.disputeAuditingDataHash tampered → dispute upload fails → ErrorAuditingDataHashMismatch`](../../../../../../../../../test/e2e/disputeValidation/uploadRevert/disputeAuditingDataHash.test.ts#L19) (line 19) | —      |
