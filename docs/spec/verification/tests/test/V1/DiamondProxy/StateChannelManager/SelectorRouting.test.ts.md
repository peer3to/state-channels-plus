# test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts — Test Report

> **Test file:** [test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateChannelManagerProxy.sol](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A Hardhat suite that reconciles the proxy's deployed selector routing against the facets' real
compiled ABIs. One deployment from `deployMathChannelProxyFixture` serves every case (the routing
table is immutable), and the single oracle is `facetAddressForSelector`, read against the facet
addresses and the consumer-facet address the fixture returns.

The per-facet cases are exhaustive by construction rather than by enumeration: for each of the
eight routed facets the suite takes every `function` fragment of that facet's generated ABI,
subtracts the `notRouted` exclusions declared in `ProxySelectorRoutingFixture`, asserts the
remainder is non-empty, and requires each remaining selector to resolve to that facet's deployed
address. A facet function added, renamed or re-signed without a matching routing entry therefore
fails here — this is the drift-catcher for the compiler-derived routing table.

The three `notRouted` cases assert the other direction: each excluded function (each carrying a
written reason in the fixture — internal dispute steps, `LocalDiamond`-delegatecalled computation
helpers, and the stateless helpers `StateChannelCommon` calls on the facet directly) resolves to
the consumer facet, i.e. really is off the diamond's routed surface. The remaining three cases
cover selector uniqueness across facet ABIs, the unknown-selector fallback of last resort, and the
proxy's own declared selectors being absent from the table because they dispatch before the
fallback.

Everything here is address resolution. No case executes a routed operation, so nothing in this
file is evidence for the operations' semantics, for revert-data propagation, or for the
"an unowned operation must not affect channel state" half of
[`REQ-CONTRACT-ARCH-5-QT17P1`](../../../../../../specification/enforcement/contracts.md#req-contract-arch-5-qt17p1) — an unrouted selector resolving to the integrator's consumer facet
is exactly what that clause leaves to the integrator. The specification-level routing permutations
([`REQ-CONTRACT-ARCH-1-9W5390.T1`](../../../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390.t1) and [`REQ-CONTRACT-ARCH-5-QT17P1.T1`](../../../../../../specification/enforcement/contracts.md#req-contract-arch-5-qt17p1.t1)) all require invoking the
operations themselves, so none is assigned here; the evidence maps to the proxy's implementation
obligations instead.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                | Covers                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`StateChannelManagerProxy selector routing > routes every dispute manager selector to the dispute manager facet`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts#L32) (line 32)               | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P1`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p1)                       |
| [`StateChannelManagerProxy selector routing > routes every dispute verification selector to the dispute verification facet`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts#L40) (line 40)     | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P4`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p4)                       |
| [`StateChannelManagerProxy selector routing > routes every fraud proof selector to the fraud proof facet`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts#L48) (line 48)                       | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P5`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p5)                       |
| [`StateChannelManagerProxy selector routing > routes every dispute fraud proof selector to the dispute fraud proof facet`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts#L56) (line 56)       | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P6`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p6)                       |
| [`StateChannelManagerProxy selector routing > routes every state snapshot selector to the state snapshot facet`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts#L64) (line 64)                 | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P7`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p7)                       |
| [`StateChannelManagerProxy selector routing > routes every join channel selector to the join channel facet`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts#L72) (line 72)                     | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P8`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p8)                       |
| [`StateChannelManagerProxy selector routing > routes every state proof selector to the state proof facet`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts#L80) (line 80)                       | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P9`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p9)                       |
| [`StateChannelManagerProxy selector routing > routes every utility view selector to the utility facet`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts#L88) (line 88)                          | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P17`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p17)                     |
| [`StateChannelManagerProxy selector routing > leaves the utility facet's stateless helpers off the routing table`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts#L96) (line 96)                | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P18`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p18)                     |
| [`StateChannelManagerProxy selector routing > leaves the dispute verification facet's internal steps off the routing table`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts#L104) (line 104)   | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P19`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p19)                     |
| [`StateChannelManagerProxy selector routing > leaves the fraud proof facet's internal step off the routing table`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts#L112) (line 112)             | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P20`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p20)                     |
| [`StateChannelManagerProxy selector routing > has no selector defined by two facets`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts#L120) (line 120)                                          | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P21`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p21)                     |
| [`StateChannelManagerProxy selector routing > resolves an unknown selector to the consumer facet`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts#L129) (line 129)                             | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P22`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p22)                     |
| [`StateChannelManagerProxy selector routing > keeps the proxy's own selectors out of the routing table`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts#L138) (line 138)                       | [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P23`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p23)                     |
