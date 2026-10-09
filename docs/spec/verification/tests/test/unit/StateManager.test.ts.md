# StateManager.test.ts

Test file: [test/unit/StateManager.test.ts](../../../../../../test/unit/StateManager.test.ts)
Exercises: [StateManager](../../../../implementation/source/src/stateManager/StateManager.ts.md)

## Overview

The tests exercise the live current-fork predicate before and after disposal and a real reduction.

The disposal case retains the actual inline StateManager before cleanup so its post-disposal assertion does not depend on a reply from the disposed network.

## Tests

- `rejects the current fork after disposal`: UNIT-TEST-STATE-MANAGER-ACTIVE-FORK-1-NDTW9K.P1
- `rejects an older fork after a real reduction`: UNIT-TEST-STATE-MANAGER-ACTIVE-FORK-1-NDTW9K.P2
- `participant → chain-committed item gets the calldata strategy, a gossip-only item the live strategy`: UNIT-TEST-STATE-MANAGER-7-YRC0N3.P3
- `synced spectator → chain-committed and gossip-only items both get the spectating strategy`: UNIT-TEST-STATE-MANAGER-7-YRC0N3.P2
