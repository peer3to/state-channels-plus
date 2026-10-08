# BlacklistStorage.test.ts

Test file: [test/storage/BlacklistStorage.test.ts](../../../../../../test/storage/BlacklistStorage.test.ts)
Exercises: [BlacklistStorage](../../../../implementation/source/src/storage/BlacklistStorage.ts.md)

## Overview

Direct black-box cases on the persisted verdict store: a verdict is recorded with its reason and read back
by address, a second verdict keeps the first reason, every operation normalizes the address to its
checksum form, an absent address reads as absent and removes as a no-op, and clearing empties the record.
No manager or transport is involved; the store is the whole component.

## Tests

- `records a verdict with its reason and reports it by address`: UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P1
- `keeps the first reason when the same address is recorded again`: UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P2
- `keys every operation by the checksummed address`: UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P4
- `reports a missing address as absent and a removal of it as a no-op`: UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P3
- `clears every verdict`: UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P5
