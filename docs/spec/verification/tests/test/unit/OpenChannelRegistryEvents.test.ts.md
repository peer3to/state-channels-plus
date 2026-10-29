# OpenChannelRegistryEvents.test.ts

Test file: [test/unit/OpenChannelRegistryEvents.test.ts](../../../../../../test/unit/OpenChannelRegistryEvents.test.ts)
Exercises: [StateChannelCommon.sol](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol.md)

## Overview

The artifact-backed manager binding opens two valid channels, queries `ChannelOpened`, and compares the ordered event-derived IDs with the proxy's count and paged registry. The Foundry lifecycle suite separately covers final-close event removal.

## Tests

- `reconstructs the opened set from ChannelOpened events and matches the paged registry`: UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P9
