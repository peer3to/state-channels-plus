# test/e2e/disputeValidation/uploadRevert/disputerThrottle.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/uploadRevert/disputerThrottle.test.ts](../../../../../../../../test/e2e/disputeValidation/uploadRevert/disputerThrottle.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Three cases around the per-address upload throttle, driven with junk-fork self-removal
disputes so each `postDispute` opens (or joins) a window without needing a real fault. The
first shows enforcement: two window-opening uploads from the same disputer within
`evidenceTime`, where the second reverts with the decoded custom error
`ErrorDisputeThrottled`. The second shows the bound is temporal: after sleeping past
`evidenceTime`, the same disputer's next upload succeeds. The third pins the join branch: a
disputer already throttled by opening window B must also be blocked when posting into another
peer's open window A (the pre-fix behavior skipped the throttle check on that branch).
Throttle interaction with real dispute content, the one-post-per-window rule, and eligibility
gating are out of scope. The facet's throttle-boundary permutation
([`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P6`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol.md#unit-test-dispute-manager-facet-1-b4kky2.p6)) needs both the enforced and the expired side of the
boundary, which no single test here shows alone, so it stays unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                                                                                                              | Covers                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / uploadRevert / disputerThrottle > disputer already throttled; opens NEW window > second postDispute from same disputer within evidenceTime → dispute upload fails → ErrorDisputeThrottled`](../../../../../../../../test/e2e/disputeValidation/uploadRevert/disputerThrottle.test.ts#L13) (line 13)                                                               | [`REQ-ENFDIS-2-VV9FPR.T1.P1`](../../../../../../specification/enforcement/dispute-window.md#req-enfdis-2-vv9fpr.t1.p1) |
| [`E2E: dispute validation / uploadRevert / disputerThrottle > disputer already throttled; opens NEW window > second postDispute from same disputer after evidenceTime → dispute upload succeeds`](../../../../../../../../test/e2e/disputeValidation/uploadRevert/disputerThrottle.test.ts#L49) (line 49)                                                                                     | —                                                                                                                      |
| [`E2E: dispute validation / uploadRevert / disputerThrottle > disputer already throttled; JOINS existing window opened by another peer > postDispute reuses dispute.input.forkId from another peer's open window within evidenceTime → dispute upload fails → ErrorDisputeThrottled`](../../../../../../../../test/e2e/disputeValidation/uploadRevert/disputerThrottle.test.ts#L76) (line 76) | —                                                                                                                      |
