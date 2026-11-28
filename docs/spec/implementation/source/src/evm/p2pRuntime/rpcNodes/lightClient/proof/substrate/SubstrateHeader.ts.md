# SubstrateHeader.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/SubstrateHeader.ts](../../../../../../../../../../../src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/SubstrateHeader.ts)

## Requirements

- [`REQ-STPROOF-3-NVJGR0` (A pushed partition is accepted only as its proof decides it under its own header)](../../../../../../../../../specification/runtime/storage-proofs.md#req-stproof-3-nvjgr0)

## UNIT-TEST-STPROOF-3-W0K47W

Hash, state root and Ethereum block hash of a Substrate header

- Setup: Headers a peer3 dev node pushed, with the block hash and the Ethereum block hash that node reports for them; the same headers with digest logs removed, repeated or hand-encoded.
- Oracle: `hash` equals the node's block hash, `ethereumBlockHash` equals the node's Ethereum block hash, and a header without exactly one usable Frontier log or with a short hash throws `StorageProofError`.

- [x] `UNIT-TEST-STPROOF-3-W0K47W.P1` — three recorded headers hash to their node's block hashes
- [x] `UNIT-TEST-STPROOF-3-W0K47W.P2` — another state root gives another hash
- [x] `UNIT-TEST-STPROOF-3-W0K47W.P3` — number and state root as in the header
- [x] `UNIT-TEST-STPROOF-3-W0K47W.P4` — the Ethereum block hash of three recorded headers
- [x] `UNIT-TEST-STPROOF-3-W0K47W.P5` — no Frontier log in the digest
- [x] `UNIT-TEST-STPROOF-3-W0K47W.P6` — two Frontier logs in the digest
- [x] `UNIT-TEST-STPROOF-3-W0K47W.P7` — a Frontier log of the whole-block variant
- [x] `UNIT-TEST-STPROOF-3-W0K47W.P8` — a Frontier log that ends before its hash
- [x] `UNIT-TEST-STPROOF-3-W0K47W.P9` — a state root of 31 bytes
- [x] `UNIT-TEST-STPROOF-3-W0K47W.P10` — a Frontier log of the variant that holds the Ethereum block hash alone
- [x] `UNIT-TEST-STPROOF-3-W0K47W.P11` — a block number of `0x` and of `7`
- [x] `UNIT-TEST-STPROOF-3-W0K47W.P12` — a block number of `0x100000000` refused, of `0xffffffff` read
