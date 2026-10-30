# ForceJoinStorage.ts

> **Source:** [src/storage/ForceJoinStorage.ts](../../../../../../src/storage/ForceJoinStorage.ts)

## Requirements

- [`REQ-RMSTORE-2-Y2T1PG` (Explicit intent lifecycle)](../../../../specification/storage/progress-markers.md#req-rmstore-2-y2t1pg)
- [`INV-MEMBERSHIP-PENDING-1-2H1T75` (Submitted joins are locally pending before acknowledgement)](../../../../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75)

## UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN

Join record lifecycle

- Setup: Start a join, update it, start a later join, update the earlier id, clear, and read again
- Oracle: The record reads back as updated; an update for an earlier id changes nothing and reports false; clear returns the absent state

- [x] `UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P1` — read before start
- [x] `UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P2` — start/read/update/clear cycle
- [x] `UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P3` — repeated clear idempotent
- [x] `UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P4` — an update for an earlier submission id changes nothing
