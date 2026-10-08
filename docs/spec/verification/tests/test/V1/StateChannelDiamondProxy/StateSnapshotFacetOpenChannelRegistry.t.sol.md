# StateSnapshotFacetOpenChannelRegistry.t.sol

Test file: [test/V1/StateChannelDiamondProxy/StateSnapshotFacetOpenChannelRegistry.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetOpenChannelRegistry.t.sol)
Exercises: [StateChannelCommon.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol.md), [StateSnapshotFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md)

## Overview

The Foundry harness opens real manager channels and submits threshold-signed zero-participant final snapshots through the real snapshot entry point. The cases cover first, middle, and last swap-and-pop removal, moved-index repair, repeated close, and clean ID reuse.

## Tests

- `test_updateStateSnapshotSameFork_finalCloseRemovesFirstAndRepairsMovedIndex`: UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P3, REQ-LIF-8-2HDG3A.T1.P4
- `test_updateStateSnapshotSameFork_finalCloseRemovesMiddle`: UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P4, REQ-LIF-8-2HDG3A.T1.P5
- `test_updateStateSnapshotSameFork_finalCloseRemovesLast`: UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P5, REQ-LIF-8-2HDG3A.T1.P6
- `test_updateStateSnapshotSameFork_repeatedFinalCloseDoesNotChangeRegistry`: UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P6, REQ-LIF-8-2HDG3A.T1.P7, UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P17, REQ-ENFSNAP-4-ESP98F.T1.P3
- `test_open_afterFinalCloseAppendsChannelExactlyOnce`: UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P7, REQ-LIF-8-2HDG3A.T1.P8
- `test_lifecycleEvents_reconstructPagedOpenChannelRegistry`: UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P8, REQ-LIF-8-2HDG3A.T1.P9, REQ-LOBBY-1-PZTPKD.T1.P4
