# FraudProofStorage.test.ts

Test file: [test/unit/FraudProofStorage.test.ts](../../../../../../test/unit/FraudProofStorage.test.ts)
Exercises: [FraudProofStorage.ts](../../../../implementation/source/src/storage/FraudProofStorage.ts.md)

## Overview

Pure data-structure suite — no harness session. Constructs `FraudProofStorage` and
`DisputeFraudProofStorage` directly and drives them with real structs from the `fraudProof()` /
`disputeFraudProof()` factories (real signed blocks and a real `Codec`-encoded proof payload, not
placeholder bytes). Covers store/read by content hash, no-op re-store, and — the regression case for
`FIND-STORAGE-4-MFD7RZ` — that a re-store
under an existing hash with a _different_ `participant` leaves the original participant indexed and
never indexes the new one. `DisputeFraudProofStorage`'s already-compliant first-write-wins behavior is
proven alongside it to close the sibling half of the same requirement.

## Tests

- `stores a fraud proof and reads it back by content hash`: REQ-DSTORE-3-ZNXSTM.T1.P1, UNIT-TEST-FRAUD-PROOF-STORAGE-1-XJAHWS.P1
- `re-storing the identical proof is a no-op`: REQ-DSTORE-3-ZNXSTM.T1.P2, UNIT-TEST-FRAUD-PROOF-STORAGE-1-XJAHWS.P2
- `keeps the participant index consistent when the same encoded proof is re-stored under a different participant`: REQ-DSTORE-3-ZNXSTM.T1.P3, UNIT-TEST-FRAUD-PROOF-STORAGE-1-XJAHWS.P5
- `indexes multiple distinct proofs for one participant`: UNIT-TEST-FRAUD-PROOF-STORAGE-1-XJAHWS.P3
- `returns undefined for a participant with no stored proof`: UNIT-TEST-FRAUD-PROOF-STORAGE-1-XJAHWS.P4
- `DisputeFraudProofStorage: second proof for the same dispute is dropped`: REQ-DSTORE-3-ZNXSTM.T1.P4, REQ-DSTORE-3-ZNXSTM.T1.P5, REQ-DSTORE-3-ZNXSTM.T1.P6, UNIT-TEST-DISPUTE-FRAUD-PROOF-STORAGE-1-WFRDHK.P1, UNIT-TEST-DISPUTE-FRAUD-PROOF-STORAGE-1-WFRDHK.P2
