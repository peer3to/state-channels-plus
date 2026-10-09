# BlockStorage.test.ts

Test file: [test/storage/BlockStorage.test.ts](../../../../../../test/storage/BlockStorage.test.ts)
Exercises: [BlockStorage.ts](../../../../implementation/source/src/storage/BlockStorage.ts.md)

## Overview

Use factory-built copies and explicit storage keys; check timestamp values, missing-target booleans and merged signatures through public lookup/mutation methods.

The suite drives `BlockStorage` directly (plus the `Storage` facade for the deep-copy-proxy
cases) with factory-built blocks and random 65-byte signatures. It asserts the dual-index
contract — store, read, signature insert, and delete observable through both the hash key and
the (fork, height) coordinates, with both indexes holding the same object — plus refusal of a
different body at taken coordinates with the original left intact, monotone and idempotent
signature merge, per-fork max-height tracking observed through `getIterator`, the DESC clamp of
an absurd remote-supplied start height, and reference isolation of stored objects behind the
facade proxy. The timestamp test pins the current overwrite behavior (the later value wins),
which diverges from the spec's earliest-wins rule, so only the implementation-level
earlier-then-later permutation is assignable. The atomized per-key-form permutations are
assigned below; the remaining unassigned permutations (`justPersist` backfill, merge-order
convergence, later-then-earlier and merge-carried timestamps) describe stimuli this suite never
drives, so they stay unassigned.

## Tests

- `should merge signatures with deduplication on duplicate insert`: REQ-BLKSTORE-1-KYHTWT.T1.P2, UNIT-TEST-BLOCK-STORAGE-1-FY94TH.P4
- `should overwrite on-chain timestamp on duplicate insert`: UNIT-TEST-BLOCK-STORAGE-2-K77ECA.P1
- `should insert block confirmation with auto-computed keys`: none
- `should insert block confirmation with provided keys`: INV-BLKSTORE-1-MK4W8D.T1.P1, UNIT-TEST-BLOCK-STORAGE-1-FY94TH.P1
- `should get block by hash`: none
- `should get block by coordinates`: none
- `BlockStorage > READ - getBlockEntry() > should return undefined for non-existent blocks`: none
- `should maintain consistency between lookups`: none
- `should insert signature by hash`: none
- `should insert signature by coordinates`: none
- `BlockStorage > UPDATE - insertSignature() > should return undefined for non-existent blocks`: none
- `should modify same object regardless of lookup method`: INV-BLKSTORE-1-MK4W8D.T1.P3
- `should prevent duplicate signatures`: REQ-BLKSTORE-2-VWXP2C.T1.P1
- `should prevent duplicate signatures by coordinates`: none
- `should allow multiple unique signatures`: none
- `clamps an absurd startHeight to maxHeight instead of looping the empty range`: REQ-BLKSTORE-3-S9V2KC.T1.P3, UNIT-TEST-BLOCK-STORAGE-3-ZPT4BN.P3
- `should delete by hash`: INV-BLKSTORE-1-MK4W8D.T1.P2, UNIT-TEST-BLOCK-STORAGE-1-FY94TH.P2
- `should delete by coordinates`: INV-BLKSTORE-1-MK4W8D.T1.P4, UNIT-TEST-BLOCK-STORAGE-1-FY94TH.P5
- `should return false when deleting non-existent blocks`: none
- `altering object inside storage (adding signatures) doesn't affect original object`: none
- `altering object outside storage doesn't affect object inside storage`: UNIT-TEST-STORAGE-FACADE-2-KRDP9Q.P3
- `should return undefined when storing different blocks with same coordinates`: REQ-BLKSTORE-1-KYHTWT.T1.P1, UNIT-TEST-BLOCK-STORAGE-1-FY94TH.P3
- `should not store conflicting block in coordinates map`: REQ-BLKSTORE-1-KYHTWT.T1.P3
- `should return hash when storing block with same hash but different coordinates`: none
- `should maintain reference equality between hash and coordinates maps`: none
- `should update max height when adding block with higher height`: REQ-BLKSTORE-3-S9V2KC.T1.P1, UNIT-TEST-BLOCK-STORAGE-3-ZPT4BN.P1
- `should not update max height when adding block with lower height`: UNIT-TEST-BLOCK-STORAGE-3-ZPT4BN.P4
- `should handle multiple forks independently`: none
- `should update max height when removing the highest block`: none
- `should not update max height when removing non-highest block`: none
- `should handle removing the only block in a fork`: none
- `should return empty when no blocks exist on fork`: none
- `should return blocks in correct order`: none
- `sets a zero timestamp through the hash overload`: UNIT-TEST-BLOCK-STORAGE-32-DHXM4N.P1
- `sets a timestamp through the coordinate overload`: UNIT-TEST-BLOCK-STORAGE-32-DHXM4N.P2
- `returns false for absent timestamp targets in both overloads`: UNIT-TEST-BLOCK-STORAGE-32-DHXM4N.P3
- `updates timestamp and signatures through explicit storage keys`: UNIT-TEST-BLOCK-STORAGE-32-DHXM4N.P4
- `mergeFrom preserves a defined timestamp when the incoming copy has none`: UNIT-TEST-BLOCK-COPY-MERGE-32-8JDDQR.P1
- `mergeFrom accepts a zero timestamp from the incoming copy`: UNIT-TEST-BLOCK-COPY-MERGE-32-8JDDQR.P2
- `duplicate storage insertion keeps time when the incoming copy has none`: UNIT-TEST-BLOCK-STORAGE-32-DHXM4N.P5
