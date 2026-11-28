# ParticipantSetChangeStorage.ts

> **Source:** [src/storage/ParticipantSetChangeStorage.ts](../../../../../../src/storage/ParticipantSetChangeStorage.ts)

## Requirements

- [`REQ-PSCSTORE-1-7BDTEV` (Complete ordered change points)](../../../../specification/storage/participant-changes.md#req-pscstore-1-7bdtev)
- [`REQ-PROOFSTORE-8-R38KY5` (History pruning)](../../../../specification/storage/proof-store.md#req-proofstore-8-r38ky5)

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

## UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-2-ZRP0DK

Change-point deletes remove points below a height or a whole fork.

- Setup: Record change points at every height of two forks; call `deleteChangePointsBelow` and `deleteFork`.
- Oracle: The returned counts and the remaining points per fork.

- [x] `UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-2-ZRP0DK.P1` — `deleteChangePointsBelow` height 2: 2 deleted, the points at 2 and 3 and another fork's points stay
- [x] `UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-2-ZRP0DK.P2` — `deleteFork`: every change point of the fork is gone and counted; another fork's points stay
