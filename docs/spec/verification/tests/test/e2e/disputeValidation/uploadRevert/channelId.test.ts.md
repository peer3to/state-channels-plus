# test/e2e/disputeValidation/uploadRevert/channelId.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/uploadRevert/channelId.test.ts](../../../../../../../../test/e2e/disputeValidation/uploadRevert/channelId.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A single upload-gate case driven at the on-chain manager boundary: after `preDisputeSetup`,
`postTamperedDispute` randomizes `dispute.input.channelId` and the harness asserts the upload
transaction reverts with the decoded custom error `ErrorCantParticipateInDispute` — the
sender is not an eligible participant of the claimed channel, so no dispute window is
created; the revert's arguments carry the claimed channel id and the ineligible sender, so
the rejection is checked against the values the caller actually supplied. Audit-side behavior
is out of scope; the tampered dispute never reaches the
state-proof checks. After the permutation atomization the case carries the per-gate
cannot-participate revert, the ineligible-uploader rejection (now split from the slashed
uploader), and the wrong-channel intake rejection.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / uploadRevert / channelId > dispute.input.channelId = random → dispute upload fails → ErrorCantParticipateInDispute`](../../../../../../../../test/e2e/disputeValidation/uploadRevert/channelId.test.ts#L7) (line 7) | [`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P9`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol.md#unit-test-dispute-manager-facet-1-b4kky2.p9)<br>[`REQ-ENFDIS-2-VV9FPR.T1.P4`](../../../../../../specification/enforcement/dispute-window.md#req-enfdis-2-vv9fpr.t1.p4)<br>[`REQ-DISPUTE-PIPE-1-HRBFP7.T1.P5`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7.t1.p5) |
