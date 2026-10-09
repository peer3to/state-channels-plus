# StateMachineStateStorage.ts

> **Source:** [src/storage/StateMachineStateStorage.ts](../../../../../../src/storage/StateMachineStateStorage.ts)
>
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`INV-SNAPSTORE-1-DPHPJE` (Content addressing)](../../../../specification/storage/snapshots-and-states.md#inv-snapstore-1-dphpje)

## UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6

Content addressing

- Setup: Store states with computed and supplied hashes; read back
- Oracle: Byte-exact round trips; computed key equals keccak; absence explicit

- [x] `UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P1` — computed-hash round trip
- [x] `UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P2` — caller-hash round trip
- [x] `UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P3` — absent key
- [ ] `UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P4` — empty state bytes
- [ ] `UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P5` — large state bytes
