# test/e2e/disputeValidation/uploadRevert/latestInboundMessageBlockHash.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/uploadRevert/latestInboundMessageBlockHash.test.ts](../../../../../../../../test/e2e/disputeValidation/uploadRevert/latestInboundMessageBlockHash.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A single refusal case for the consumed-inbound anchor gate at upload. A real constructed dispute is
re-signed with `latestInboundMessageBlockHash = ZeroHash`, `lastInboundMessageBlockHeight = 0` and no posted
auditing data, then uploaded directly: the chain snapshot has already consumed the open's inbound block, so
`uploadDispute` reverts `RaceConditionDisputeAnchorBehindSnapshot(consumedHeight, 0)` and the fork's window
creation timestamp stays 0. The component boundary permutations (both upload modes, at and above the
boundary) are assigned to the Foundry admission suite; this case covers the refusal through the deployed
manager for a dispute the SDK constructed. Junk inbound-hash variants that pass the gate live in
`disputeInputFields/inboundHash.test.ts` because they fail through the fraud-proof pipeline.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                                  | Covers                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / uploadRevert / latestInboundMessageBlockHash > dispute.input.lastInboundMessageBlockHeight below the consumed inbound → RaceConditionDisputeAnchorBehindSnapshot`](../../../../../../../../test/e2e/disputeValidation/uploadRevert/latestInboundMessageBlockHash.test.ts#L6) (line 6) | [`REQ-DIS-2-PKVZ7E.T1.P27`](../../../../../../specification/disputes/disputes.md#req-dis-2-pkvz7e.t1.p27) |
