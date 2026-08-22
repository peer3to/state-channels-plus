# test/e2e/disputeValidation/uploadRevert/disputeAuditingDataHash.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/uploadRevert/disputeAuditingDataHash.test.ts](../../../../../../../../test/e2e/disputeValidation/uploadRevert/disputeAuditingDataHash.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A single upload-gate case for auditing-data hash binding on the calldata path:
`preDisputeSetupCalldataPath` makes peer 3 construct a dispute that posts auditing data,
`DisputeTampering.tamperAuditingDataHash` breaks `dispute.input.disputeAuditingDataHash`, and
the harness asserts the upload reverts with the decoded custom error
`ErrorAuditingDataHashMismatch` — the chain refuses a dispute whose claimed hash does not
match the posted calldata. The revert's arguments carry the claimed hash and the hash the
posted data actually produces, so the mismatch is checked as a pair rather than by name
alone. No window state is created and the audit pipeline is never
reached, so auditor behavior is out of scope. After the permutation atomization the upload
gates are split per revert, and this case carries the auditing-hash mismatch gate.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                           | Covers                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / uploadRevert / disputeAuditingDataHash > with calldata: dispute.input.disputeAuditingDataHash tampered → dispute upload fails → ErrorAuditingDataHashMismatch`](../../../../../../../../test/e2e/disputeValidation/uploadRevert/disputeAuditingDataHash.test.ts#L10) (line 10) | [`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P7`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol.md#unit-test-dispute-manager-facet-1-b4kky2.p7) |
