# JoinChannelSnapshotGuard.t.sol — Test report

> **Test file:** [test/V1/StateChannelDiamondProxy/JoinChannelSnapshotGuard.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelSnapshotGuard.t.sol) > **Status:** Authored; engineer verification pending.

## Overview

Submits joins against matching and moved snapshot commitments. Checks that the snapshot guard rejects a mismatching transaction snapshot target without admitting the joiner.

## Tests and covered test IDs

| Test declaration                                                                                                                                                            | Covers                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`test_joinChannel_matchingSnapshotTargetPassesGuard`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelSnapshotGuard.t.sol#L31) (line 31)                  | [`REQ-MSG-10-7JS45Q.T3.P1`](../../../../../specification/settlement/cross-layer-messages.md#req-msg-10-7js45q.t3.p1), [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P27`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a.p27) |
| [`test_joinChannel_differentSnapshotTargetRevertsWithSnapshotMismatch`](../../../../../../../test/V1/StateChannelDiamondProxy/JoinChannelSnapshotGuard.t.sol#L42) (line 42) | [`REQ-MSG-10-7JS45Q.T3.P2`](../../../../../specification/settlement/cross-layer-messages.md#req-msg-10-7js45q.t3.p2), [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P28`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a.p28) |
