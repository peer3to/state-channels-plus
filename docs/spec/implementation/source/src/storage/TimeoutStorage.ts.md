# TimeoutStorage.ts

> **Source:** [src/storage/TimeoutStorage.ts](../../../../../../src/storage/TimeoutStorage.ts)
>
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-TOSTORE-1-JQPXBC` (Lowest-height timeout candidate)](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-1-jqpxbc)

## UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3

Lowest-height retention

- Setup: Store candidates at varied heights per fork in varied orders
- Oracle: Lowest retained for every order; equal height replaces; forks independent

- [ ] `UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P1` — lower replaces higher
- [ ] `UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P2` — higher ignored
- [ ] `UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P3` — order permutations converge
- [ ] `UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P4` — equal-height replacement
- [ ] `UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P5` — per-fork isolation
