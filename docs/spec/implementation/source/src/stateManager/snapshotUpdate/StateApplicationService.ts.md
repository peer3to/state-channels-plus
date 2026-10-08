# StateApplicationService.ts

> **Source:** [src/stateManager/snapshotUpdate/StateApplicationService.ts](../../../../../../../src/stateManager/snapshotUpdate/StateApplicationService.ts)

## Requirements

- [`REQ-TJOIN-3-DCZKS6` (Verified synchronization and membership)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6)
- [`REQ-DISPUTE-PIPE-3-PHE3SQ` (Deterministic reduction)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq)
- [`REQ-DISPUTE-PIPE-4-3YVDSA` (Atomic recovery)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)

## UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR

Canonical snapshot application

- Setup: Apply genesis and participant/non-participant snapshots through the existing owner
- Oracle: Storage, active fork, and local status update atomically before readiness is reported; the reduction path commits nothing when `shouldCommit` is false or a read rejects

- [x] `UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P1` — genesis height-zero storage and active fork
- [x] `UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P2` — participant status
- [x] `UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P3` — observer status
- [x] `UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P4` — disposal while the reduction application is held at `setState` commits nothing
- [x] `UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P5` — disposal while the reduction application is held at `getParticipants` commits nothing
- [x] `UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P6` — disposal while the reduction application is held at `getNextToWrite` commits nothing
- [x] `UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P7` — a `getParticipants` rejection after the canonical `setState` aborts the state manager without committing
- [x] `UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P8` — a `getNextToWrite` rejection after the canonical `setState` aborts the state manager without committing
- [x] `UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P9` — a reduced genesis that drops the signer keeps the status while the chain still lists it, and `SYNCED` follows the chain's snapshot
- [x] `UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P10` — snapshot preparation preserves the complete previous cache for concurrent intake until publication
- [x] `UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P11` — successful reduction replaces the old-fork cache with its committed genesis participants
- [x] `UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P12` — cancelled reduction cannot publish its prepared participant set or fork
- [x] `UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P13` — successful same-fork snapshot replacement publishes its participant set atomically
- [x] `UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P14` — failed snapshot inspection restores the VM without publishing eligibility
- [x] `UNIT-TEST-STATE-APPLICATION-SERVICE-1-B8V3DR.P15` — failed chain membership inspection restores VM state without publishing storage, fork or eligibility
