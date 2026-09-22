# ForceJoinStorage.ts

> **Source:** [src/storage/ForceJoinStorage.ts](../../../../../../src/storage/ForceJoinStorage.ts)
>
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-RMSTORE-2-Y2T1PG` (Explicit intent lifecycle)](../../../../specification/storage/progress-markers.md#req-rmstore-2-y2t1pg)
- [`INV-MEMBERSHIP-PENDING-1-2H1T75` (Submitted joins are locally)](../../../../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75)

## UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN

Marker lifecycle

- Setup: Set height, defer eligibility, start dispute, clear, and read again
- Oracle: Exact height survives deferral; started state prevents duplicates; clear resets both fields

- [ ] `UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P1` — read before set
- [ ] `UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P2` — set/read/clear cycle
- [ ] `UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P3` — repeated clear idempotent
- [x] `UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P4` — deferred eligibility retains the height, started state blocks a duplicate, and clear resets both
