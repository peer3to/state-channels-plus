# DisputeFinalPointRegression.t.sol

Test file: [test/V1/StateChannelDiamondProxy/DisputeFinalPointRegression.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/DisputeFinalPointRegression.t.sol)

## Overview

Stages a channel whose anchor precedes a later joiner's JOIN, with the joiner's honest history that consumes the JOIN and reaches a threshold-final point, and a side chain from the anchor whose inbound head stays below the JOIN. The kill case posts both disputes in one window, applies `DisputeFinalPointRegression` from the joiner, and checks that only the side chain's disputer is slashed and that the reduction keeps the joiner's final history. The controls apply the counter with the final point's own inbound, at the final height, with a snapshot the latest finalized block does not commit, and with the anchor as the latest finalized point; each keeps the dispute and slashes the challenger. A second staging adds a top-up before the late JOIN, so a side-chain final point below the JOIN is final; neither the regression nor the conflict counter can then kill the honest dispute that consumed the JOIN, while a conflict whose final point carries the latest finalized point's inbound still kills. A conflict counter whose supplied snapshot of the latest finalized point is not the one its block commits, with fewer inbound blocks, keeps the dispute and slashes the challenger. Both counters count only the JOIN of an address outside the lower point's participants: extra inbound that holds only a top-up keeps the dispute under the regression (the challenger is slashed) and does not refuse the conflict (which kills), while extra inbound with a top-up and a new joiner's JOIN kills; a new joiner above a run of 32 top-ups kills from below the run and from its top, and the case logs the walk's gas per skipped inbound block. The lookup cases read the anchor's inbound height for its unstored inbound head when it is the lower head, and expect `ErrorInboundMessageBlockNotStored` for any other unknown hash, for an upper head that is only the anchor's unstored head, and for a run that reaches a block pruned below the anchor, through both the regression and the conflict counter, with nobody slashed. Under a genesis start, an unfinalized block zero that consumed a JOIN does not raise the conflict's inbound check, so the conflict kills; a final block zero that consumed more inbound than the final point keeps the dispute. The cost case uses 32 participants, a final point whose extra inbound holds a top-up and the 32nd participant's JOIN, and the largest final proof that fits the 64 KiB calldata limit next to a one-hop dispute (one more hop would not fit), and asserts the kill stays below 17,916,000 gas.

## Tests

- `test_K1_sideChainBypassingALaterJoinerLosesTheReductionToTheJoinersFinalHistory`: REQ-FP-7-4DD0D7.T10.P1, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P218
- `test_regression_latestFinalizedPointWithTheFinalPointsInboundDoesNotKill`: REQ-FP-7-4DD0D7.T10.P2, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P219
- `test_regression_latestFinalizedPointAtTheFinalHeightDoesNotKill`: REQ-FP-7-4DD0D7.T10.P3
- `test_regression_snapshotTheLatestFinalizedBlockDoesNotCommitDoesNotKill`: REQ-FP-7-4DD0D7.T10.P4, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P86
- `test_regression_anchorAsTheLatestFinalizedPointDoesNotKill`: REQ-FP-7-4DD0D7.T10.P5
- `test_FR1_sideChainFinalPointBelowTheJoinCannotKillTheHonestDisputeThroughAnEarlyMilestone`: REQ-FP-7-4DD0D7.T10.P6
- `test_FR2_sideChainFinalPointBelowTheJoinCannotKillTheHonestDisputeThroughAConflict`: REQ-FP-7-4DD0D7.T9.P6
- `test_FR2_conflictWithTheLatestFinalizedPointsInboundKills`: REQ-FP-7-4DD0D7.T9.P7, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P82
- `test_conflict_anchorAsTheLatestFinalizedPointReadsTheAnchorsInbound`: REQ-FP-7-4DD0D7.T9.P8, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P87
- `test_conflict_unfinalizedGenesisBlockZeroDoesNotRaiseTheInboundCheck`: REQ-FP-7-4DD0D7.T9.P10, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P88
- `test_conflict_finalGenesisBlockZeroAboveTheFinalPointsInboundDoesNotKill`: REQ-FP-7-4DD0D7.T9.P11, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P89
- `test_conflict_snapshotTheLatestFinalizedBlockDoesNotCommitDoesNotKill`: REQ-FP-7-4DD0D7.T9.P12, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P90
- `test_lookup_anchorInboundHeadOutsideStorageReadsTheAnchorsHeight`: REQ-FP-7-4DD0D7.T10.P7, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P83
- `test_lookup_inboundHashNeitherStoredNorTheAnchorHeadReverts`: REQ-FP-7-4DD0D7.T10.P8, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P84, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P220
- `test_lookup_conflictWithAnInboundHashNeitherStoredNorTheAnchorHeadReverts`: REQ-FP-7-4DD0D7.T9.P13, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P91, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P221
- `test_regression_largestKillWithinTheCalldataLimitFitsTheGasLimit`: REQ-FP-7-4DD0D7.T10.P9
- `test_regression_finalPointWhoseExtraInboundIsOnlyATopUpDoesNotKill`: REQ-FP-7-4DD0D7.T10.P26, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P92
- `test_regression_finalPointWhoseExtraInboundHoldsATopUpAndANewJoinerKills`: REQ-FP-7-4DD0D7.T10.P27
- `test_conflict_latestFinalizedPointWhoseExtraInboundIsOnlyATopUpKills`: REQ-FP-7-4DD0D7.T9.P15, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P93
- `test_lookup_extraInboundFromTheAnchorsUnstoredInboundHeadReverts`: REQ-FP-7-4DD0D7.T10.P28, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P94
- `test_lookup_extraInboundWithAPrunedBlockBelowTheAnchorReverts`: REQ-FP-7-4DD0D7.T10.P29, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P94
- `test_regression_newJoinerAboveARunOfTopUpsKillsFromBelowTheRunAndFromItsTop`: REQ-FP-7-4DD0D7.T10.P30, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P95
