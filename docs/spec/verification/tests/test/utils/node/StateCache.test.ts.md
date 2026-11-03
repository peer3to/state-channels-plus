# StateCache.test.ts

Test file: [test/utils/node/StateCache.test.ts](../../../../../../../test/utils/node/StateCache.test.ts)
Exercises: [StateCache.ts](../../../../../implementation/source/src/utils/node/storageDiff/StateCache.ts.md)

## Overview

Direct calls to a `StateCache` filled with hand-written values, some accounts made complete as a backfill makes them, applying hand-written records forward and backward; the oracles are the values `get`, `accountOf`, `nonZeroSlots` and `isComplete` return afterwards.

## Tests

- `moves cached fields forward over a block and leaves the fields nobody read uncached`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P1
- `keeps a balance a block writes in its canonical form`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P2
- `moves a cached slot back to its pre value over a rolled-back block`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P3
- `empties the cached fields of an account a rolled-back block created`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P4
- `forgets every field on clear`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P5
- `forgets every field of one account and keeps another account's`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P6
- `reads a slot a complete account never wrote as zero, and an unread slot of another account as uncached`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P7
- `moves a slot of a complete account nobody read forward over a block`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P8
- `moves a slot of a complete account back to its pre value over a rolled-back block that cleared it`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P9
- `replaces what was cached of an account when it is made complete, and reports it in the shape of a record`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P10
- `counts only the non-zero slots of an account`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P11
- `keeps the cached slots of an account marked lazy and reads its other slots as uncached`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P12
- `forgets on clear that an account was complete`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P13
- `forgets that a forgotten account was complete`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P14
