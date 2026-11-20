# FrontierAccountProofVerifier.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierAccountProofVerifier.ts](../../../../../../../../../../../src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierAccountProofVerifier.ts)

## Requirements

- [`REQ-STPROOF-4-XK5S64` (An account's nonce, balance and code are accepted only when the proof decides…)](../../../../../../../../../specification/runtime/storage-proofs.md#req-stproof-4-xk5s64)

## UNIT-TEST-STPROOF-6-QX77PX

Proving accounts and contract code of a Frontier chain

- Setup: Real read proofs of the account and code entries of five addresses on a peer3 dev node, the state root of their block and the node's own `eth_getTransactionCount`, `eth_getBalance` and `eth_getCode` answers at that block; hand-encoded one-entry tries for the balance rule and the entry lengths.
- Oracle: `provenAccount` and `provenCode` return the node's answers, zero and empty for an address without an entry, and the free balance less what the chain keeps back; they throw `StorageProofError` when the entry is not proven or has a wrong length, and refuse an address of the wrong length.

- [x] `UNIT-TEST-STPROOF-6-QX77PX.P1` — a funded account's nonce and balance equal the node's own answers
- [x] `UNIT-TEST-STPROOF-6-QX77PX.P2` — an address without an entry reads as nonce and balance zero
- [x] `UNIT-TEST-STPROOF-6-QX77PX.P3` — a contract's nonce of one and balance of zero
- [x] `UNIT-TEST-STPROOF-6-QX77PX.P4` — five accounts from one shared proof
- [x] `UNIT-TEST-STPROOF-6-QX77PX.P5` — nothing frozen: ten deposits free give nine
- [x] `UNIT-TEST-STPROOF-6-QX77PX.P6` — four deposits frozen of ten free give six
- [x] `UNIT-TEST-STPROOF-6-QX77PX.P7` — four deposits frozen against three, one and five reserved give nine, seven and nine
- [x] `UNIT-TEST-STPROOF-6-QX77PX.P8` — a free balance one below, at and one above the existential deposit gives zero, zero and one
- [x] `UNIT-TEST-STPROOF-6-QX77PX.P9` — an account asked with the proof of an address without an entry
- [x] `UNIT-TEST-STPROOF-6-QX77PX.P10` — an entry of 79 and of 81 bytes refused, the same trie with 80 bytes accepted
- [x] `UNIT-TEST-STPROOF-6-QX77PX.P11` — an address of 19 bytes, for the account and for the code
- [x] `UNIT-TEST-STPROOF-6-QX77PX.P12` — 16 bytes of code held inside the leaf equal the node's own answer
- [x] `UNIT-TEST-STPROOF-6-QX77PX.P13` — 48 bytes of code held by hash equal the node's own answer
- [x] `UNIT-TEST-STPROOF-6-QX77PX.P14` — an account with an entry and an address without one both read as empty code
- [x] `UNIT-TEST-STPROOF-6-QX77PX.P15` — the code of two contracts and of an account without code from one shared proof
- [x] `UNIT-TEST-STPROOF-6-QX77PX.P16` — code asked with the proof of an address without an entry
- [x] `UNIT-TEST-STPROOF-6-QX77PX.P17` — the proof node that carries the 48 bytes of code left out
- [x] `UNIT-TEST-STPROOF-6-QX77PX.P18` — code announced as five and as two bytes with three present refused, the same trie announced as three accepted
