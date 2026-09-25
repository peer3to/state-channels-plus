# ForceExitStorage.ts

> **Source:** [src/storage/ForceExitStorage.ts](../../../../../../src/storage/ForceExitStorage.ts)
>
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-RMSTORE-2-Y2T1PG` (Explicit intent lifecycle)](../../../../specification/storage/progress-markers.md#req-rmstore-2-y2t1pg)

## UNIT-TEST-FORCE-EXIT-STORAGE-1-HRT66A

Intent lifecycle

- Setup: Set, read, and clear the flag incl. before any set
- Oracle: Explicit lifecycle; default false; idempotent clears

- [ ] `UNIT-TEST-FORCE-EXIT-STORAGE-1-HRT66A.P1` — default false
- [ ] `UNIT-TEST-FORCE-EXIT-STORAGE-1-HRT66A.P2` — set/read/clear
- [ ] `UNIT-TEST-FORCE-EXIT-STORAGE-1-HRT66A.P3` — repeated set idempotent
