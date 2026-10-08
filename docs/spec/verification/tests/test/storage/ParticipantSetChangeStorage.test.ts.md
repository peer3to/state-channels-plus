# ParticipantSetChangeStorage.test.ts

Test file: [test/storage/ParticipantSetChangeStorage.test.ts](../../../../../../test/storage/ParticipantSetChangeStorage.test.ts)
Exercises: [ParticipantSetChangeStorage.ts](../../../../implementation/source/src/storage/ParticipantSetChangeStorage.ts.md)

## Overview

The suite drives `ParticipantSetChangeStorage` directly: recording change points (duplicates,
out of order, across two forks) through `storeChangePoint`, then reading
`getChangePointsInRange` under every bound shape — both bounds open, one bound open, inclusive
boundaries, bounds outside the recorded span, gap ranges, single-element ranges, and
inverted/equal ranges — with oracles asserting exact ascending arrays and per-fork set contents.
After atomization each recording and bound shape has its own permutation, and each is assigned
to its matching test below; only the implementation-level "open bounds" permutation still spans
two shapes (open start and open end) that live in separate tests, so it stays unassigned.

## Tests

- `should store change point and return the set`: none
- `should insert across different forks`: REQ-PSCSTORE-1-7BDTEV.T1.P4, UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1-Q1DT0E.P4
- `should handle duplicate insertions`: REQ-PSCSTORE-1-7BDTEV.T1.P5, UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1-Q1DT0E.P5
- `should add multiple change points to same fork`: none
- `should return empty array for non-existent fork id`: none
- `should get all when both start and end are undefined`: UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1-Q1DT0E.P7
- `should return sorted results when getting all`: REQ-PSCSTORE-1-7BDTEV.T1.P1, UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1-Q1DT0E.P1
- `should get all from beginning when start is undefined`: REQ-PSCSTORE-1-7BDTEV.T1.P2
- `should get single element when start undefined and end is just after first`: none
- `should get all from start to end when end is undefined`: REQ-PSCSTORE-1-7BDTEV.T1.P6
- `should get all from exact match when end undefined`: none
- `should return empty array when end <= start`: REQ-PSCSTORE-1-7BDTEV.T1.P3, UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1-Q1DT0E.P3
- `should handle start < actual smallest block height`: none
- `should handle both start and end outside actual range`: none
- `should be inclusive of start and inclusive of end`: REQ-PSCSTORE-1-7BDTEV.T1.P7, UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1-Q1DT0E.P6
- `should include exact start value`: none
- `should include exact end value`: none
- `should work with single-element ranges`: none
- `should return empty for gap ranges`: none
- `should handle end > actual largest block height`: none
