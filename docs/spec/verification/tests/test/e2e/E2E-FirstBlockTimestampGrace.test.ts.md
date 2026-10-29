# E2E-FirstBlockTimestampGrace.test.ts

Test file: [test/e2e/E2E-FirstBlockTimestampGrace.test.ts](../../../../../../test/e2e/E2E-FirstBlockTimestampGrace.test.ts)

## Overview

The suite verifies the `firstBlockGrace` rule — height 0 of a fork gets `evidenceTime` added to
its windows — end to end on real 2–3 peer sessions. It asserts the exact timeout arithmetic
(`getTimeoutWaitTimeSeconds` returns `p2pTime + agreementTime + chainFallbackTime` plus
`evidenceTime` only at height 0), then authors height 0 after the ordinary participant deadline
and proves every peer finalizes the same block with all three signatures, a timestamp above the
normal `genesis + p2pTime` cap but within `genesis + evidenceTime + p2pTime`, and no dispute.
A companion test proves height 1 gets no grace: authoring past the cap yields a block clamped to
exactly `previousBlock.timestamp + p2pTime` (the inclusive boundary), still finalized by all
peers. The last test drives the timeout side through `lifecycle.timeoutSetup`: one second before
the grace deadline no peer initiates a dispute, after it the two waiting peers initiate and the
timed-out peer does not. Oracles are decoded genesis snapshots and block bundles fetched over the
control RPC plus dispute event spies. On-chain adjudication of `InvalidTimestamp` proofs and
non-grace timeout scheduling are out of scope. After the permutation atomization the window
scenarios stand alone, so the arithmetic, boundary-cap, and grace-deadline tests carry their
`REQ-TIME-3-MT1MMF.T1` scenarios; honest-skew bounds and the non-grace due-time boundaries remain with
the dedicated timeouts suite.

## Tests

- `adds evidenceTime only to the height 0 participant timeout`: REQ-TIME-3-MT1MMF.T1.P1
- `authors height 0 after the old participant deadline and every peer finalizes it`: none
- `caps height 1 without evidenceTime grace and every peer finalizes it`: REQ-TIME-3-MT1MMF.T1.P9
- `does not time out height 0 inside the grace window and times out after it`: REQ-TIME-3-MT1MMF.T1.P2, REQ-TIME-3-MT1MMF.T1.P7
