# test/e2e/disputeValidation/uploadRevert/disputer.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/uploadRevert/disputer.test.ts](../../../../../../../../test/e2e/disputeValidation/uploadRevert/disputer.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A single upload-gate case for disputer identity: `postTamperedDispute` sets
`dispute.input.disputer = ZeroAddress`, so the claimed disputer no longer equals
`msg.sender`, and the harness asserts the upload reverts with the decoded custom error
`ErrorDisputerNotMsgSender`, whose arguments carry the claimed disputer and the actual
sender side by side. This pins the `disputer == msg.sender` binding of the upload
eligibility rules at the contract boundary; audit-side behavior is out of scope because the
dispute never lands on-chain. After the permutation atomization the case carries the
per-gate disputer-not-sender revert and the [`REQ-DIS-2-PKVZ7E`](../../../../../../specification/disputes/disputes.md#req-dis-2-pkvz7e) wrong-identity split.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                              | Covers                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / uploadRevert / disputer > dispute.input.disputer = ZeroAddress → dispute upload fails → ErrorDisputerNotMsgSender`](../../../../../../../../test/e2e/disputeValidation/uploadRevert/disputer.test.ts#L7) (line 7) | [`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P8`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol.md#unit-test-dispute-manager-facet-1-b4kky2.p8)<br>[`REQ-DIS-2-PKVZ7E.T1.P6`](../../../../../../specification/disputes/disputes.md#req-dis-2-pkvz7e.t1.p6) |
