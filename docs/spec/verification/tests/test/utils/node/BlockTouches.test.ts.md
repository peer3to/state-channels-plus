# BlockTouches.test.ts

Test file: [test/utils/node/BlockTouches.test.ts](../../../../../../../test/utils/node/BlockTouches.test.ts)
Exercises: [traceDiffs.ts](../../../../../implementation/source/src/utils/node/storageDiff/traceDiffs.ts.md)

## Overview

Direct calls to the pure helpers with hand-built prestate, multi-transaction and call-frame traces and with the traces Asset Hub eth-rpc answered for one recorded block (`assetHubTrace.recorded.json`); the oracles are the returned key sets, flags, merged diffs, cleared slots and failure verdicts.

## Tests

- `names the storage keys of pre and post and flags the scalars post shows`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P1
- `flags every scalar of an account that post leaves out`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P2
- `keeps a flag set by any transaction of the block`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P3
- `finds no failure in clean frames, nested calls included`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P4
- `finds a failure on the top frame`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P5
- `finds a failure on a nested frame two calls deep`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P6
- `finds a failure in any transaction of the block`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P7
- `counts an entry with an error of its own, a missing trace or a wrong length as failed`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P8
- `keeps the earliest pre and the latest post of a slot written by two transactions`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P13
- `leaves out a slot and an account that later transactions of the block restore`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P14
- `leaves out a balance that ends the block at the value it started with`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P15
- `empties every field and cached slot of an account the trace's post leaves out`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P16
- `keeps an account created in one transaction and written in a later one out of the block's pre`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P17
- `reads a nonce and code that pre leaves out while post sets them as empty before`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P18
- `names the accounts and storage keys of a recorded prestate diff and flags what its post shows`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P9
- `reads a slot a recorded post omits as cleared to zero`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P10
- `finds no failure in a recorded call tree with nested calls`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P11
- `finds a failure once a nested frame of the recorded call tree carries an error`: UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P12
