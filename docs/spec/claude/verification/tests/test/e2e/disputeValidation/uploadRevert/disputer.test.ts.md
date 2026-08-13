# test/e2e/disputeValidation/uploadRevert/disputer.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/uploadRevert/disputer.test.ts](../../../../../../../../../test/e2e/disputeValidation/uploadRevert/disputer.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A single upload-gate case for disputer identity: `postTamperedDispute` sets
`dispute.input.disputer = ZeroAddress`, so the claimed disputer no longer equals
`msg.sender`, and the harness asserts the upload reverts with the decoded custom error
`ErrorDisputerNotMsgSender`. This pins the `disputer == msg.sender` binding of the upload
eligibility rules at the contract boundary; audit-side behavior is out of scope because the
dispute never lands on-chain. The applicable permutations
(`UNIT-TEST-DISPUTE-MANAGER-FACET-1.P1` spans each gate; the `REQ-DIS-2` rows bundle the
whole identity/signature matrix) are broader than this one revert, so no ID is assigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                   | Covers |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: dispute validation / uploadRevert / disputer > dispute.input.disputer = ZeroAddress → dispute upload fails → ErrorDisputerNotMsgSender`](../../../../../../../../../test/e2e/disputeValidation/uploadRevert/disputer.test.ts#L17) (line 17) | —      |
