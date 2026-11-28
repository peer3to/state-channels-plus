# SubstrateTrieProof.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/SubstrateTrieProof.ts](../../../../../../../../../../../src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/SubstrateTrieProof.ts)

## Requirements

- [`REQ-STPROOF-1-J20P5Y` (A slot value is accepted only when the proof decides it)](../../../../../../../../../specification/runtime/storage-proofs.md#req-stproof-1-j20p5y)
- [`REQ-STPROOF-2-ABCQR7` (One verifier per proof representation)](../../../../../../../../../specification/runtime/storage-proofs.md#req-stproof-2-abcqr7)

## UNIT-TEST-STPROOF-1-K1CTJZ

Reading one key from a Substrate read proof

- Setup: Real read proofs of a Frontier chain with a state version 1 trie, taken with the state root of their block; hand-encoded single-node tries for the paths and node shapes the real proofs do not reach.
- Oracle: `read` returns the stored bytes, returns `null` only where the nodes show the key holds nothing, and throws `StorageProofError` where the proof does not reach the key or a node is malformed.

- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P1` — a value held inside its leaf
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P2` — a value longer than 32 bytes, held by hash and read from its own proof node
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P3` — a key the real proof shows to hold nothing
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P4` — the empty trie
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P5` — a branch's own value where the key ends
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P6` — a child node held inside its branch
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P7` — the key ends at a branch without a value
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P8` — a branch has no child for the key's next nibble
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P9` — a leaf's partial key differs from the key
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P10` — the key continues past a leaf
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P11` — the key ends inside a leaf's partial key, with the full key read as the control
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P12` — each node of the path left out in turn
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P13` — each node of the path changed in its last byte in turn
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P14` — a state root the proof does not lead to
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P15` — the proof node of a hashed value left out
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P16` — a node with an unknown header
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P17` — a node that ends before its announced content
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P18` — an odd partial key whose padding nibble is not zero
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P19` — a branch with an empty child bitmap
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P20` — a value length in the big-integer compact form
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P24` — a value of 100 bytes a state version 0 leaf holds inline, its length in the two-byte form
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P25` — a proof of nodes the caller already keyed by their hash reads as the proof of the same nodes
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P26` — a node keyed by its caller under another hash than its own is not found: nodes already keyed are not hashed again
- [x] `UNIT-TEST-STPROOF-1-K1CTJZ.P27` — a proof given in place of nodes is used as it is
