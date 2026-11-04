# MirrorSnapshotWaits.test.ts

Test file: [test/evm/MirrorSnapshotWaits.test.ts](../../../../../../test/evm/MirrorSnapshotWaits.test.ts)
Exercises: [SnapshotWaits.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/mirror/SnapshotWaits.ts.md)

## Overview

Cases drive a `SnapshotWaits` directly: a read's expected snapshot is forgotten and expected again by a later read, and a snapshot's placement is held past a 20 ms backstop while the read's wait is watched; a read with 50 ms left waits on a 10 s backstop. The oracles are whether the account is still awaited and when the wait ends, with which error.

## Tests

- `forgets the waits of a read that ends early, and only its own`: UNIT-TEST-MIRROR-SNAPSHOT-WAITS-1-GADNHY.P1
- `ends a wait past its backstop only once the snapshot being placed for it is placed`: UNIT-TEST-MIRROR-SNAPSHOT-WAITS-1-GADNHY.P2
- `ends a wait when the read's time runs out before its backstop`: UNIT-TEST-MIRROR-SNAPSHOT-WAITS-1-GADNHY.P3
