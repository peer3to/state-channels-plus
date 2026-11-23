# DisputeFinalPointRegression.t.sol

Test file: [test/V1/StateChannelDiamondProxy/DisputeFinalPointRegression.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/DisputeFinalPointRegression.t.sol)

## Overview

Stages a channel whose anchor precedes a later joiner's JOIN, with the joiner's honest history that consumes the JOIN and reaches a threshold-final point, and a side chain from the anchor whose inbound head stays below the JOIN. The kill case posts both disputes in one window, applies `DisputeFinalPointRegression` from the joiner, and checks that only the side chain's disputer is slashed and that the reduction keeps the joiner's final history. The controls apply the counter with the final point's own inbound, at the final height, with a snapshot the latest finalized block does not commit, and with the anchor as the latest finalized point; each keeps the dispute and slashes the challenger. A second staging adds a top-up before the late JOIN, so a side-chain final point below the JOIN is final; neither the regression nor the conflict counter can then kill the honest dispute that consumed the JOIN, while a conflict whose final point carries the latest finalized point's inbound still kills. The lookup cases read the anchor's inbound height for its unstored inbound head and expect `ErrorInboundMessageBlockNotStored` for any other unknown hash. The cost case logs the kill's gas and calldata bytes and asserts both stay below the target chain's transaction limits.

## Tests

- `test_K1_sideChainBypassingALaterJoinerLosesTheReductionToTheJoinersFinalHistory`: REQ-FP-7-4DD0D7.T10.P1, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P218
- `test_regression_latestFinalizedPointWithTheFinalPointsInboundDoesNotKill`: REQ-FP-7-4DD0D7.T10.P2, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P219
- `test_regression_latestFinalizedPointAtTheFinalHeightDoesNotKill`: REQ-FP-7-4DD0D7.T10.P3
- `test_regression_snapshotTheLatestFinalizedBlockDoesNotCommitDoesNotKill`: REQ-FP-7-4DD0D7.T10.P4, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P86
- `test_regression_anchorAsTheLatestFinalizedPointDoesNotKill`: REQ-FP-7-4DD0D7.T10.P5
- `test_FR1_sideChainFinalPointBelowTheJoinCannotKillTheHonestDisputeThroughAnEarlyMilestone`: REQ-FP-7-4DD0D7.T10.P6
- `test_FR2_sideChainFinalPointBelowTheJoinCannotKillTheHonestDisputeThroughAConflict`: REQ-FP-7-4DD0D7.T9.P6
- `test_FR2_conflictWithTheLatestFinalizedPointsInboundKills`: REQ-FP-7-4DD0D7.T9.P7, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P79
- `test_conflict_anchorAsTheLatestFinalizedPointReadsTheAnchorsInbound`: REQ-FP-7-4DD0D7.T9.P8, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P87
- `test_lookup_anchorInboundHeadOutsideStorageReadsTheAnchorsHeight`: REQ-FP-7-4DD0D7.T10.P7, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P80
- `test_lookup_inboundHashNeitherStoredNorTheAnchorHeadReverts`: REQ-FP-7-4DD0D7.T10.P8, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P81, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P220
- `test_regression_killFitsTheParachainTransactionLimits`: REQ-FP-7-4DD0D7.T10.P9
