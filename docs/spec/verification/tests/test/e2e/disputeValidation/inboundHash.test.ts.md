# inboundHash.test.ts

Test file: [test/e2e/disputeValidation/inboundHash.test.ts](../../../../../../../test/e2e/disputeValidation/inboundHash.test.ts)

## Overview

Upload refuses any dispute not anchored exactly at the chain's inbound head
(`disputeValidation/uploadRevert/latestInboundMessageBlockHash.test.ts`), so the three fraud-proof cases here are
`it.skip` tripwires that never reach a committed dispute: a random `latestInboundMessageBlockHash`, `ZeroHash` with
`lastInboundMessageBlockHeight = 999999n` (both `DisputeInboundHashNotInChain`), and an anchor below the pinned
snapshot's inbound height (`DisputeInboundAnchorBehindLatestState`). They run nothing, so no test IDs are
assigned. The one live case opens with two peers, adds a spectator synced past the open (it never saw the
genesis join block), holds its inbound events and joins it, lands an existing participant's top-up,
advances and finalizes past it, and checks the premise that events are held and the lagging peer's
inbound store is still empty. It then provokes a double-sign dispute that only the lagging peer
initiates. The oracles assert that dispute commits and resolves, no peer fires `onDisputeKilled`, and
the lagging disputer is not slashed.

## Tests

- `dispute.input.latestInboundMessageBlockHash = random (not on-chain) → DisputeInboundHashNotInChain`: none
- `dispute.input.latestInboundMessageBlockHash = ZeroHash AND lastInboundMessageBlockHeight > 0 → DisputeInboundHashNotInChain`: none
- `dispute.input.lastInboundMessageBlockHeight below the pinned snapshotData.latestInboundMessageBlockHeight → DisputeInboundAnchorBehindLatestState`: none
- `honest disputer whose inbound chain event lags → dispute survives, disputer not killed or slashed`: REQ-DISPUTE-PIPE-5-RZZB48.T2.P3
