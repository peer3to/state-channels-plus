# LightClientReproofBlocks.test.ts

Test file: [test/unit/LightClientReproofBlocks.test.ts](../../../../../../test/unit/LightClientReproofBlocks.test.ts)
Exercises: [RuntimeChainContext.ts](../../../../implementation/source/src/evm/p2pRuntime/RuntimeChainContext.ts.md), [config.ts](../../../../implementation/source/src/utils/config.ts.md)

## Overview

The suite builds the SDK's chain access with `createRpcNodesProvider`, the light client on and a
re-proof interval, over a local address nothing listens on. No node runs. The oracle is the error the
build fails with: an invalid interval is named before any connection is tried, and a valid one fails
later, on the unreachable endpoint. The suite does not cover what the interval does to a read.

## Tests

- `rejects an interval of zero blocks before any endpoint is tried`: REQ-LC-6-NEFA2N.T2.P1
- `rejects an interval that is not a whole number of blocks`: REQ-LC-6-NEFA2N.T2.P2
- `accepts an interval of one block and goes on to the endpoint`: REQ-LC-6-NEFA2N.T2.P3
