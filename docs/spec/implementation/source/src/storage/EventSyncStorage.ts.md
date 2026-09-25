# EventSyncStorage.ts

> **Source:** [src/storage/EventSyncStorage.ts](../../../../../../src/storage/EventSyncStorage.ts)
>
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-RMSTORE-1-BWKVBG` (Monotone observation progress)](../../../../specification/storage/progress-markers.md#req-rmstore-1-bwkvbg)
- [`REQ-ID-2-F3Y8J4` (Normalized identity comparison)](../../../../specification/protocol-model/identity.md#req-id-2-f3y8j4)

## UNIT-TEST-EVENT-SYNC-STORAGE-1-0NKNW0

Monotone normalized progress

- Setup: Store increasing, repeated, regressing values with case-variant channel ids
- Oracle: Monotone per channel; regressions ignored; case variants resolve to one channel

- [ ] `UNIT-TEST-EVENT-SYNC-STORAGE-1-0NKNW0.P1` — advance
- [x] `UNIT-TEST-EVENT-SYNC-STORAGE-1-0NKNW0.P2` — regression ignored
- [ ] `UNIT-TEST-EVENT-SYNC-STORAGE-1-0NKNW0.P3` — case-variant keys unify
- [x] `UNIT-TEST-EVENT-SYNC-STORAGE-1-0NKNW0.P4` — per-channel isolation
