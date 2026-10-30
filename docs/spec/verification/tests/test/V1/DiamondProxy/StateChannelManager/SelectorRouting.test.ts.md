# SelectorRouting.test.ts

Test file: [test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/SelectorRouting.test.ts)
Exercises: [StateChannelManagerProxy.sol](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md)

## Overview

A Hardhat suite that reconciles the proxy's deployed selector routing, the facets' real compiled
ABIs and the `StateChannelManagerInterface` declarations against each other. One deployment from
`deployMathChannelProxyFixture` serves every case that touches the chain (the routing table is
immutable). The suite uses two kinds of oracle: the on-chain `facetAddressForSelector`, read
against the facet addresses and the consumer-facet address the fixture returns, and — for the
interface cases — pure ABI set comparison, with no deployment involved.

The first case also proves the deployed fixture consumes the single production `routedFacets`
inventory; only test-specific exclusions remain in the fixture.

The per-facet cases are exhaustive by construction rather than by enumeration: for each of the
eight routed facets the suite takes every `function` fragment of that facet's generated ABI,
subtracts the `notRouted` exclusions declared in `ProxySelectorRoutingFixture`, asserts the
remainder is non-empty, and requires each remaining selector to resolve to that facet's deployed
address. A facet function added, renamed or re-signed without a matching routing entry therefore
fails here — this is the drift-catcher for the compiler-derived routing table.

The three `notRouted` cases assert the other direction: each excluded function (each carrying a
written reason in the fixture — internal dispute steps, `LocalDiamond`-delegatecalled computation
helpers, and the stateless helpers `StateChannelCommon` calls on the facet directly) resolves to
the consumer facet, i.e. really is off the diamond's routed surface. Two further on-chain cases
cover the unknown-selector fallback of last resort and the proxy's own declared selectors being
absent from the table because they dispatch before the fallback.

Six cases have no on-chain oracle at all; they compare compiled ABIs. Selector uniqueness across
the facet ABIs, and shadowing — a routed facet selector the proxy also implements itself, which the
routing table would still report even though the proxy body dispatches first, making the routed
function unreachable. The remaining four hold `StateChannelManagerInterface` to the callable
surface (proxy-implemented plus routed): every callable is declared, nothing is declared that is
neither implemented nor routed, and each declaration repeats the implementing function's state
mutability and full signature. The mutability case is the one with caller-visible consequences:
ethers reads that field to choose between an `eth_call` and a transaction.

Everything here is address resolution or ABI comparison. No case executes a routed operation, so
nothing in this file is evidence for the operations' semantics, for revert-data propagation, or for the
"an unowned operation must not affect channel state" half of
`REQ-CONTRACT-ARCH-5-QT17P1` — an unrouted selector resolving to the integrator's consumer facet
is exactly what that clause leaves to the integrator. The specification-level routing permutations
(`REQ-CONTRACT-ARCH-1-9W5390.T1` and `REQ-CONTRACT-ARCH-5-QT17P1.T1`) all require invoking the
operations themselves, so none is assigned here; the evidence maps to the proxy's implementation
obligations instead.

## Tests

- `uses the canonical routed-facet inventory for every deployed facet`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P30
- `routes every dispute manager selector to the dispute manager facet`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P1
- `routes every dispute verification selector to the dispute verification facet`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P4
- `routes every fraud proof selector to the fraud proof facet`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P5
- `routes every dispute fraud proof selector to the dispute fraud proof facet`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P6
- `routes every state snapshot selector to the state snapshot facet`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P7
- `routes every join channel selector to the join channel facet`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P8
- `routes every state proof selector to the state proof facet`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P9
- `routes every utility view selector to the utility facet`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P17
- `routes both open-channel enumeration selectors through the utility facet`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P34
- `leaves the utility facet's stateless helpers off the routing table`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P18
- `leaves the dispute verification facet's internal steps off the routing table`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P19
- `leaves the fraud proof facet's internal step off the routing table`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P20
- `has no selector defined by two facets`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P21
- `has no routed facet selector shadowed by a proxy function`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P24
- `declares every proxy-owned and routed facet function on the interface`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P25
- `declares nothing the proxy neither implements nor routes`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P26
- `declares the implementing function's state mutability for every interface function`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P27
- `declares the implementing function's full signature for every interface function`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P28
- `resolves an unknown selector to the consumer facet`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P22
- `keeps the proxy's own selectors out of the routing table`: UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P23
