# WaitForSyncStatusGuard.test.ts

Test file: [test/rpc/guards/WaitForSyncStatusGuard.test.ts](../../../../../../../test/rpc/guards/WaitForSyncStatusGuard.test.ts)
Exercises: [WaitForSyncStatusGuard.ts](../../../../../implementation/source/src/rpc/network/guards/WaitForSyncStatusGuard.ts.md)

## Overview

Each case opens a two-participant channel and spawns a fresh observer while the participants keep authoring
until the observer's initial sync is held, so its payload is fixed. A record-only probe on the observer counts
every `onBlockConfirmation` run (network arrival and guard re-run), the queue intake each run reaches, and the
guard's retained count; the participants count spectate requests. The first case holds the observer's state
install, authors the next block so it reaches the observer only as live gossip, checks that it is retained with
no intake and one spectate request, then releases the install and proves the block's first intake is the
guard's re-run after `SYNCED` and the observer reaches it with no further block authored and no second sync.
The second case sends a stale copy (the served head) and a wrong-fork block from a participant during the hold
and proves both reach intake only after `SYNCED` while the head and the adopted fork stay unchanged. The third
case runs inline, holds the responders' answer and releases it as a failure: the failed initial sync aborts the
runtime, and the local endpoint shows no retained RPC left and none run again.

## Tests

- `a live block received during the initial sync is retained, starts no second sync, and is applied after SYNCED without a resend`: UNIT-TEST-WAIT-FOR-SYNC-GUARD-1-5ST9WK.P1, REQ-GOSSIP-5-2EQ7P6.T1.P1
- `a retained stale block and a retained wrong-fork block go through normal validation after SYNCED and are not applied`: UNIT-TEST-WAIT-FOR-SYNC-GUARD-1-5ST9WK.P2, REQ-GOSSIP-5-2EQ7P6.T1.P2
- `an abort during the initial sync drops the retained live blocks without running them`: UNIT-TEST-WAIT-FOR-SYNC-GUARD-1-5ST9WK.P3, REQ-GOSSIP-5-2EQ7P6.T1.P3
