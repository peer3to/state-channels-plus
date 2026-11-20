# SubstrateHeader.test.ts

Test file: [test/unit/SubstrateHeader.test.ts](../../../../../../test/unit/SubstrateHeader.test.ts)
Exercises: [SubstrateHeader.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/SubstrateHeader.ts.md), [ScaleReader.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/ScaleReader.ts.md)

## Overview

The suite builds `SubstrateHeader` from three headers a peer3 dev node pushed and compares its
`hash` with the block hash that node reported (`chain_getBlockHash`) and its `ethereumBlockHash`
with the hash of the node's Ethereum block at that number. The refusals remove or repeat the
recorded Frontier digest log, or replace it with a hand-encoded log of the whole-block variant or
one that ends early, and shorten the state root. One declaration checks `encodeCompact` against
the SCALE specification's bytes on both sides of each size boundary. The suite does not cover
whether a header belongs to the chain.

## Tests

- `hashes each recorded header to the block hash its node reports`: REQ-STPROOF-3-NVJGR0.T1.P14, UNIT-TEST-STPROOF-3-W0K47W.P1
- `hashes to another value when the state root is changed`: UNIT-TEST-STPROOF-3-W0K47W.P2
- `reads the number and the state root of the header`: UNIT-TEST-STPROOF-3-W0K47W.P3
- `reads the Ethereum block hash Frontier wrote into each recorded digest`: REQ-STPROOF-3-NVJGR0.T1.P15, UNIT-TEST-STPROOF-3-W0K47W.P4
- `throws when the digest holds no Frontier log`: REQ-STPROOF-3-NVJGR0.T1.P12, UNIT-TEST-STPROOF-3-W0K47W.P5
- `throws when the digest holds two Frontier logs`: REQ-STPROOF-3-NVJGR0.T1.P13, UNIT-TEST-STPROOF-3-W0K47W.P6
- `throws when the Frontier log holds a whole block and no hash`: UNIT-TEST-STPROOF-3-W0K47W.P7
- `throws when the Frontier log ends before its hash`: UNIT-TEST-STPROOF-3-W0K47W.P8
- `reads the Ethereum block hash of a Frontier log that holds the hash alone`: UNIT-TEST-STPROOF-3-W0K47W.P10
- `throws when a hash of the header is not 32 bytes long`: UNIT-TEST-STPROOF-3-W0K47W.P9
- `encodes numbers as SCALE compact integers on both sides of each size boundary`: UNIT-TEST-STPROOF-5-4PSJRN.P1
