# LightClientReadComparison.test.ts

Test file: [test/lightClient/LightClientReadComparison.test.ts](../../../../../../test/lightClient/LightClientReadComparison.test.ts)
Exercises: [LightClientRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/LightClientRpcProvider.ts.md)

## Overview

Every declaration starts a peer3 dev node of its own, with the light client endpoints, and builds the
SDK's chain access over a proxy to it with `LIGHT_CLIENT_COMPARE_READS` set. The reads go through the
chain access as the runtime makes them. The oracles are the provider's comparison counts, the
requests the proxy saw (each compared read names its block by hash), the read's own answer, and the
logged errors and warnings. The proxy answers a compared call with another value, or fails a compared
read, to make the endpoint disagree or give no answer.

## Tests

- `asks the node each read it answers at the block that proved it, and finds them alike, a revert included`: REQ-LC-11-MTCBF9.T1.P1
- `logs an error and counts a read the node answers otherwise at the same block, and keeps the proven answer`: REQ-LC-11-MTCBF9.T1.P2
- `counts a read the node gives no answer to at that block as not compared, with a warning`: REQ-LC-11-MTCBF9.T1.P3
