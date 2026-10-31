# StateManager.test.ts

Test file: [test/unit/StateManager.test.ts](../../../../../../test/unit/StateManager.test.ts)
Exercises: [StateManager](../../../../implementation/source/src/stateManager/StateManager.ts.md)

## Overview

The tests exercise the current-fork predicate after a real reduction.

## Tests

- `rejects an older fork after a real reduction`: UNIT-TEST-STATE-MANAGER-ACTIVE-FORK-1-NDTW9K.P2
- `participant → chain-committed item gets the calldata strategy, a gossip-only item the live strategy`: UNIT-TEST-STATE-MANAGER-7-YRC0N3.P3
- `synced spectator → chain-committed and gossip-only items both get the spectating strategy`: UNIT-TEST-STATE-MANAGER-7-YRC0N3.P2
