# FrontierProvenStateReader.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierProvenStateReader.ts](../../../../../../../../../../../src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierProvenStateReader.ts)

## Requirements

- [`REQ-STPROOF-5-HRDXEG` (A read from a node yields only what its proof decides, at one block)](../../../../../../../../../specification/runtime/storage-proofs.md#req-stproof-5-hrdxeg)
- [`REQ-STPROOF-6-CASBQP` (The block values a call reads are accepted only as the block commits to them)](../../../../../../../../../specification/runtime/storage-proofs.md#req-stproof-6-casbqp)
- [`REQ-STPROOF-3-NVJGR0` (A pushed block is accepted only under its own header)](../../../../../../../../../specification/runtime/storage-proofs.md#req-stproof-3-nvjgr0)
