# LightClientReplicatedReads.test.ts

Test file: [test/lightClient/LightClientReplicatedReads.test.ts](../../../../../../test/lightClient/LightClientReplicatedReads.test.ts)
Exercises: [LightClientRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/LightClientRpcProvider.ts.md), [DisputeBuilder.ts](../../../../implementation/source/src/disputeManager/DisputeBuilder.ts.md), [DisputeManager.ts](../../../../implementation/source/src/disputeManager/DisputeManager.ts.md)

## Overview

The suite runs four participants with the light client on over a peer3 slot node started with
`--light-client`, with every read the light client answers also asked of the node at the same block
(`LIGHT_CLIENT_COMPARE_READS`). One participant submits an invalid state transition; the others
dispute it, and the dispute reduces into a new fork. The oracles are the harness's dispute and
storage checks the Hardhat flow uses, the offender's on-chain slash, and each participant's read
comparison counters: reads were compared and none differed from the node's. It runs only with
`--lc-tests --parachain` and `PEER3_NODE_LIGHT_CLIENT=1`, and fails at once otherwise.

## Tests

- `reduces an invalid state transition dispute as the chain does, with no compared read differing from the node's`: REQ-MIRROR-6-0WSB4V.T3.P11
