# test/unit/OpenChannelRegistryEvents.test.ts — Test Report

> **Test file:** [test/unit/OpenChannelRegistryEvents.test.ts](../../../../../../test/unit/OpenChannelRegistryEvents.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [StateChannelCommon.sol](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol.md)

## Overview

The artifact-backed manager binding opens two valid channels, queries `ChannelOpened`, and compares the ordered event-derived IDs with the proxy's count and paged registry. The Foundry lifecycle suite separately covers final-close event removal.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                     | Covers                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`open-channel registry events > reconstructs the opened set from ChannelOpened events and matches the paged registry`](../../../../../../test/unit/OpenChannelRegistryEvents.test.ts#L13) (line 13) | [`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P9`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol.md#unit-test-open-channel-registry-1-kfdpm7.p9) |
