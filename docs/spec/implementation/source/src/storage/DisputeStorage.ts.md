# DisputeStorage.ts

> **Source:** [src/storage/DisputeStorage.ts](../../../../../../src/storage/DisputeStorage.ts)
>
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-DSTORE-1-5AQYJX` (Dispute confirmation merge)](../../../../specification/storage/dispute-evidence.md#req-dstore-1-5aqyjx)
- [`REQ-DSTORE-2-H1DAGX` (Own-dispute guard)](../../../../specification/storage/dispute-evidence.md#req-dstore-2-h1dagx)

## UNIT-TEST-DISPUTE-STORAGE-1-82MB79

Confirmation merge

- Setup: Store signed disputes and confirmations with overlapping signature sets in varied orders
- Oracle: Sets merge monotonically and idempotently; signed dispute unchanged; decode round-trips

- [x] `UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P1` — bare signed dispute creates empty set
- [ ] `UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P2` — merge order permutations
- [ ] `UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P3` — duplicate confirmation no-op
- [ ] `UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P4` — decoded dispute matches

## UNIT-TEST-DISPUTE-STORAGE-2-94R6XV

Fork flags

- Setup: Set/read flags across forks
- Oracle: Per-fork isolation; absent reads false

- [ ] `UNIT-TEST-DISPUTE-STORAGE-2-94R6XV.P1` — set/read disputed flag
- [ ] `UNIT-TEST-DISPUTE-STORAGE-2-94R6XV.P2` — per-fork isolation
- [ ] `UNIT-TEST-DISPUTE-STORAGE-2-94R6XV.P3` — unset default
- [ ] `UNIT-TEST-DISPUTE-STORAGE-2-94R6XV.P4` — set/read own-dispute flag
