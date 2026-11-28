# SubstrateTrieProof.test.ts

Test file: [test/unit/SubstrateTrieProof.test.ts](../../../../../../test/unit/SubstrateTrieProof.test.ts)
Exercises: [SubstrateTrieProof.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/SubstrateTrieProof.ts.md)

## Overview

The suite reads single keys through `SubstrateTrieProof.read`. Its positive oracles are real: read
proofs of the Wrapped GLMR contract on Moonbeam at one finalized block, with that block's state
root, a contract slot whose value the chain returned, a slot the chain stores nothing for, and the
contract's 80-byte account entry, which the state version 1 trie holds by hash. The refusal tests
on real data drop or alter each node of a slot's path in turn and swap the state root. Paths and
node shapes the real proofs do not reach use hand-encoded tries of one node, whose root is the hash
of that node: a branch with its own value and an inline child, a leaf, the empty trie, and five
malformed nodes. Every refusal asserts `StorageProofError` and its message. The suite does not
fetch proofs and does not cover how the state root is obtained.

## Tests

- `reads a value the trie holds inside its leaf`: UNIT-TEST-STPROOF-1-K1CTJZ.P1
- `reads a value the trie holds by hash`: REQ-STPROOF-2-ABCQR7.T1.P2, UNIT-TEST-STPROOF-1-K1CTJZ.P2
- `reads null for a key the proof shows to hold nothing`: UNIT-TEST-STPROOF-1-K1CTJZ.P3
- `reads null from the empty trie`: UNIT-TEST-STPROOF-1-K1CTJZ.P4
- `reads the value a branch holds where the key ends`: UNIT-TEST-STPROOF-1-K1CTJZ.P5
- `reads a value through a child its branch holds inside itself`: UNIT-TEST-STPROOF-1-K1CTJZ.P6
- `reads null where the key ends at a branch that holds no value`: UNIT-TEST-STPROOF-1-K1CTJZ.P7
- `reads null where a branch has no child for the key's next nibble`: UNIT-TEST-STPROOF-1-K1CTJZ.P8
- `reads null where a leaf's partial key differs from the key`: UNIT-TEST-STPROOF-1-K1CTJZ.P9
- `reads null where the key continues past a leaf`: UNIT-TEST-STPROOF-1-K1CTJZ.P10
- `reads null where the key ends inside a leaf's partial key`: UNIT-TEST-STPROOF-1-K1CTJZ.P11
- `throws when any node on the key's path is left out of the proof`: REQ-STPROOF-1-J20P5Y.T2.P3, UNIT-TEST-STPROOF-1-K1CTJZ.P12
- `throws when the bytes of any node on the key's path were changed`: REQ-STPROOF-1-J20P5Y.T2.P4, UNIT-TEST-STPROOF-1-K1CTJZ.P13
- `throws for a state root the proof does not lead to`: REQ-STPROOF-1-J20P5Y.T2.P5, UNIT-TEST-STPROOF-1-K1CTJZ.P14
- `throws when the node holding a hashed value is left out`: UNIT-TEST-STPROOF-1-K1CTJZ.P15
- `reads the value a branch holds by hash where the key ends`: UNIT-TEST-STPROOF-1-K1CTJZ.P21
- `throws when the node holding a branch's hashed value is left out`: UNIT-TEST-STPROOF-1-K1CTJZ.P22
- `reads a branch that holds its value by hash under a partial key of 16 nibbles`: UNIT-TEST-STPROOF-1-K1CTJZ.P23
- `throws on a node with an unknown header`: REQ-STPROOF-1-J20P5Y.T2.P7, UNIT-TEST-STPROOF-1-K1CTJZ.P16
- `throws on a node that ends before its announced content`: REQ-STPROOF-1-J20P5Y.T2.P8, UNIT-TEST-STPROOF-1-K1CTJZ.P17
- `throws on an odd partial key whose padding is not zero`: UNIT-TEST-STPROOF-1-K1CTJZ.P18
- `throws on a branch that has no child`: UNIT-TEST-STPROOF-1-K1CTJZ.P19
- `throws on a value length nothing can hold`: UNIT-TEST-STPROOF-1-K1CTJZ.P20
