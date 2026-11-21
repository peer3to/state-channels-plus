# FrontierStorageProofVerifier.test.ts

Test file: [test/unit/FrontierStorageProofVerifier.test.ts](../../../../../../test/unit/FrontierStorageProofVerifier.test.ts)
Exercises: [FrontierStorageProofVerifier.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierStorageProofVerifier.ts.md)

## Overview

The suite proves contract slots through `FrontierStorageProofVerifier.provenStorage`. The data is
real: read proofs of four slots of the Wrapped GLMR contract on Moonbeam at one finalized block,
that block's state root, and the values the chain's `eth_getStorageAt` returned for the same slots
at the same block. Two slots hold a value and two have no entry. The oracle for a proven slot is
equality with the chain's own read, which also checks the trie key the verifier derives. Refusals
use the proof of one slot to ask for another, and a hand-encoded one-entry trie whose value is 31
bytes, with the same trie at 32 bytes accepted as the control. Two declarations use proofs recorded
from a peer3 dev node (`zero-fee-node` at d845dbfb) for a contract that stores what it is called
with: one block after two slots were written, and a later block after one of them was set back to
zero. The suite does not cover how the state root or the proof reach the participant.

## Tests

- `proves a stored slot to the value the chain's eth_getStorageAt returned`: REQ-STPROOF-1-J20P5Y.T1.P1, REQ-STPROOF-2-ABCQR7.T1.P1, UNIT-TEST-STPROOF-2-QT42T0.P1
- `proves a slot the chain stores no entry for as zero`: REQ-STPROOF-1-J20P5Y.T1.P2, UNIT-TEST-STPROOF-2-QT42T0.P2
- `proves several slots from one shared proof, in the order asked`: REQ-STPROOF-1-J20P5Y.T1.P3, UNIT-TEST-STPROOF-2-QT42T0.P3
- `throws for a slot the proof was not built for`: REQ-STPROOF-1-J20P5Y.T2.P1, UNIT-TEST-STPROOF-2-QT42T0.P4
- `throws when one of several slots is not proven`: REQ-STPROOF-1-J20P5Y.T2.P2, UNIT-TEST-STPROOF-2-QT42T0.P5
- `throws when the proven value is not 32 bytes long`: REQ-STPROOF-1-J20P5Y.T2.P6, UNIT-TEST-STPROOF-2-QT42T0.P6
- `refuses an address that is not 20 bytes`: REQ-STPROOF-2-ABCQR7.T1.P3, UNIT-TEST-STPROOF-2-QT42T0.P7
- `refuses a slot that is not 32 bytes`: REQ-STPROOF-2-ABCQR7.T1.P4, UNIT-TEST-STPROOF-2-QT42T0.P8
- `proves slots written on a peer3 dev node to the node's own reads`: UNIT-TEST-STPROOF-2-QT42T0.P9
- `proves a slot cleared on a peer3 dev node as zero, and not with the proof of the block before`: UNIT-TEST-STPROOF-2-QT42T0.P10
- `throws when one byte of any node on the slot's path was changed`: REQ-STPROOF-1-J20P5Y.T2.P9, UNIT-TEST-STPROOF-2-QT42T0.P11
