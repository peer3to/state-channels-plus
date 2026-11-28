# StateMachineStateStorage.ts

> **Source:** [src/storage/StateMachineStateStorage.ts](../../../../../../src/storage/StateMachineStateStorage.ts)

## Requirements

- [`INV-SNAPSTORE-1-DPHPJE` (Content addressing)](../../../../specification/storage/snapshots-and-states.md#inv-snapstore-1-dphpje)
- [`REQ-PROOFSTORE-8-R38KY5` (History pruning)](../../../../specification/storage/proof-store.md#req-proofstore-8-r38ky5)

## UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6

Content addressing

- Setup: Store states with computed and supplied hashes; read back
- Oracle: Byte-exact round trips; computed key equals keccak; absence explicit

- [x] `UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P1` — computed-hash round trip
- [x] `UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P2` — caller-hash round trip
- [x] `UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P3` — absent key
- [ ] `UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P4` — empty state bytes
- [ ] `UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P5` — large state bytes

## UNIT-TEST-STATE-MACHINE-STATE-STORAGE-2-9YS74X

A state delete removes one state by hash.

- Setup: Store several states; delete one twice.
- Oracle: The first delete returns true and the state is gone; the second returns false; other states stay.

- [x] `UNIT-TEST-STATE-MACHINE-STATE-STORAGE-2-9YS74X.P1` — delete a held state, then delete it again: true, then false; the other states stay
