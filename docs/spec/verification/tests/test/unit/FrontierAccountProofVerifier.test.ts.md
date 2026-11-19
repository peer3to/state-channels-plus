# FrontierAccountProofVerifier.test.ts

Test file: [test/unit/FrontierAccountProofVerifier.test.ts](../../../../../../test/unit/FrontierAccountProofVerifier.test.ts)
Exercises: [FrontierAccountProofVerifier.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierAccountProofVerifier.ts.md)

## Overview

The suite proves accounts and contract code through `FrontierAccountProofVerifier.provenAccount` and
`provenCode`. The data is real: read proofs recorded from a peer3 dev node (`zero-fee-node` at
d845dbfb) of the account and code entries of five addresses at one block, that block's state root,
and the node's own `eth_getTransactionCount`, `eth_getBalance` and `eth_getCode` answers at that
block. The addresses are the account that sent the transactions, a contract with 16 bytes of code, a
contract with 48 bytes of code that the trie holds by hash, an account that only received a transfer,
and an address without any entry. The oracle for a proven value is equality with the node's own
answer, which also checks the trie keys and the balance rule against the chain. The balance rule and
the entry lengths use hand-encoded one-entry tries, each with an accepted control. Refusals use the
proof of an address without an entry to ask for another address, and the proof of the larger contract
without the node that carries its code. The suite does not cover how the state root or the proof
reach the participant.

## Tests

- `proves a funded account's nonce and balance to the node's own answers`: REQ-STPROOF-4-XK5S64.T1.P1, UNIT-TEST-STPROOF-6-QX77PX.P1
- `proves an address the chain holds nothing for as nonce and balance zero`: REQ-STPROOF-4-XK5S64.T1.P2, UNIT-TEST-STPROOF-6-QX77PX.P2
- `proves a contract's nonce and its zero balance to the node's own answers`: REQ-STPROOF-4-XK5S64.T1.P3, UNIT-TEST-STPROOF-6-QX77PX.P3
- `proves several accounts from one shared proof`: REQ-STPROOF-4-XK5S64.T1.P4, UNIT-TEST-STPROOF-6-QX77PX.P4
- `keeps back the existential deposit of a balance nothing is frozen of`: REQ-STPROOF-4-XK5S64.T2.P1, UNIT-TEST-STPROOF-6-QX77PX.P5
- `keeps back a frozen balance that exceeds the existential deposit`: REQ-STPROOF-4-XK5S64.T2.P2, UNIT-TEST-STPROOF-6-QX77PX.P6
- `counts a freeze against the reserved balance before the free balance`: REQ-STPROOF-4-XK5S64.T2.P3, UNIT-TEST-STPROOF-6-QX77PX.P7
- `proves a free balance of no more than what is kept back as zero`: REQ-STPROOF-4-XK5S64.T2.P4, UNIT-TEST-STPROOF-6-QX77PX.P8
- `throws for an account the proof was not built for`: REQ-STPROOF-4-XK5S64.T3.P1, UNIT-TEST-STPROOF-6-QX77PX.P9
- `throws when the proven account is not as long as an account entry`: REQ-STPROOF-4-XK5S64.T3.P2, UNIT-TEST-STPROOF-6-QX77PX.P10
- `refuses an address that is not 20 bytes`: REQ-STPROOF-4-XK5S64.T3.P3, UNIT-TEST-STPROOF-6-QX77PX.P11
- `proves code the trie holds inside its leaf to the node's own eth_getCode`: REQ-STPROOF-4-XK5S64.T1.P5, UNIT-TEST-STPROOF-6-QX77PX.P12
- `proves code the trie holds by hash to the node's own eth_getCode`: REQ-STPROOF-4-XK5S64.T1.P6, UNIT-TEST-STPROOF-6-QX77PX.P13
- `proves an account the chain holds no code for as empty`: REQ-STPROOF-4-XK5S64.T1.P7, UNIT-TEST-STPROOF-6-QX77PX.P14
- `proves the code of several contracts from one shared proof`: REQ-STPROOF-4-XK5S64.T1.P8, UNIT-TEST-STPROOF-6-QX77PX.P15
- `throws for code the proof was not built for`: REQ-STPROOF-4-XK5S64.T3.P4, UNIT-TEST-STPROOF-6-QX77PX.P16
- `throws when the proof node that carries hashed code is left out`: REQ-STPROOF-4-XK5S64.T3.P5, UNIT-TEST-STPROOF-6-QX77PX.P17
- `throws when the proven code is not as long as it announces`: REQ-STPROOF-4-XK5S64.T3.P6, UNIT-TEST-STPROOF-6-QX77PX.P18
