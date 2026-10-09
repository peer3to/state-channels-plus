# JoinChannelSnapshotGuard.t.sol

Test file: [test/V1/StateChannelDiamondProxy/JoinChannelSnapshotGuard.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelSnapshotGuard.t.sol)

## Overview

Submits joins against matching and moved snapshot commitments. Checks that the snapshot guard rejects a mismatching transaction snapshot target without admitting the joiner.

## Tests

- `test_joinChannel_matchingSnapshotTargetPassesGuard`: REQ-MSG-10-7JS45Q.T3.P1, UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P27
- `test_joinChannel_differentSnapshotTargetRevertsWithSnapshotMismatch`: REQ-MSG-10-7JS45Q.T3.P2, UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P28
