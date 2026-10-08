# disputeAuditingDataHash.test.ts

Test file: [test/e2e/disputeValidation/uploadRevert/disputeAuditingDataHash.test.ts](../../../../../../../../test/e2e/disputeValidation/uploadRevert/disputeAuditingDataHash.test.ts)

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

## Tests

- `with calldata: dispute.input.disputeAuditingDataHash tampered → dispute upload fails → ErrorAuditingDataHashMismatch`: UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P7
- `E2E: dispute validation / uploadRevert / disputeAuditingDataHash > postedAuditingData true uploaded without calldata → dispute upload fails → ErrorDisputePostedAuditingDataMismatch`: none
- `E2E: dispute validation / uploadRevert / disputeAuditingDataHash > postedAuditingData false uploaded with calldata → dispute upload fails → ErrorDisputePostedAuditingDataMismatch`: none
