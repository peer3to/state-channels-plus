# StoredProofStorage.test.ts

Test file: [test/storage/StoredProofStorage.test.ts](../../../../../../test/storage/StoredProofStorage.test.ts)
Exercises: [StoredProofStorage](../../../../implementation/source/src/storage/StoredProofStorage.ts.md)

## Overview

Direct black-box cases on the stored-proof store, reached through the `Storage` facade so the copy-at-the-boundary
wiring is part of each case. Each record is a factory-built stored proof: an anchor snapshot, hops whose blocks commit
to their snapshots, and a final snapshot whose state hash matches the final state. The cases set and read a proof,
replace it on the same fork, set a proof of another fork and check that the earlier fork's proof is gone, read a fork
that is not stored, delete a fork's proof and another fork's, and mutate the value set and a value read.

## Tests

- `holds no stored proof before one is set`: UNIT-TEST-STORED-PROOF-STORAGE-1-RZH6SX.P1
- `returns the proof set for its fork`: UNIT-TEST-STORED-PROOF-STORAGE-1-RZH6SX.P2
- `replaces the proof of the same fork with the later one`: UNIT-TEST-STORED-PROOF-STORAGE-1-RZH6SX.P3
- `drops the previous fork's proof when a proof of another fork is set`: UNIT-TEST-STORED-PROOF-STORAGE-1-RZH6SX.P4, REQ-PROOFSTORE-1-V5KEYP.T1.P1
- `returns nothing for a fork other than the stored one`: UNIT-TEST-STORED-PROOF-STORAGE-1-RZH6SX.P5, REQ-PROOFSTORE-1-V5KEYP.T1.P2
- `keeps the stored proof unchanged when the caller mutates the value it set or read`: UNIT-TEST-STORED-PROOF-STORAGE-1-RZH6SX.P6
- `holds no stored proof for a fork after its proof is deleted`: UNIT-TEST-STORED-PROOF-STORAGE-1-RZH6SX.P7
- `keeps the stored proof when another fork's proof is deleted`: UNIT-TEST-STORED-PROOF-STORAGE-1-RZH6SX.P8
