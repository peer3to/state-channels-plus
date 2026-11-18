# proveFrontierStorageBlock.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/proveFrontierStorageBlock.ts](../../../../../../../../../../../src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/proveFrontierStorageBlock.ts)

## Requirements

- [`REQ-STPROOF-3-NVJGR0` (A pushed block is accepted only under its own header)](../../../../../../../../../specification/runtime/storage-proofs.md#req-stproof-3-nvjgr0)

## UNIT-TEST-STPROOF-4-220T2R

Checking a block a Frontier node pushed

- Setup: Three blocks a peer3 dev node pushed through the light client sidecar for one contract (one write, two writes with one matching log, one cleared slot), and the same blocks with one field changed or swapped between them.
- Oracle: A real block returns its writes as 32-byte values with its header and Ethereum block hash; every changed block throws `StorageProofError` and returns nothing.

- [x] `UNIT-TEST-STPROOF-4-220T2R.P1` — one write, with the header hash and Ethereum block hash the node reports
- [x] `UNIT-TEST-STPROOF-4-220T2R.P2` — two writes, one of a slot no pushed log names
- [x] `UNIT-TEST-STPROOF-4-220T2R.P3` — a slot pushed as cleared returns zero
- [x] `UNIT-TEST-STPROOF-4-220T2R.P4` — a log, no write and no proof
- [x] `UNIT-TEST-STPROOF-4-220T2R.P5` — a pushed value one off the proven one
- [x] `UNIT-TEST-STPROOF-4-220T2R.P6` — a stored slot pushed as cleared
- [x] `UNIT-TEST-STPROOF-4-220T2R.P7` — a cleared slot pushed with a value
- [x] `UNIT-TEST-STPROOF-4-220T2R.P8` — an empty proof
- [x] `UNIT-TEST-STPROOF-4-220T2R.P9` — the header of another block
- [x] `UNIT-TEST-STPROOF-4-220T2R.P10` — the proof of another block
- [x] `UNIT-TEST-STPROOF-4-220T2R.P11` — a log with another block's Ethereum hash
