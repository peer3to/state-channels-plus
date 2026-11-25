# StateChannelManagerProxyDeposit.t.sol

Test file: [test/V1/StateChannelDiamondProxy/StateChannelManagerProxyDeposit.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyDeposit.t.sol)
Exercises: [StateChannelCommon.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol.md), [StateChannelManagerProxy.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md)

## Overview

Seven Foundry tests deploy the full manager and replace the configured consumer address code
with a deterministic test adapter. A zero amount returns failure; a nonzero amount succeeds and
increments a storage counter in the manager's delegatecall context. The tests prove atomic rollback,
an all-succeeding batch's join messages and exact inbound totals, empty-batch rejection, and
`onlySelf` confinement. A fifth test opens a channel with the real consumer, then drives `joinChannel`
through the deployed diamond so the manager's own atomic deposit loop builds the failure payload
from a genuinely failing iteration. Revert cases also assert that no adapter effect or inbound
balance remains. A sixth test runs a real nonzero join through `joinChannel`, decodes the emitted
inbound block and asserts the chain finds it under the hash of that full block, the joiner is the
only pending participant and a copy of the block with altered JOIN data reads as uncommitted. A
seventh test runs one outsider join as setup, then records the state diff of a second outsider's
join, co-signed by Alice, Bob and the first joiner, and asserts it wrote exactly 5 fresh
(zero-to-nonzero) slots on the diamond: the inbound record's link, packed height and timestamp,
deposit total, joiners length and joiner.

## Tests

- `test_depositAssetsComposable_atomicFailureRollsBack`: INV-ENFADM-1-H53AQY.T1.P3, REQ-ENFADM-3-6A3BEB.T1.P1, UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P13
- `test_depositAssetsComposable_allSucceed_appendsOneJoinMessagePerDeposit`: REQ-ENFADM-3-6A3BEB.T1.P5, UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P36
- `test_depositAssetsComposable_emptyBatchRejected`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P16
- `test_depositAssetsComposable_directCallerRejected`: REQ-ENFADM-3-6A3BEB.T1.P4, UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P2
- `test_joinChannel_atomicDepositFailure_revertsNamingTheFailingJoin`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P35
- `test_joinChannel_recordsJoinerAsPendingUnderTheFullBlockHash`: INV-MSG-1-36Y41Q.T1.P15, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P79, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P80
- `test_joinChannel_writesFiveFreshSlots`: UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P81
