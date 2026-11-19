# LightClientProvenReads.test.ts

Test file: [test/lightClient/LightClientProvenReads.test.ts](../../../../../../test/lightClient/LightClientProvenReads.test.ts)
Exercises: [FrontierProvenStateReader.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierProvenStateReader.ts.md)

## Overview

Every declaration starts a peer3 dev node of its own from the binary `PEER3_NODE_BIN` names. The
runner discovers the file only with `--lc-tests`. Each declaration reads through
`FrontierProvenStateReader` over a WebSocket to the node. The oracles are what the node itself
reports for the same block: `chain_getBlockHash`, the Ethereum block, `eth_getStorageAt`,
`eth_getCode`, `eth_getTransactionCount` and `eth_getBalance`. For the refusals the reader's socket
goes through a test-owned proxy that answers the next `state_getReadProof` or `chain_getHeader`
request in the node's place: with the node's real proof of an earlier block, with no proof, or with
no header. Each refusal is followed by the node's own answer being accepted where that applies. The
suite does not cover a node that gives a header of another chain.

## Tests

- `reads slots, code and accounts proven at the node's best block, equal to the node's own answers`: REQ-STPROOF-5-HRDXEG.T1.P1
- `reads a block's own state after the chain moved on`: REQ-STPROOF-5-HRDXEG.T1.P2
- `asks the node for no proof when a read asks nothing`: REQ-STPROOF-5-HRDXEG.T1.P3
- `throws when the node answers with the proof of another block`: REQ-STPROOF-5-HRDXEG.T1.P4
- `throws when the node answers a read with no proof`: REQ-STPROOF-5-HRDXEG.T1.P5
- `throws when the node answers no block header`: REQ-STPROOF-5-HRDXEG.T1.P6
