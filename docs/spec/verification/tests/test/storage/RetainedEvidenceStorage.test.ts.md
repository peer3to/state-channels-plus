# RetainedEvidenceStorage.test.ts

Test file: [test/storage/RetainedEvidenceStorage.test.ts](../../../../../../test/storage/RetainedEvidenceStorage.test.ts)
Exercises: [RetainedEvidenceStorage.ts](../../../../implementation/source/src/storage/RetainedEvidenceStorage.ts.md)

## Overview

Drives the retained evidence store through the `Storage` facade with authentic blocks signed by
random wallets. It checks lookups by hash and coordinate, several identities at one height,
confirmation merging for a repeated identity, that inputs and returned copies never alias the stored
block, the most-signed and linked-child choices counted over distinct eligible signers (outsider
signatures count for nothing, ties take the lowest hash), and the same-author double-sign lookup
with each negative case on its own.

## Tests

- `retains a block by hash and lists it at its coordinate`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P1
- `keeps every identity retained at one coordinate`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P2
- `merges the confirmations of a repeated identity into the retained block`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P3
- `returns no block for an unknown hash`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P4
- `lists no blocks at an empty coordinate`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P12
- `chooses no block at an empty coordinate`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P13
- `keeps the retained block unchanged when the stored input is mutated`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P14
- `keeps the retained block unchanged when a returned copy is mutated`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P15
- `chooses the block signed by the most eligible participants at a coordinate`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P6
- `chooses the linked child signed by the most eligible participants`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P7
- `counts no signatures by signers outside the eligible set`: REQ-SP-11-535J0R.T1.P12, UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P16
- `takes the lowest block hash among linked children with as many eligible signers`: REQ-SP-11-535J0R.T1.P13, UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P17
- `takes the lowest block hash among blocks at a coordinate with as many eligible signers`: REQ-SP-11-535J0R.T1.P24, UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P20
- `counts a signature the contracts reject as no signer among linked children`: REQ-SP-11-535J0R.T1.P22, UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P21
- `counts a signature the contracts reject as no signer at a coordinate`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P22
- `counts one eligible key that signs a block twice as one signer`: REQ-SP-11-535J0R.T1.P23, UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P23
- `ignores a child at the next height that links to another block`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P8
- `returns no linked child when nothing links above the block`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P9
- `finds another block by the same author at the coordinate as a double sign`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P10
- `finds no double sign in the same identity`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P11
- `finds no double sign in another author's block at the coordinate`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P18
- `finds no double sign in the same author's block at another height`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P19
