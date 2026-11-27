# LocalDiamondTrustedStartWalk.t.sol

Test file: [test/V1/StateChannelDiamondProxy/LocalDiamondTrustedStartWalk.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/LocalDiamondTrustedStartWalk.t.sol)
Exercises: [LocalDiamond.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md), [StateChannelCommon.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol.md)

## Overview

Deploys a local diamond and walks a one-hop proof from a trusted snapshot at 50 with
`verifyMilestonesFromTrustedStart`, the walk synchronization runs. A hop block at 51 that commits,
signed by both participants, a snapshot naming height 52 is invalid without a snapshot mismatch. The
same hop committing its own height is final.

## Tests

- `test_CN3_trustedStartWalkRejectsAHopSnapshotAtAnotherHeight`: REQ-SP-7-70EMAT.T2.P18, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P90
- `test_CN3_trustedStartWalkFinalizesAHopSnapshotAtItsBlocksHeight`: REQ-SP-7-70EMAT.T2.P19, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P91
