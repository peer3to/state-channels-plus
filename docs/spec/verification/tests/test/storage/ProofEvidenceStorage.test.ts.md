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
it, and mutate the value set and a value read.

## Tests

- `holds no evidence before any is set`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P1
- `returns the audit evidence set for its dispute under the dispute key`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P2
- `returns the sync evidence set under its proof's finalized snapshot key`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P3
- `replaces the audit evidence of the same dispute with the later one`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P4
- `replaces the sync evidence of the same finalized snapshot even when the fork is at the bound`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P5
- `refuses a new sync record once its fork holds the maximum and logs the refusal`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P6
- `bounds sync evidence per fork, so a full fork does not refuse another fork's record`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P7
- `does not count audit evidence toward the sync bound`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P8
- `never refuses or evicts audit evidence when the fork's sync evidence is at the bound`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P9
- `keeps audit and sync evidence apart when the dispute hash equals the finalized snapshot hash`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P10
- `returns every audit and sync record of a fork and none of another fork`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P11
- `drops a fork's audit and sync evidence and keeps another fork's`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P12
- `accepts sync evidence of a dropped fork again up to the bound`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P13
- `keeps stored evidence unchanged when the caller mutates the value it set or read`: UNIT-TEST-PROOF-EVIDENCE-STORAGE-1-ARHJ8D.P14
