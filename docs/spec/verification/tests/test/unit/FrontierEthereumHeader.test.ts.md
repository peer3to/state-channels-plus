# FrontierEthereumHeader.test.ts

Test file: [test/unit/FrontierEthereumHeader.test.ts](../../../../../../test/unit/FrontierEthereumHeader.test.ts)
Exercises: [FrontierEthereumHeader.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierEthereumHeader.ts.md)

## Overview

The suite reads the Ethereum block header a Frontier chain's state holds through
`FrontierEthereumHeader`. The data is real: the `CurrentBlock` entry of one block of a peer3 dev node
(`zero-fee-node` at d845dbfb) as `state_getStorage` returned it, the read proof of that entry, the
block's state root, and the node's `eth_getBlockByNumber` answer for the block. The oracle is that
answer: the header must hash to the node's Ethereum block hash, which covers every field of the
header, and hold the node's block values. Refusals change one part of the recorded entry. The suite
does not cover how the entry reaches the participant.

## Tests

- `hashes a recorded header to the Ethereum block hash its node reports`: REQ-STPROOF-6-CASBQP.T1.P1, UNIT-TEST-STPROOF-7-GW2MTN.P1
- `reads the block values the node reports for the block`: REQ-STPROOF-6-CASBQP.T1.P2, UNIT-TEST-STPROOF-7-GW2MTN.P2
- `reads the timestamp in milliseconds, which the node reports in whole seconds`: REQ-STPROOF-6-CASBQP.T1.P3, UNIT-TEST-STPROOF-7-GW2MTN.P3
- `reads the recorded block from its proof under the block's state root`: REQ-STPROOF-6-CASBQP.T1.P4, UNIT-TEST-STPROOF-7-GW2MTN.P4
- `throws when the header is not of the named Ethereum block`: REQ-STPROOF-6-CASBQP.T1.P5, UNIT-TEST-STPROOF-7-GW2MTN.P5
- `hashes to another value when a block value is changed`: REQ-STPROOF-6-CASBQP.T1.P6, UNIT-TEST-STPROOF-7-GW2MTN.P6
- `reads the fields that follow a header's extra data`: REQ-STPROOF-6-CASBQP.T1.P7, UNIT-TEST-STPROOF-7-GW2MTN.P7
- `throws when the block ends inside its header`: REQ-STPROOF-6-CASBQP.T1.P8, UNIT-TEST-STPROOF-7-GW2MTN.P8
