# FrontierPushedPartition.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierPushedPartition.ts](../../../../../../../../../../../src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierPushedPartition.ts)

## Requirements

- [`REQ-STPROOF-3-NVJGR0` (A pushed partition is accepted only as its proof decides it under its own header)](../../../../../../../../../specification/runtime/storage-proofs.md#req-stproof-3-nvjgr0)
- [`REQ-LC-9-KWXV43` (A read takes from the pushed partitions what they prove at its block)](../../../../../../../../../specification/runtime/light-client.md#req-lc-9-kwxv43)

## UNIT-TEST-STPROOF-8-F5SF0T

Holding the partition a Frontier node pushes to one subscription

- Setup: The five messages a peer3 dev node pushed to one subscription (a sync, three blocks of transactions, an empty block), with the node's own answers at each block; the same messages with one part changed or left out.
- Oracle: Each recorded message is accepted and the partition decides the node's own values and block values at its block; every changed message throws `StorageProofError` and leaves the partition holding nothing.

- [x] `UNIT-TEST-STPROOF-8-F5SF0T.P1` — every recorded message: the block identity and what the partition decides of the contract's slots and code and the sender's account equal the node's answers
- [x] `UNIT-TEST-STPROOF-8-F5SF0T.P2` — nothing held after the sync before the topic was logged; the reads and writes of the first transaction; a held slot another topic's transaction wrote
- [x] `UNIT-TEST-STPROOF-8-F5SF0T.P3` — the block values of each message's Ethereum header
- [x] `UNIT-TEST-STPROOF-8-F5SF0T.P4` — an account the held nodes do not reach, before any sync and after the last message
- [x] `UNIT-TEST-STPROOF-8-F5SF0T.P5` — a change before any sync
- [x] `UNIT-TEST-STPROOF-8-F5SF0T.P6` — a pushed value the proof decides otherwise; nothing held after; the next sync accepted
- [x] `UNIT-TEST-STPROOF-8-F5SF0T.P7` — a change without its new proof nodes
- [x] `UNIT-TEST-STPROOF-8-F5SF0T.P8` — the Ethereum header of another block
- [x] `UNIT-TEST-STPROOF-8-F5SF0T.P9` — a message of another shape
- [x] `UNIT-TEST-STPROOF-8-F5SF0T.P10` — the nodes no held key uses under the new root are dropped
