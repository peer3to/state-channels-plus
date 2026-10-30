# latestInboundMessageBlockHash.test.ts

Test file: [test/e2e/disputeValidation/uploadRevert/latestInboundMessageBlockHash.test.ts](../../../../../../../../test/e2e/disputeValidation/uploadRevert/latestInboundMessageBlockHash.test.ts)

## Overview

A single refusal case for the exact inbound-head anchor gate at upload. A real constructed dispute is
re-signed with `latestInboundMessageBlockHash = ZeroHash`, `lastInboundMessageBlockHeight = 0` and no posted
auditing data, then uploaded directly. The open appended an inbound block, so the chain head
(`getChannelBalance`) has height > 0 and `uploadDispute` reverts
`RaceConditionDisputeInboundNotLatest(head hash, ZeroHash)`; the fork's window creation timestamp stays 0. The
component boundary permutations (both upload modes, below and at the head) are assigned to the Foundry admission
suite; this case covers the refusal through the deployed manager for a dispute the SDK constructed. Junk anchors
(a random hash, or the genesis hash with height > 0) meet the same gate, so the fraud-proof cases in
`disputeValidation/inboundHash.test.ts` are skipped.

## Tests

- `dispute.input.latestInboundMessageBlockHash below the chain inbound head → RaceConditionDisputeInboundNotLatest`: REQ-DIS-2-PKVZ7E.T1.P30
