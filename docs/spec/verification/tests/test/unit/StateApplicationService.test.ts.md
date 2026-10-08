# StateApplicationService.test.ts

Test file: [test/unit/StateApplicationService.test.ts](../../../../../../test/unit/StateApplicationService.test.ts)
Exercises: [StateApplicationService.ts](../../../../implementation/source/src/stateManager/snapshotUpdate/StateApplicationService.ts.md)

## Overview

The suite verifies that authenticated snapshots are validated and applied through the canonical state
application owner before spectator sync reports success. Invalid source or conflicting state follows the
existing failure path and cannot satisfy targeted connect.

The status-recompute case applies a snapshot on an already-synced spectator; it does not drive a connect's
one-peer initial sync, so it assigns no targeted-join permutation. The related requirement is `REQ-TJOIN-3-DCZKS6`.

## Tests

- `snapshot preparation preserves the complete previous cache for concurrent intake until publication`: UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P10
- `successful reduction replaces the old-fork cache with its committed genesis participants`: UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P11
- `cancelled reduction cannot publish its prepared participant set or fork`: UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P12
- `successful same-fork snapshot replacement publishes its participant set atomically`: UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P13
- `failed snapshot inspection restores the VM without publishing eligibility`: REQ-GOSSIP-4-J5Z4DF.T1.P21, UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P14
- `applying a snapshot that lists me → PARTICIPATING recomputed from a wrong SYNCED`: UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P2
- `applying a snapshot that does not list me → SYNCED recomputed from a wrong PARTICIPATING`: UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P3
- `an older snapshot timestamp shortens the scheduled timeout check by exactly that offset`: none
- `a snapshot timestamp far in the past → the scheduled delay goes negative (unclamped, pinned)`: none
- `unsafeSetGenesisState stores a height-0 snapshot for the fork and swaps the active fork`: UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P1
- `Unit: StateApplicationService > failed chain membership inspection restores VM state without publishing storage, fork or eligibility`: UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P15
