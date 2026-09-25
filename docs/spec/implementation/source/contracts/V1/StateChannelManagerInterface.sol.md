# StateChannelManagerInterface.sol

> **Source:** [contracts/V1/StateChannelManagerInterface.sol](../../../../../../contracts/V1/StateChannelManagerInterface.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../views/architecture/contracts/architecture.md)

## Requirements

- [`REQ-CONTRACT-ARCH-1-9W5390` (Stable external boundary)](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390)
- [`REQ-CONTRACT-ARCH-5-QT17P1` (Complete operation ownership)](../../../../specification/enforcement/contracts.md#req-contract-arch-5-qt17p1)
  Partial: The grouping comments themselves are documentation only, and operations reachable through the consumer fallback are not listed here at all. Set equality with the deployed callable surface is checked by the routing test ([`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P25`](StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8), [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P26`](StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8)), not by the compiler.
- [`REQ-MSG-12-1RRB0W` (Anyone MUST be able to verify the balance invariant trustlessly for a claimed…)](../../../../specification/settlement/cross-layer-messages.md#req-msg-12-1rrb0w)
