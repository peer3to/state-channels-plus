# ProofEvidenceStorage.test.ts

Test file: [test/storage/ProofEvidenceStorage.test.ts](../../../../../../test/storage/ProofEvidenceStorage.test.ts)
Exercises: [ProofEvidenceStorage](../../../../implementation/source/src/storage/ProofEvidenceStorage.ts.md)

## Overview

Direct black-box cases on the proof evidence store, reached through the `Storage` facade so the copy-at-the-boundary
wiring and the injected bound and logger are part of each case. Each record is factory-built proof evidence: a stored
proof whose hop blocks commit to their snapshots, and a latest snapshot whose state hash matches the latest state. The
expected keys are written from the store design (`dispute:<disputeHash>`, `sync:<finalizedSnapshotHash>`), and the
refusal warning is read back from a real node logger's log store. The cases set and read audit and sync evidence,
replace records, fill a fork to its sync bound and set one more sync record, a replacement, another fork's record and
audit records, use one hash as both a dispute hash and a finalized snapshot hash, scan a fork, drop a fork and refill
it, and mutate the value set and a value read. The lookup cases find every snapshot and held state of a record by a
hash computed from the record itself, miss an unknown hash and a dropped fork's snapshot, never return a `0x` state
(also for the hash of `0x`), and read a snapshot and state through the `Storage` facade that holds them only as
evidence. The signing-stop cases stop signing on factory forks, write a refused and an accepted
record on the stopped fork, drop another fork or the stopped fork, and read the `Storage` facade's
combined stop with own dispute markers set and rolled back.

## Tests

- `holds no evidence before any is set`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P1
- `returns the audit evidence set for its dispute under the dispute key`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P2
- `returns the sync evidence set under its proof's finalized snapshot key`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P3
- `replaces the audit evidence of the same dispute with the later one`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P4
- `replaces the sync evidence of the same finalized snapshot even when the fork is at the bound`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P5
- `refuses a new sync record once its fork holds the maximum and logs the refusal`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P6, REQ-PROOFSTORE-7-B5PW2P.T1.P1
- `bounds sync evidence per fork, so a full fork does not refuse another fork's record`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P7
- `does not count audit evidence toward the sync bound`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P8
- `never refuses or evicts audit evidence when the fork's sync evidence is at the bound`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P9, REQ-PROOFSTORE-7-B5PW2P.T1.P2
- `keeps audit and sync evidence apart when the dispute hash equals the finalized snapshot hash`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P10
- `returns every audit and sync record of a fork and none of another fork`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P11
- `returns only the audit records of a fork as its audit evidence: its sync records and another fork's audit records are left out`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P20
- `drops a fork's audit and sync evidence and keeps another fork's`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P12, REQ-PROOFSTORE-7-B5PW2P.T1.P3
- `accepts sync evidence of a dropped fork again up to the bound`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P13
- `keeps stored evidence unchanged when the caller mutates the value it set or read`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P14
- `finds each snapshot a record holds by its hash: the anchor, every hop's, the final point and the latest point`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P15
- `finds no snapshot for a hash no record holds, nor one of a dropped fork`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P16
- `finds the final and the latest state a record holds by their hashes`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P17
- `never returns a state a record does not hold (0x), also for the hash of 0x`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P18, REQ-PROOFSTORE-7-B5PW2P.T1.P4
- `storage reads a snapshot and a state kept only as proof evidence`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P19
- `stops signing only on the fork it was stopped on`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P21, REQ-PROOFSTORE-7-B5PW2P.T1.P7
- `never lifts a signing stop when the fork's evidence is written or another fork is dropped`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P22, REQ-PROOFSTORE-7-B5PW2P.T1.P8
- `drops a fork's signing stop with its evidence and keeps another fork's stop`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P23, REQ-PROOFSTORE-7-B5PW2P.T1.P9
- `storage stops signing on a fork this peer disputes or whose signing a synced proof stopped, and on no other fork`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P24
- `storage signs again on a fork whose own dispute marker is rolled back, unless a synced proof stopped it there`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P25
