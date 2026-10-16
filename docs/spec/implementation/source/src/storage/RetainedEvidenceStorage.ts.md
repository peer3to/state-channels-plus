# RetainedEvidenceStorage.ts

> **Source:** [src/storage/RetainedEvidenceStorage.ts](../../../../../../src/storage/RetainedEvidenceStorage.ts)

## Requirements

- [`REQ-SP-11-535J0R` (Persisting a verified proof, in synchronization or in dispute audit, splits its…)](../../../../specification/disputes/state-proofs.md#req-sp-11-535j0r)
- [`REQ-STOR-6-SKP0KM` (Value semantics at the store boundary)](../../../../specification/storage/durability.md#req-stor-6-skp0km)

## UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3

Evidence-only retention of proof support

- Setup: Retain authentic factory blocks through the `Storage` facade: one or several identities at one coordinate, repeated identities with other confirmations, linked and unlinked children, same-author and other-author blocks
- Oracle: Lookups by hash and coordinate return exactly the retained identities; repeated identities merge confirmations; inputs and returned copies never alias the stored block; the choices count only distinct eligible signers and break ties by the lowest hash; the double-sign lookup returns the expected block or none

- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P1` — retain and read by hash and coordinate
- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P2` — several identities at one coordinate are all kept
- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P3` — a repeated identity merges its confirmations
- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P4` — unknown hash returns nothing
- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P6` — the block signed by the most eligible participants at a coordinate is chosen
- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P7` — the linked child signed by the most eligible participants is chosen
- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P8` — a child at the next height linked to another block is ignored
- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P9` — no linked child when nothing links above the block
- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P10` — another identity by the same author at the coordinate is a double sign
- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P11` — the same identity is no double sign
- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P12` — an empty coordinate lists no blocks
- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P13` — an empty coordinate yields no choice
- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P14` — mutating the stored input leaves the retained block unchanged
- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P15` — mutating a returned copy leaves the retained block unchanged
- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P16` — signatures by signers outside the eligible set count for nothing
- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P17` — a tie in eligible signers takes the lowest block hash
- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P18` — another author's block at the coordinate is no double sign
- [x] `UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P19` — the same author's block at another height is no double sign
