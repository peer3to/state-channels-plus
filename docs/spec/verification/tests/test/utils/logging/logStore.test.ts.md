# logStore.test.ts

Test file: [test/utils/logging/logStore.test.ts](../../../../../../../test/utils/logging/logStore.test.ts)
Exercises: [logStore.ts](../../../../../implementation/source/src/utils/logging/logStore.ts.md)

## Overview

The suite constructs real `LogStore` instances, one with a bound small enough that forty entries
overflow it, and reads deltas past several cursors. The oracles are the delta's sequence range and
entries: numbers stay monotonic across eviction, a delta holds only what is past the cursor, an
empty delta leaves the cursor alone, and a start that jumped past the cursor is the gap eviction
left.

## Tests

- `keeps sequence numbers monotonic across eviction`: UNIT-TEST-LOG-STORE-1-279Z99.P1, REQ-LOG-3-T9FM2K.T1.P1
- `returns only entries after the cursor`: UNIT-TEST-LOG-STORE-1-279Z99.P2
- `reports an empty delta without moving the cursor`: UNIT-TEST-LOG-STORE-1-279Z99.P3
- `reports a gap when eviction outran the cursor`: UNIT-TEST-LOG-STORE-1-279Z99.P4
- `draws a 64-bit store id that no two stores share`: UNIT-TEST-LOG-STORE-1-279Z99.P5
- `rejects an infinite storage limit`: UNIT-TEST-LOG-STORE-1-279Z99.P6
- `rejects a NaN storage limit`: UNIT-TEST-LOG-STORE-1-279Z99.P9
- `rejects a negative storage limit`: UNIT-TEST-LOG-STORE-1-279Z99.P10
- `evicts an entry larger than the entire storage limit`: UNIT-TEST-LOG-STORE-1-279Z99.P7
- `retains no entries with a zero storage limit`: UNIT-TEST-LOG-STORE-1-279Z99.P8
