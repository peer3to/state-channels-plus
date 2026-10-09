# ParticipantSetChangeStorage.ts

> **Source:** [src/storage/ParticipantSetChangeStorage.ts](../../../../../../src/storage/ParticipantSetChangeStorage.ts)
>
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-PSCSTORE-1-7BDTEV` (Complete ordered change points)](../../../../specification/storage/participant-changes.md#req-pscstore-1-7bdtev)

## UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1-Q1DT0E

Recording and ranges

- Setup: Record out-of-order and duplicate points; query every bound shape
- Oracle: Ascending dedup results; defaults honored; inverted/empty ranges empty; per-fork isolation

- [x] `UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1-Q1DT0E.P1` — out-of-order recording
- [ ] `UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1-Q1DT0E.P2` — open bounds
- [x] `UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1-Q1DT0E.P3` — inverted and empty ranges
- [x] `UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1-Q1DT0E.P4` — per-fork isolation
- [x] `UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1-Q1DT0E.P5` — duplicate recording
- [x] `UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1-Q1DT0E.P6` — closed bounds
- [x] `UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1-Q1DT0E.P7` — defaulted bounds
