# StateChannelManagerProxyDeposit.t.sol

Test file: [test/V1/StateChannelDiamondProxy/StateChannelManagerProxyDeposit.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyDeposit.t.sol)
Exercises: [StateChannelManagerProxy.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md)

## Overview

Six direct Foundry tests deploy the full manager and replace the configured consumer address code
with a deterministic test adapter. A zero amount returns failure; a nonzero amount succeeds and
increments a storage counter in the manager's delegatecall context. The tests prove atomic rollback,
non-atomic filtering and exact inbound totals, all-failed and empty-batch rejection, and `onlySelf`
confinement. A sixth test opens a channel with the real consumer, then drives `joinChannel`
through the deployed diamond so the manager's own atomic deposit loop builds the failure payload
from a genuinely failing iteration. Revert cases also assert that no adapter effect or inbound
balance remains.

## Tests

- `test_depositAssetsComposable_atomicFailureRollsBack`: INV-ENFADM-1-H53AQY.T1.P3, REQ-ENFADM-3-6A3BEB.T1.P1, UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P13
- `test_depositAssetsComposable_nonAtomicFiltersFailedDeposit`: REQ-ENFADM-3-6A3BEB.T1.P2, UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P14
- `test_depositAssetsComposable_allFailedRejected`: REQ-ENFADM-3-6A3BEB.T1.P3, UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P15
- `test_depositAssetsComposable_emptyBatchRejected`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P16
- `test_depositAssetsComposable_directCallerRejected`: REQ-ENFADM-3-6A3BEB.T1.P4, UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P2
- `test_joinChannel_atomicDepositFailure_revertsNamingTheFailingJoin`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P35
