# StateChannelManagerProxyRegistration.t.sol

Test file: [test/V1/StateChannelDiamondProxy/StateChannelManagerProxyRegistration.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyRegistration.t.sol)
Exercises: [StateChannelManagerProxy.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md)

## Overview

The harness exercises constructor route registration directly. It proves duplicate registration
reverts with the full selector payload, a codeless route target reverts with the exact selector and
address, and a selector registered to a deployed `UtilityFacet` executes through the proxy.

## Tests

- `test_constructor_duplicateSelectorRegistration_reverts`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P29, REQ-CONTRACT-ARCH-4-FZ3CJE.T1.P5
- `test_constructor_codelessRouteTarget_reverts`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P32, REQ-CONTRACT-ARCH-4-FZ3CJE.T1.P7
- `test_routedSelector_executesOnFacet`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P33
