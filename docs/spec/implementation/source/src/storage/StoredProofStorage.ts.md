# StoredProofStorage.ts

> **Source:** [src/storage/StoredProofStorage.ts](../../../../../../src/storage/StoredProofStorage.ts)

No specified behavior: the stored-proof requirements are not yet in the specification.

## UNIT-TEST-STORED-PROOF-STORAGE-1-RZH6SX

One stored proof, for the active fork only

- Setup: Set and read factory-built stored proofs (anchor, hops with their snapshots, final snapshot and state) through the `Storage` facade, on one fork and on two forks; delete a fork's proof; mutate the value handed in and the value read back.
- Oracle: A read returns the last proof set for that fork; a proof of another fork drops the earlier fork's proof; a read of an absent fork returns nothing; a delete removes only that fork's proof; caller mutations never reach the stored proof.

- [x] `UNIT-TEST-STORED-PROOF-STORAGE-1-RZH6SX.P1` — nothing is stored before the first set
- [x] `UNIT-TEST-STORED-PROOF-STORAGE-1-RZH6SX.P2` — a set proof is read back for its fork
- [x] `UNIT-TEST-STORED-PROOF-STORAGE-1-RZH6SX.P3` — a later proof of the same fork replaces the earlier one
- [x] `UNIT-TEST-STORED-PROOF-STORAGE-1-RZH6SX.P4` — a proof of another fork drops the earlier fork's proof
- [x] `UNIT-TEST-STORED-PROOF-STORAGE-1-RZH6SX.P5` — a read of a fork other than the stored one returns nothing
- [x] `UNIT-TEST-STORED-PROOF-STORAGE-1-RZH6SX.P6` — mutating the value set or a value read leaves the stored proof unchanged
- [x] `UNIT-TEST-STORED-PROOF-STORAGE-1-RZH6SX.P7` — a deleted fork's proof is no longer read
- [x] `UNIT-TEST-STORED-PROOF-STORAGE-1-RZH6SX.P8` — a delete of another fork leaves the stored proof
