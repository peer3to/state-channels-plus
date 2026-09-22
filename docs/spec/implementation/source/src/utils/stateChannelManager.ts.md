# stateChannelManager.ts

> **Source:** [src/utils/stateChannelManager.ts](../../../../../../src/utils/stateChannelManager.ts)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../views/architecture/contracts/manager-and-facets.md)

## Requirements

- [`REQ-CONTRACT-ARCH-1-9W5390` (Stable external boundary)](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390)
  Partial: Runtime correctness remains owned by the contracts.

## UNIT-TEST-MANAGER-BINDING-1-WB503Z

Complete deployed-manager binding

- Setup: Build, extend, and serialize the manager ABI; connect with a null runner.
- Oracle: SDK calls/events/errors remain complete, consumer fragments survive, SDK duplicates win, and proxy/facet errors parse before and after JSON transport.

- [x] `UNIT-TEST-MANAGER-BINDING-1-WB503Z.P1` — exact functions/events
- [x] `UNIT-TEST-MANAGER-BINDING-1-WB503Z.P2` — exact error union
- [x] `UNIT-TEST-MANAGER-BINDING-1-WB503Z.P3` — all old proxy errors
- [x] `UNIT-TEST-MANAGER-BINDING-1-WB503Z.P4` — facet-only argument error
- [x] `UNIT-TEST-MANAGER-BINDING-1-WB503Z.P5` — JSON round trip parses proxy and facet errors
- [x] `UNIT-TEST-MANAGER-BINDING-1-WB503Z.P6` — null-runner binding
- [x] `UNIT-TEST-MANAGER-BINDING-1-WB503Z.P7` — deploy helper binding parses real proxy and facet reverts
- [x] `UNIT-TEST-MANAGER-BINDING-1-WB503Z.P8` — custom-RPC runtime preserves SDK and consumer ABI fragments on both manager bindings
- [x] `UNIT-TEST-MANAGER-BINDING-1-WB503Z.P9` — consumer-only fragments survive while duplicate SDK definitions win
- [x] `UNIT-TEST-MANAGER-BINDING-1-WB503Z.P10` — runtime client merges a consumer-only payload with SDK errors
