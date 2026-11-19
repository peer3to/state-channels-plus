# proveFrontierStorageBlock.test.ts

Test file: [test/unit/proveFrontierStorageBlock.test.ts](../../../../../../test/unit/proveFrontierStorageBlock.test.ts)
Exercises: [proveFrontierStorageBlock.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/proveFrontierStorageBlock.ts.md)

## Overview

The suite checks pushed blocks through `proveFrontierStorageBlock`. The blocks are recorded: a
peer3 dev node, behind the test-owned light client sidecar, pushed them to a subscriber of one
topic of a contract that stores what it is called with. One block has one write, one has two
writes by two transactions of which only one log carries the topic, and one sets a slot back to
zero. The positive oracles are the written values and the block identities the node reported. Each
refusal changes one part of a real block: a value, a cleared marker, the proof, the header, or a
log's block hash. The suite does not cover a write the node leaves out of a block, which no single
block can show.

## Tests

- `proves the write of a pushed block under the block's own header`: REQ-STPROOF-3-NVJGR0.T1.P1, UNIT-TEST-STPROOF-4-220T2R.P1
- `proves every write of a block, also of a slot no pushed log names`: REQ-STPROOF-3-NVJGR0.T1.P2, UNIT-TEST-STPROOF-4-220T2R.P2
- `proves a slot pushed as cleared to zero`: REQ-STPROOF-3-NVJGR0.T1.P3, UNIT-TEST-STPROOF-4-220T2R.P3
- `accepts a block that carries a log and no write`: REQ-STPROOF-3-NVJGR0.T1.P4, UNIT-TEST-STPROOF-4-220T2R.P4
- `throws when a pushed value differs from the proven one`: REQ-STPROOF-3-NVJGR0.T1.P5, UNIT-TEST-STPROOF-4-220T2R.P5
- `throws when a stored slot is pushed as cleared`: REQ-STPROOF-3-NVJGR0.T1.P6, UNIT-TEST-STPROOF-4-220T2R.P6
- `throws when a cleared slot is pushed with a value`: REQ-STPROOF-3-NVJGR0.T1.P7, UNIT-TEST-STPROOF-4-220T2R.P7
- `throws when the proof is left out`: REQ-STPROOF-3-NVJGR0.T1.P8, UNIT-TEST-STPROOF-4-220T2R.P8
- `throws when the block carries the header of another block`: REQ-STPROOF-3-NVJGR0.T1.P9, UNIT-TEST-STPROOF-4-220T2R.P9
- `throws when the proof belongs to another block's state root`: REQ-STPROOF-3-NVJGR0.T1.P10, UNIT-TEST-STPROOF-4-220T2R.P10
- `throws when a pushed log is of another Ethereum block`: REQ-STPROOF-3-NVJGR0.T1.P11, UNIT-TEST-STPROOF-4-220T2R.P11
- `throws a StorageProofError when a pushed slot is not 32 bytes long`: UNIT-TEST-STPROOF-4-220T2R.P13
- `throws a StorageProofError when a pushed value is not 32 bytes long`: UNIT-TEST-STPROOF-4-220T2R.P14
- `throws a StorageProofError when a proof node is not hex`: UNIT-TEST-STPROOF-4-220T2R.P15
- `throws a StorageProofError when a header field is not hex`: UNIT-TEST-STPROOF-4-220T2R.P16
- `throws a StorageProofError when a pushed log has no block hash`: UNIT-TEST-STPROOF-4-220T2R.P17
- `throws a StorageProofError when the pushed block is not an object`: UNIT-TEST-STPROOF-4-220T2R.P18
