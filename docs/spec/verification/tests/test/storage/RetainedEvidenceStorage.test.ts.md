# RetainedEvidenceStorage.test.ts

Test file: [test/storage/RetainedEvidenceStorage.test.ts](../../../../../../test/storage/RetainedEvidenceStorage.test.ts)
Exercises: [RetainedEvidenceStorage.ts](../../../../implementation/source/src/storage/RetainedEvidenceStorage.ts.md)

## Overview

Drives the retained evidence store through the `Storage` facade with authentic blocks signed by
random wallets. It checks lookups by hash and coordinate, several identities at one height,
confirmation merging for a repeated identity through the deep-copy proxy, that retained blocks
never reach the block history or its view, the most-signed and linked-child choices, and the
same-author double-sign lookup with its negative cases.

## Tests

- `retains a block by hash and lists it at its coordinate`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P1
- `keeps every identity retained at one coordinate`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P2
- `merges the confirmations of a repeated identity into the retained block`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P3
- `returns nothing for an unknown hash or an empty coordinate`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P4
- `never fills the block history or moves its view`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P5
- `picks the block carrying the most signatures at a coordinate`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P6
- `picks the linked child carrying the most signatures`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P7
- `ignores a child at the next height that links to another block`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P8
- `returns no linked child when nothing links above the block`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P9
- `finds another block by the same author at the coordinate as a double sign`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P10
- `finds no double sign in the same identity or in another author's block`: UNIT-TEST-RETAINED-EVIDENCE-STORAGE-1-T2Z7W3.P11
