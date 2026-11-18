# LightClientPushedBlocks.test.ts

Test file: [test/lightClient/LightClientPushedBlocks.test.ts](../../../../../../test/lightClient/LightClientPushedBlocks.test.ts)
Exercises: [proveFrontierStorageBlock.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/proveFrontierStorageBlock.ts.md)

## Overview

Every declaration starts a peer3 dev node of its own from the binary `PEER3_NODE_BIN` names, with the
test-owned light client sidecar in front of it. The runner discovers the file only with `--lc-tests`.
Each declaration deploys a contract that stores what it is called with, subscribes to one topic, sends
transactions and checks the pushed block through `proveFrontierStorageBlock`. The oracles are what the
node itself reports: the receipt's block hash, `chain_getBlockHash` and the storage read at that block.
The suite does not cover a node that leaves a write out of a pushed block.

## Tests

- `proves the write of a block a live node pushed`: REQ-STPROOF-3-NVJGR0.T2.P1
- `proves every write of a live block in which one of two transactions logged the subscribed topic`: REQ-STPROOF-3-NVJGR0.T2.P2
- `proves a slot a live node pushed as cleared`: REQ-STPROOF-3-NVJGR0.T2.P3
