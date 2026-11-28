# LightClientPushedPartitions.test.ts

Test file: [test/lightClient/LightClientPushedPartitions.test.ts](../../../../../../test/lightClient/LightClientPushedPartitions.test.ts)
Exercises: [FrontierPushedPartition.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierPushedPartition.ts.md)

## Overview

The suite runs a peer3 node of its own with `--light-client`, subscribes over a socket to channel
topics of a contract that reads one slot, writes another and logs the topic, and sends transactions. It
checks what the node pushes with the SDK's own partition check: every message must be accepted, in
block order, and decide the node's own answers at its block. It runs only with `--lc-tests`.

## Tests

- `syncs a partition before its topic is logged and then pushes what the topic's transaction read and wrote, proven`: REQ-STPROOF-3-NVJGR0.T2.P5
- `pushes a held key another topic's transaction wrote`: REQ-STPROOF-3-NVJGR0.T2.P6
- `pushes every best block in order, a block that changed nothing of the partition with no values`: REQ-STPROOF-3-NVJGR0.T2.P7
- `syncs a later subscriber to the partition an earlier one holds`: REQ-STPROOF-3-NVJGR0.T2.P8
- `pushes a subscription the partitions of all of its topics`: REQ-STPROOF-3-NVJGR0.T2.P9
- `stops pushing to a subscription once it is unsubscribed`: REQ-STPROOF-3-NVJGR0.T2.P10
