# Storage.ts

> **Source:** [src/storage/Storage.ts](../../../../../../src/storage/Storage.ts)
>
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-SNAPSTORE-2-Q7E6TQ` (Derived reads fail explicitly)](../../../../specification/storage/snapshots-and-states.md#req-snapstore-2-q7e6tq)
  Contradicts: `getPreviousBlockOrSnapshot`/`getPreviousRelevantTimestamp` throw on an absent predecessor (non-null assertions) instead of returning explicit absence. Decided as a documented precondition; see [`FIND-STORAGE-3-GYR34M`](../../../../audit/open-findings.md#find-storage-3-gyr34m).
- [`REQ-IX-9-AV56NR` (Storage fidelity)](../../../../specification/interactions.md#req-ix-9-av56nr)
- [`REQ-STOR-6-SKP0KM` (Value semantics at the store boundary)](../../../../specification/storage/durability.md#req-stor-6-skp0km)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`REQ-STOR-1-D4XE73` (Complete durable set)](../../../../specification/storage/durability.md#req-stor-1-d4xe73)
  Partial: The medium is in-memory: nothing survives restart, so the durability half of the requirement is unmet until the disk medium lands ([durability.md](../../../../specification/storage/durability.md)).
- [`REQ-STOR-2-TARP8S` (Commit-aligned durability)](../../../../specification/storage/durability.md#req-stor-2-tarp8s)
- [`REQ-STOR-4-MF6FT6` (Obligation-bounded retention)](../../../../specification/storage/durability.md#req-stor-4-mf6ft6)
  Partial: No pruning mechanism exists — retention is vacuously safe but growth is unbounded; policy pending with the disk medium.
- [`REQ-STOR-5-T6EQSA` (Isolation, integrity, and versioned encoding)](../../../../specification/storage/durability.md#req-stor-5-t6eqsa)
  Partial: Corruption detection and versioned encodings are not applicable in-memory and absent — required at the disk migration.

## UNIT-TEST-STORAGE-FACADE-1-TF3MZ1

Derived reads join explicitly and fail explicitly

- Setup: Populate modules with linked and gapped fixtures; query each derived read
- Oracle: Complete joins return exact copies; each missing link yields explicit absence; negative height resolves genesis

- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P1` — snapshot-at-coordinates full join
- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P2` — missing block at coordinates
- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P3` — negative-height genesis resolution
- [ ] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P4` — membership-change union with explicit resulting hash
- [ ] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P5` — getPreviousBlockOrSnapshot absent predecessor (documents the contradiction)
- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P6` — genesis machine-state full join
- [ ] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P7` — previous-snapshot full join
- [ ] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P8` — participants-union full join
- [ ] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P9` — previous block-or-snapshot full join
- [ ] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P10` — previous relevant-timestamp full join
- [ ] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P11` — missing snapshot for block hash
- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P12` — missing genesis snapshot
- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P13` — missing machine state for genesis hash
- [ ] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P14` — membership-change union without explicit resulting hash
- [ ] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P15` — getPreviousRelevantTimestamp absent predecessor (documents the contradiction)
- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P16` — stored lookup equals direct computation with the same snapshots
- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P17` — unions overlapping snapshots and canonicalizes addresses without storing a result
- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P18` — preserves both sides of disjoint membership changes
- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P19` — accepts an absent previous snapshot
- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P20` — accepts an absent resulting snapshot
- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P21` — returns an empty union for absent or empty snapshots

## UNIT-TEST-STORAGE-FACADE-2-KRDP9Q

Defensive copying

- Setup: Read a stored record, mutate the returned object, read again
- Oracle: Stored state is unaffected; successive reads are independent copies

- [x] `UNIT-TEST-STORAGE-FACADE-2-KRDP9Q.P1` — mutate returned snapshot
- [ ] `UNIT-TEST-STORAGE-FACADE-2-KRDP9Q.P2` — write-side aliasing (stored input later mutated by producer)
- [x] `UNIT-TEST-STORAGE-FACADE-2-KRDP9Q.P3` — mutate returned block
- [ ] `UNIT-TEST-STORAGE-FACADE-2-KRDP9Q.P4` — mutate returned state
