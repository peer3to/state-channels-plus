# LocalDiamondInboundMirror.t.sol

Test file: [test/V1/StateChannelDiamondProxy/LocalDiamondInboundMirror.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/LocalDiamondInboundMirror.t.sol)
Exercises: [LocalDiamond.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md)

## Overview

Deploys a local diamond and applies two linked inbound blocks through `onInboundMessagesProcessed`.
Applying the older block and the head block again does not revert and leaves the inbound head, its
height and the deposit total at the head block. Applying the older block after the newer one stores
it, and the head and deposit total stay at the newer block.

## Tests

- `test_onInboundMessagesProcessed_storedBlockAgain_isNoOp`: UNIT-TEST-LOCAL-DIAMOND-1-PJE47M.P4, REQ-MIRROR-2-E9F3TM.T1.P4
- `test_onInboundMessagesProcessed_olderBlockAfterNewer_storesItWithoutMovingTheHeadBack`: UNIT-TEST-LOCAL-DIAMOND-1-PJE47M.P5, REQ-MIRROR-2-E9F3TM.T1.P5
