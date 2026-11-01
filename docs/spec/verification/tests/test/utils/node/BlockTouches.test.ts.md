# BlockTouches.test.ts

Test file: [test/utils/node/BlockTouches.test.ts](../../../../../../../test/utils/node/BlockTouches.test.ts)
Exercises: [blockStorageDiff.ts](../../../../../implementation/source/src/utils/node/storageDiff/blockStorageDiff.ts.md)

## Overview

Direct calls to the pure helpers with hand-built prestate and call-frame traces and with the traces Asset Hub eth-rpc answered for one recorded block (`assetHubTrace.recorded.json`); the oracles are the returned key sets, flags, cleared slots and failure verdicts.

## Tests

- `names the storage keys of pre and post and flags the scalars post shows`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P1
- `flags every scalar of an account that post leaves out`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P2
- `keeps a flag set by any transaction of the block`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P3
- `finds no failure in clean frames, nested calls included`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P4
- `finds a failure on the top frame`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P5
- `finds a failure on a nested frame two calls deep`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P6
- `finds a failure in any transaction of the block`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P7
- `counts an entry with an error of its own, a missing trace or a wrong length as failed`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P8
- `names the accounts and storage keys of a recorded prestate diff and flags what its post shows`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P9
- `reads a slot a recorded post omits as cleared to zero`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P10
- `finds no failure in a recorded call tree with nested calls`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P11
- `finds a failure once a nested frame of the recorded call tree carries an error`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P12
