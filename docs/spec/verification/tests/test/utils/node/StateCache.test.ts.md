# StateCache.test.ts

Test file: [test/utils/node/StateCache.test.ts](../../../../../../../test/utils/node/StateCache.test.ts)
Exercises: [StateCache.ts](../../../../../implementation/source/src/utils/node/storageDiff/StateCache.ts.md)

## Overview

Direct calls to a `StateCache` filled with hand-written values, applying hand-written records forward and backward; the oracles are the values `get` returns afterwards.

## Tests

- `moves cached fields forward over a block and leaves the fields nobody read uncached`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P1
- `keeps a balance a block writes in its canonical form`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P2
- `moves a cached slot back to its pre value over a rolled-back block`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P3
- `empties the cached fields of an account a rolled-back block created`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P4
- `forgets every field on clear`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P5
- `forgets every field of one account and keeps another account's`: UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P6
