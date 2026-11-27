# ProofEvidenceStorage.ts

> **Source:** [src/storage/ProofEvidenceStorage.ts](../../../../../../src/storage/ProofEvidenceStorage.ts)

## Requirements

- [`REQ-PROOFSTORE-7-B5PW2P` (Proof evidence outside block history)](../../../../specification/storage/proof-store.md#req-proofstore-7-b5pw2p)

## UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D

Audit and sync proof evidence, with a per-fork bound on sync evidence only

- Setup: Set and read factory-built proof evidence (a stored proof, a latest snapshot and its state) through the `Storage` facade with bounds of one and two sync records per fork and a recording logger; set audit evidence by dispute hash and sync evidence keyed by its proof's finalized snapshot, on one and two forks; fill a fork to the bound, then set one more sync record, a replacement and audit records; drop a fork; mutate the value set and a value read; look up snapshots and states by hash, also through the facade.
- Oracle: Audit evidence reads back under `dispute:<disputeHash>` and sync evidence under `sync:<finalizedSnapshotHash>`; a set at an existing key replaces the record, also at the bound; a new sync record on a fork at the bound is refused with `undefined`, one warning naming the fork, key and bound, and no earlier record evicted; another fork's sync record and every audit record are accepted and not counted; a fork scan returns exactly that fork's audit and sync records; dropping a fork removes all its records, keeps other forks' records and frees its bound; caller mutations never reach a stored record; a lookup returns the record's snapshot or held state with that hash, nothing for an unknown hash, a dropped fork or a `0x` state; the facade returns held data first, else evidence.

- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P1` — nothing is stored before the first set
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P2` — audit evidence reads back under its dispute key
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P3` — sync evidence reads back under its proof's finalized snapshot key
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P4` — later audit evidence of the same dispute replaces the earlier one
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P5` — sync evidence of the same finalized snapshot replaces the earlier one at the bound, without a refusal
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P6` — a new sync record on a fork at the bound is refused and logged, and no earlier record is evicted
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P7` — the bound is per fork: a full fork does not refuse another fork's sync record
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P8` — audit evidence is not counted toward the sync bound
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P9` — audit evidence is never refused or evicted when the fork's sync evidence is at the bound
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P10` — audit and sync keys do not collide when the dispute hash equals the finalized snapshot hash
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P11` — a fork scan returns every audit and sync record of that fork and none of another fork
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P12` — dropping a fork removes its audit and sync records and keeps another fork's
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P13` — after a fork is dropped its sync bound is free again
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P14` — mutating the value set or a value read leaves the stored evidence unchanged
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P15` — each snapshot a record holds (anchor, hops, final, latest) is found by its hash
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P16` — no snapshot is found for an unknown hash or after its fork is dropped
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P17` — the final and latest held states are found by their hashes
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P18` — a `0x` (not held) state is never returned
- [x] `UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P19` — the storage facade reads a snapshot and state kept only as evidence
