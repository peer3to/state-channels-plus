# test/V1/StateChannelDiamondProxy/StateChannelManagerProxyDeposit.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/StateChannelManagerProxyDeposit.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyDeposit.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateChannelManagerProxy.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Six direct Foundry tests deploy the full manager and replace the configured consumer address code
with a deterministic test adapter. A zero amount returns failure; a nonzero amount succeeds and
increments a storage counter in the manager's delegatecall context. The tests prove atomic rollback,
non-atomic filtering and exact inbound totals, all-failed and empty-batch rejection, and `onlySelf`
confinement. A sixth test opens a channel with the real consumer, then drives `joinChannel`
through the deployed diamond so the manager's own atomic deposit loop builds the failure payload
from a genuinely failing iteration. Revert cases also assert that no adapter effect or inbound
balance remains.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                   | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`test_depositAssetsComposable_atomicFailureRollsBack`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyDeposit.t.sol#L69) (line 69)                 | [`INV-ENFADM-1-H53AQY.T1.P3`](../../../../../specification/enforcement/admission-and-funds.md#inv-enfadm-1-h53aqy.t1.p3), [`REQ-ENFADM-3-6A3BEB.T1.P1`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-3-6a3beb.t1.p1), [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P13`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p13) |
| [`test_depositAssetsComposable_nonAtomicFiltersFailedDeposit`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyDeposit.t.sol#L83) (line 83)          | [`REQ-ENFADM-3-6A3BEB.T1.P2`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-3-6a3beb.t1.p2), [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P14`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p14)                                                                                                                           |
| [`test_depositAssetsComposable_allFailedRejected`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyDeposit.t.sol#L103) (line 103)                    | [`REQ-ENFADM-3-6A3BEB.T1.P3`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-3-6a3beb.t1.p3), [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P15`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p15)                                                                                                                           |
| [`test_depositAssetsComposable_emptyBatchRejected`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyDeposit.t.sol#L116) (line 116)                   | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P16`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p16)                                                                                                                                                                                                                                                     |
| [`test_depositAssetsComposable_directCallerRejected`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyDeposit.t.sol#L126) (line 126)                 | [`REQ-ENFADM-3-6A3BEB.T1.P4`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-3-6a3beb.t1.p4), [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P2`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p2)                                                                                                                             |
| [`test_joinChannel_atomicDepositFailure_revertsNamingTheFailingJoin`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyDeposit.t.sol#L137) (line 137) | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P35`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p35)                                                                                                                                                                                                                                                     |
