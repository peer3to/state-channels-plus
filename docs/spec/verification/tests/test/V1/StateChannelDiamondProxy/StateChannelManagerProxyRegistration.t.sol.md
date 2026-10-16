# StateChannelManagerProxyRegistration.t.sol

Test file: [test/V1/StateChannelDiamondProxy/StateChannelManagerProxyRegistration.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyRegistration.t.sol)
Exercises: [StateChannelManagerProxy.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md)

## Overview

The harness exercises constructor route registration directly. It proves duplicate registration
reverts with the full selector payload, a codeless route target reverts with the exact selector and
address, and a selector registered to a deployed `UtilityFacet` executes through the proxy.
A shared `_deployUtilityProxy` helper deploys the utility-backed proxy for the constructor and
calldata-posting cases alike. The posting cases prove the canonical boundary: a trailing-word post
reverts with `ErrorNonCanonicalEncoding` and stores no commitment, while a canonical post stores the
signed-block/timestamp commitment, including a retry at a previously rejected key.

## Tests

- `test_constructor_duplicateSelectorRegistration_reverts`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P29, REQ-CONTRACT-ARCH-4-FZ3CJE.T1.P5
- `test_constructor_codelessRouteTarget_reverts`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P32, REQ-CONTRACT-ARCH-4-FZ3CJE.T1.P7
- `test_routedSelector_executesOnFacet`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P33
- `test_postBlockCalldata_rejectsNonCanonicalWithoutCommitment`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P21
- `test_postBlockCalldata_canonicalStoresCommitment`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P22
