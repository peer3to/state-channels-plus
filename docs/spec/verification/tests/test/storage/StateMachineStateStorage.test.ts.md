# StateMachineStateStorage.test.ts

Test file: [test/storage/StateMachineStateStorage.test.ts](../../../../../../test/storage/StateMachineStateStorage.test.ts)
Exercises: [StateMachineStateStorage.ts](../../../../implementation/source/src/storage/StateMachineStateStorage.ts.md)

## Overview

The suite covers `StateMachineStateStorage` round trips — computed keccak key, caller-provided
key, and absent-key reads over random 64-byte payloads — and then, through the `Storage` facade,
the `getGenesisStateMachineState` derived read: a genesis snapshot linked to a stored encoded
state resolves to the exact bytes, while an unknown fork id or a genesis snapshot pointing at an
unstored state hash returns `undefined`. The atomized facade permutations for this derived read
(full join, missing encoded state) are assigned below; empty and large state payloads are not
exercised, and the unknown-fork read has no matching atomized permutation, so those stay
unassigned.

## Tests

- `should store state with auto-computed hash`: UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P1, INV-SNAPSTORE-1-DPHPJE.T1.P4
- `should store state with provided hash`: UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P2
- `should get state by hash`: none
- `should return undefined for non-existent hash`: UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P3
- `should return correct bytes for correct fork ID`: UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P6
- `should return undefined for incorrect fork ID`: none
- `should return undefined when genesis snapshot exists but stateMachineStateHash is not in storage`: REQ-SNAPSTORE-2-Q7E6TQ.T1.P6, UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P13
