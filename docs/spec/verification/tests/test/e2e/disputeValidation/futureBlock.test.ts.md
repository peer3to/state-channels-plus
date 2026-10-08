# futureBlock.test.ts

Test file: [test/e2e/disputeValidation/futureBlock.test.ts](../../../../../../../test/e2e/disputeValidation/futureBlock.test.ts)

## Overview

Protocol-gap regression for a height-above attack: peer 3's outbound block broadcast is stubbed
out, so it alone holds block 3 while honest peers 0-2 sit at height 2 (both facts are asserted via
`getLatestBlockHeight` before the attack proceeds). Peer 3 then posts a self-removal dispute whose
`stateProof` tops out at the un-broadcast block 3, which the test confirms through
`getStateProofTopBlockHeight` on the tampered dispute. The oracles assert the dispute commits for
honest peers, yet none of them fast-forwards past height 2 on the original fork just because the
committed dispute references a higher block; `resolveDisputeWait` then settles the fork without
requiring the attacker's removal. A known teardown bug (#353, `onStateSnapshotUpdated: unknown
snapshot while status=4`) is documented in the file; the test body itself passes. Even after the
permutation atomization, no single-scenario ID matches this protocol-gap regression (honest peers
refusing to fast-forward off a committed dispute's higher block), so the Covers column stays
empty.

## Tests

- `dispute.input.stateProof references block above honest peers' tip → dispute commits but honest peers stay at their pre-dispute height`: REQ-SP-10-JMVHTB.T7.P1
