# FrontierPushedPartition.test.ts

Test file: [test/unit/FrontierPushedPartition.test.ts](../../../../../../test/unit/FrontierPushedPartition.test.ts)
Exercises: [FrontierPushedPartition.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierPushedPartition.ts.md)

## Overview

The suite replays what a peer3 dev node with `--light-client` pushed to one subscription, recorded on
2026-11-20: a sync before the topic was logged, three blocks of transactions and an empty block, with
the node's own answers at each block (block hash, Ethereum block, the contract's slots and code, the
sender's balance and nonce). The oracle is those answers: what the partition decides must equal them,
and its block values must equal the node's Ethereum block. Refusals change or leave out one part of a
recorded message. The suite needs no node, so it runs in the normal CI tier.

## Tests

- `holds the node's own slot values, account and code at every pushed block`: REQ-STPROOF-3-NVJGR0.T1.P17, UNIT-TEST-STPROOF-8-F5SF0T.P1
- `holds what the followed topic's transactions touched, and the value another topic's transaction wrote to it`: REQ-STPROOF-3-NVJGR0.T1.P18, UNIT-TEST-STPROOF-8-F5SF0T.P2
- `takes the block values a call reads from the Ethereum header the push carries`: REQ-STPROOF-3-NVJGR0.T1.P19, UNIT-TEST-STPROOF-8-F5SF0T.P3
- `leaves to the node what the held proof does not reach`: REQ-STPROOF-3-NVJGR0.T1.P20, UNIT-TEST-STPROOF-8-F5SF0T.P4
- `refuses a change to a partition it never synced`: REQ-STPROOF-3-NVJGR0.T1.P21, UNIT-TEST-STPROOF-8-F5SF0T.P5
- `refuses a pushed value the proof decides otherwise, and holds nothing until the next sync`: REQ-STPROOF-3-NVJGR0.T1.P22, UNIT-TEST-STPROOF-8-F5SF0T.P6
- `refuses a change whose new proof nodes do not reach the held keys`: REQ-STPROOF-3-NVJGR0.T1.P23, UNIT-TEST-STPROOF-8-F5SF0T.P7
- `refuses an Ethereum header that is not the block the header's digest names`: REQ-STPROOF-3-NVJGR0.T1.P24, UNIT-TEST-STPROOF-8-F5SF0T.P8
- `refuses a message that is no pushed storage block`: REQ-STPROOF-3-NVJGR0.T1.P25, UNIT-TEST-STPROOF-8-F5SF0T.P9
- `refuses a message without the node's stages and holds nothing until the next sync, and hands on the stages of one it accepts`: REQ-STPROOF-3-NVJGR0.T1.P27, UNIT-TEST-STPROOF-8-F5SF0T.P11
- `keeps only the proof nodes the held keys use under the new root`: REQ-STPROOF-3-NVJGR0.T1.P26, UNIT-TEST-STPROOF-8-F5SF0T.P10
- `ignores a change of the block it holds, and refuses one of an earlier block and holds nothing until the next sync`: REQ-STPROOF-3-NVJGR0.T1.P28, UNIT-TEST-STPROOF-8-F5SF0T.P12
