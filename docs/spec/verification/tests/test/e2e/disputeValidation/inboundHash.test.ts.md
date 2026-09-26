# test/e2e/disputeValidation/inboundHash.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/inboundHash.test.ts](../../../../../../../test/e2e/disputeValidation/inboundHash.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Upload refuses any dispute not anchored exactly at the chain's inbound head
(`disputeValidation/uploadRevert/latestInboundMessageBlockHash.test.ts`), so the three fraud-proof cases here are
`it.skip` tripwires that never reach a committed dispute: a random `latestInboundMessageBlockHash`, `ZeroHash` with
`lastInboundMessageBlockHeight = 999999n` (both `DisputeInboundHashNotInChain`), and an anchor below the pinned
snapshot's inbound height (`DisputeInboundAnchorBehindLatestState`). They run nothing, so no test IDs are
assigned. The one live case holds the lagging peer's inbound events from before the open, lands an existing
participant's top-up, advances and finalizes past it, then provokes a double-sign dispute that only the lagging
peer initiates. The oracles assert that dispute commits and resolves, no peer fires `onDisputeKilled`, and the
lagging disputer is not slashed.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                 | Covers                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / inboundHash > dispute.input.latestInboundMessageBlockHash = random (not on-chain) → DisputeInboundHashNotInChain`](../../../../../../../test/e2e/disputeValidation/inboundHash.test.ts#L14) (line 14)                                                | —                                                                                                                                |
| [`E2E: dispute validation / inboundHash > dispute.input.latestInboundMessageBlockHash = ZeroHash AND lastInboundMessageBlockHeight > 0 → DisputeInboundHashNotInChain`](../../../../../../../test/e2e/disputeValidation/inboundHash.test.ts#L45) (line 45)                       | —                                                                                                                                |
| [`E2E: dispute validation / inboundHash > dispute.input.lastInboundMessageBlockHeight below the pinned snapshotData.latestInboundMessageBlockHeight → DisputeInboundAnchorBehindLatestState`](../../../../../../../test/e2e/disputeValidation/inboundHash.test.ts#L77) (line 77) | —                                                                                                                                |
| [`E2E: dispute validation / inboundHash > honest disputer whose inbound chain event lags → dispute survives, disputer not killed or slashed`](../../../../../../../test/e2e/disputeValidation/inboundHash.test.ts#L154) (line 154)                                               | [`REQ-DISPUTE-PIPE-5-RZZB48.T2.P3`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48.t2.p3) |
