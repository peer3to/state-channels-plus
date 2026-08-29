# test/V1/StateChannelDiamondProxy/StateChannelManagerProxyRegistration.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/StateChannelManagerProxyRegistration.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyRegistration.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateChannelManagerProxy.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The harness exercises constructor route registration directly. It proves duplicate registration
reverts with the full selector payload, a codeless route target reverts with the exact selector and
address, and a selector registered to a deployed `UtilityFacet` executes through the proxy.

## Tests and covered test IDs

| Test declaration                                                                                                                                                           | Covers                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`test_constructor_duplicateSelectorRegistration_reverts`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyRegistration.t.sol#L41) (line 41) | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P29`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p29), [`REQ-CONTRACT-ARCH-4-FZ3CJE.T1.P5`](../../../../../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje.t1.p5) |
| [`test_constructor_codelessRouteTarget_reverts`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyRegistration.t.sol#L51) (line 51)           | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P32`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p32), [`REQ-CONTRACT-ARCH-4-FZ3CJE.T1.P7`](../../../../../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje.t1.p7) |
| [`test_routedSelector_executesOnFacet`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyRegistration.t.sol#L77) (line 77)                    | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P33`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p33)                                                                                                                               |
