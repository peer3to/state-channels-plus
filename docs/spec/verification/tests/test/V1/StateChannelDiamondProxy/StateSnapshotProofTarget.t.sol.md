# StateSnapshotProofTarget.t.sol

Test file: [test/V1/StateChannelDiamondProxy/StateSnapshotProofTarget.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateSnapshotProofTarget.t.sol)

## Overview

Posts snapshot updates with milestone proof targets. Checks final-point selection, anchor no-op cases and validity of the resulting chain snapshot.

## Tests

- `test_U65_firstBlockSnapshotIsTheTargetNotTheTail`: INV-ENFSNAP-1-9VZ2HE.T2.P1, UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P34
- `test_U65_unfinalizedTailStateCannotBeTheTarget`: INV-ENFSNAP-1-9VZ2HE.T2.P2, UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P35
- `test_U66_insufficientFinalityCannotPromoteTheFirstBlock`: INV-ENFSNAP-1-9VZ2HE.T2.P3, UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P36
- `test_U67_thresholdFinalBlockZeroIsPostable`: INV-ENFSNAP-1-9VZ2HE.T2.P4, UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P37
- `test_U67_unfinalizedBlockZeroIsNotPostable`: INV-ENFSNAP-1-9VZ2HE.T2.P5, UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P38
- `test_U66_blockZeroAdditionWithTheUnionIsPostable`: INV-ENFSNAP-1-9VZ2HE.T2.P6, UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P39
- `test_U66_blockZeroAdditionMissingTheJoinerIsNotPostable`: INV-ENFSNAP-1-9VZ2HE.T2.P7, UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P40
- `test_U66_blockZeroRemovalWithTheUnionIsPostable`: INV-ENFSNAP-1-9VZ2HE.T2.P8, UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P41
- `test_U66_blockZeroRemovalMissingTheLeaverIsNotPostable`: INV-ENFSNAP-1-9VZ2HE.T2.P9, UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P42
- `test_U109_anchorBlockAloneHasNoNewerFinalizedState`: INV-ENFSNAP-1-9VZ2HE.T2.P10, UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P43
- `test_U109_unfinalizedBlocksAfterTheAnchorAreNotATarget`: INV-ENFSNAP-1-9VZ2HE.T2.P11, UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P44
- `test_U118_separateLastMilestoneMakesTheLaterFinalPointTheTarget`: INV-ENFSNAP-1-9VZ2HE.T2.P12, UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P45
- `test_U118_changePointIsNotTheTargetOfTheOverlappingProof`: INV-ENFSNAP-1-9VZ2HE.T2.P13, UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P46
