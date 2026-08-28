# test/V1/StateChannelDiamondProxy/StateChannelManagerProxyRegistration.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/StateChannelManagerProxyRegistration.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyRegistration.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateChannelManagerProxy.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The harness completes the real 15-argument proxy constructor with ten distinct non-zero addresses
and five zero config values, then registers `DisputeManagerFacet.uploadDispute.selector` a second
time. Deployment must revert with the full `ErrorDuplicateSelectorRegistration(selector)` payload.
A second deployment configures that selector to address zero while keeping a non-zero consumer and
proves the configured route returns zero instead of falling through.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                 | Covers                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`test_constructor_duplicateSelectorRegistration_reverts`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyRegistration.t.sol#L34) (line 34)       | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P29`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p29), [`REQ-CONTRACT-ARCH-4-FZ3CJE.T1.P5`](../../../../../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje.t1.p5) |
| [`test_facetAddressForSelector_configuredZeroFacet_returnsZero`](../../../../../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyRegistration.t.sol#L43) (line 43) | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P31`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p31)                                                                                                                               |
