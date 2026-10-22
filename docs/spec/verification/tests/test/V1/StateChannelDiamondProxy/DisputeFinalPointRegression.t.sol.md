# DisputeFinalPointRegression.t.sol

Test file: [test/V1/StateChannelDiamondProxy/DisputeFinalPointRegression.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/DisputeFinalPointRegression.t.sol)

## Overview

Stages a channel whose anchor precedes a later joiner's JOIN and applies the `DisputeFinalPointRegression` counter. Nine tests. The first posts two disputes in one window: the joiner's honest history, which consumes the JOIN and reaches a threshold-final point, and a side chain from the anchor whose inbound head stays below the JOIN; the counter kills the side chain and the reduction keeps the joiner's final history. Three more kill: an inflated inbound height field next to the real head, an inbound head the chain does not hold, and a regression at a second hop. Five controls are rejected and cost the challenger: a milestone above the final point on the same inbound head, a milestone at the final height, a snapshot the block does not commit, an index out of range, and a final proof that does not walk.

## Tests

- `test_K1_sideChainBypassingALaterJoinerLosesTheReductionToTheJoinersFinalHistory`: REQ-FP-7-4DD0D7.T10.P1, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P214
- `test_K2_inflatedInboundHeightFieldInGSnapshotStillKills`: REQ-FP-7-4DD0D7.T10.P2, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P215
- `test_K3_gInboundHeadTheChainDoesNotHoldKills`: REQ-FP-7-4DD0D7.T10.P3, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P216
- `test_K4_regressionAtASecondHopMilestoneKills`: REQ-FP-7-4DD0D7.T10.P4, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P217
- `test_N1_gAboveFOnTheSameInboundHeadDoesNotKill`: REQ-FP-7-4DD0D7.T10.P5, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P218
- `test_N2_gAtTheFinalHeightDoesNotKill`: REQ-FP-7-4DD0D7.T10.P6, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P219
- `test_N3_snapshotTheBlockDoesNotCommitDoesNotKill`: REQ-FP-7-4DD0D7.T10.P7, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P220
- `test_N4_milestoneIndexOutOfRangeDoesNotKill`: REQ-FP-7-4DD0D7.T10.P8, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P221
- `test_N5_finalProofThatDoesNotWalkDoesNotKill`: REQ-FP-7-4DD0D7.T10.P9, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P222
