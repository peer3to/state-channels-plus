# E2E-PersistenceRestart.test.ts

Test file: [test/e2e/E2E-PersistenceRestart.test.ts](../../../../../../../test/e2e/E2E-PersistenceRestart.test.ts)

## Overview

Each case runs the math harness with the persistent peers in their own temporary partitions (`persistentPeers`). `LifecycleActions.restartPeer` disposes a peer's runtime through its one disposal and starts it again with the same key and the channel id, so it resumes from its partition. Assertions read the restarted peer's head, status, turn notifications, local mirror and dispute marker through the harness-control queries before any connection, check that it refuses to author while held, then that it reaches the height the others reached while it was down and the channel's progress. The deadline case disposes the only other participant and waits for the restarted peer's abort; it never reports `PARTICIPATING`. One case sets and clears another channel id on a persistent runtime first, as a failed negotiation attempt does, then opens the real channel, checks both partitions are on disk and restarts the peer. One case has the persistent peer dispute a double-signed block through `DisputeOrchestrator.openOrdinaryDisputeWindow`, then restarts it. One case authors a block off the wire with its gossip and calldata post cut, restarts the author, and waits for the calldata on another peer. The participant timeout is raised so no peer times out the restarting one. The no-persistence case checks only that the restart comes back fresh, not that nothing reached disk, so `REQ-STOR-10-XY96KG.T1.P1` stays unassigned.

## Tests

- `a participant restarted mid-channel holds its persisted height at SYNCED and authors nothing before any sync, syncs the blocks made while it was down, then participates and the channel continues`: REQ-STOR-1-D4XE73.T1.P1, REQ-STOR-3-4RJGER.T1.P1, REQ-STOR-3-4RJGER.T1.P2, REQ-STOR-3-4RJGER.T1.P5, REQ-STOR-3-4RJGER.T1.P6, REQ-STOR-3-4RJGER.T1.P17, REQ-STOR-9-ZR8A92.T1.P3
- `a restarted participant with no participant reachable aborts at the restart sync deadline as an observer does and never participates`: REQ-STOR-3-4RJGER.T1.P7
- `a persistent runtime that set and cleared another channel id binds the channel that opens and resumes it after a restart`: REQ-STOR-11-Q4AT07.T1.P8
- `a participant restarted after its own dispute landed keeps its dispute marker and its local mirror holds that dispute window`: REQ-STOR-3-4RJGER.T1.P16
- `an author restarted before any peer signed its latest block posts that block's calldata on chain`: REQ-STOR-3-4RJGER.T1.P10
- `a runtime without persistence restarts as a fresh node`: none
