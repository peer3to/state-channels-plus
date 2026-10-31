# BlockTouches.test.ts

Test file: [test/utils/node/BlockTouches.test.ts](../../../../../../../test/utils/node/BlockTouches.test.ts)
Exercises: [blockStorageDiff.ts](../../../../../implementation/source/src/utils/node/storageDiff/blockStorageDiff.ts.md)

## Overview

Direct calls to the two pure helpers with hand-built prestate and call-frame traces; the oracles are the returned key sets, flags and failure verdicts.

## Tests

- `names the storage keys of pre and post and flags the scalars post shows`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P1
- `flags every scalar of an account that post leaves out`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P2
- `keeps a flag set by any transaction of the block`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P3
- `finds no failure in clean frames, nested calls included`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P4
- `finds a failure on the top frame`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P5
- `finds a failure on a nested frame two calls deep`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P6
- `finds a failure in any transaction of the block`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P7
- `counts an entry with an error of its own, a missing trace or a wrong length as failed`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P8
