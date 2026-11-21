# FrontierStorageProofVerifier.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierStorageProofVerifier.ts](../../../../../../../../../../../src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierStorageProofVerifier.ts)

## Requirements

- [`REQ-STPROOF-1-J20P5Y` (A slot value is accepted only when the proof decides it)](../../../../../../../../../specification/runtime/storage-proofs.md#req-stproof-1-j20p5y)
- [`REQ-STPROOF-2-ABCQR7` (One verifier per proof representation)](../../../../../../../../../specification/runtime/storage-proofs.md#req-stproof-2-abcqr7)

## UNIT-TEST-STPROOF-2-QT42T0

Proving contract slots of a Frontier chain

- Setup: Real read proofs of one contract's slots on a Frontier chain, the state root of their block and the values the chain's `eth_getStorageAt` returned at that block; a hand-encoded one-entry trie for the value length.
- Oracle: `provenStorage` returns the chain's values in the order asked and zero for a slot without an entry; it throws `StorageProofError` when a slot is not proven or its value is not 32 bytes, and refuses an address or slot of the wrong length.

- [x] `UNIT-TEST-STPROOF-2-QT42T0.P1` — a stored slot equals the chain's own read
- [x] `UNIT-TEST-STPROOF-2-QT42T0.P2` — a slot without an entry reads as zero
- [x] `UNIT-TEST-STPROOF-2-QT42T0.P3` — four slots from one shared proof, asked in another order than proven
- [x] `UNIT-TEST-STPROOF-2-QT42T0.P4` — a slot asked with the proof of another slot
- [x] `UNIT-TEST-STPROOF-2-QT42T0.P5` — two slots asked, one of them not proven: nothing returned
- [x] `UNIT-TEST-STPROOF-2-QT42T0.P6` — a 31-byte value refused, the same trie with a 32-byte value accepted
- [x] `UNIT-TEST-STPROOF-2-QT42T0.P7` — an address of 19 bytes
- [x] `UNIT-TEST-STPROOF-2-QT42T0.P8` — a slot of 31 bytes
- [x] `UNIT-TEST-STPROOF-2-QT42T0.P9` — two written slots and one never written, proven from a peer3 dev node's proof and equal to that node's own reads
- [x] `UNIT-TEST-STPROOF-2-QT42T0.P10` — a slot set back to zero on a peer3 dev node proves as zero at that block, and the earlier block's proof is refused for that block's state root
- [x] `UNIT-TEST-STPROOF-2-QT42T0.P11` — one byte in the middle of each node on the path of a slot changed
