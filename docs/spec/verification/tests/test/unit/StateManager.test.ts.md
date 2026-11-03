# StateManager.test.ts

Test file: [test/unit/StateManager.test.ts](../../../../../../test/unit/StateManager.test.ts)
Exercises: [StateManager](../../../../implementation/source/src/stateManager/StateManager.ts.md)

## Overview

The tests exercise the current-fork predicate after a real reduction and the restore that `setChannelId` runs for a persistent peer restarted through `LifecycleActions.restartPeer`: a dispute marker written and flushed host-side before the restart, with no dispute on chain, reads back cleared; the restarted peer's local-diamond snapshot equals another peer's before any connection. The chain-read case starts the persistent peer behind one RPC node proxy, restarts it with that proxy cut from the start (`rpcNodeProxiesCutAtStart`), expects the restart to reject, then restarts it with the proxy up and checks it resumes its persisted height at `SYNCED`, which needs the first start to have released the partition.

## Tests

- `rejects an older fork after a real reduction`: UNIT-TEST-STATE-MANAGER-ACTIVE-FORK-1-NDTW9K.P2
- `participant → chain-committed item gets the calldata strategy, a gossip-only item the live strategy`: UNIT-TEST-STATE-MANAGER-7-YRC0N3.P3
- `synced spectator → chain-committed and gossip-only items both get the spectating strategy`: UNIT-TEST-STATE-MANAGER-7-YRC0N3.P2
- `a restored head clears a persisted dispute marker whose dispute never reached the chain`: REQ-STOR-3-4RJGER.T1.P15
- `a chain that cannot be read fails the persistent start and releases the partition; the next start resumes from it`: REQ-STOR-3-4RJGER.T1.P23
- `a restored head refills the local mirror with the chain's snapshot before any sync`: REQ-STOR-3-4RJGER.T1.P17
