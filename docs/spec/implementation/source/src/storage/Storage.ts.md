# Storage.ts

> **Source:** [src/storage/Storage.ts](../../../../../../src/storage/Storage.ts)

## Requirements

- [`REQ-SNAPSTORE-2-Q7E6TQ` (Derived reads fail explicitly)](../../../../specification/storage/snapshots-and-states.md#req-snapstore-2-q7e6tq)
- [`REQ-IX-9-AV56NR` (Storage fidelity)](../../../../specification/interactions.md#req-ix-9-av56nr)
- [`REQ-STOR-6-SKP0KM` (Value semantics at the store boundary)](../../../../specification/storage/durability.md#req-stor-6-skp0km)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`REQ-STOR-1-D4XE73` (Complete durable set)](../../../../specification/storage/durability.md#req-stor-1-d4xe73)
  Partial: `Storage` keeps every store in memory, so nothing survives a restart ([`OQ-23-SDBGYB` (SDK restart and recovery semantics)](../../../open-questions.md#oq-23-sdbgyb)).
- [`REQ-STOR-2-TARP8S` (Commit-aligned durability)](../../../../specification/storage/durability.md#req-stor-2-tarp8s)
- [`REQ-STOR-4-MF6FT6` (Obligation-bounded retention)](../../../../specification/storage/durability.md#req-stor-4-mf6ft6)
- [`REQ-STOR-5-T6EQSA` (Isolation, integrity, and versioned encoding)](../../../../specification/storage/durability.md#req-stor-5-t6eqsa)
- [`REQ-SYNC-5-M7W6JX` (Install only from where the requester stands)](../../../../specification/peer-communication/synchronization.md#req-sync-5-m7w6jx)
- [`REQ-PROOFSTORE-8-R38KY5` (History pruning)](../../../../specification/storage/proof-store.md#req-proofstore-8-r38ky5)

## UNIT-TEST-STORAGE-FACADE-1-TF3MZ1

Derived reads join explicitly and fail explicitly

- Setup: Populate modules with linked and gapped fixtures; query each derived read
- Oracle: Complete joins return exact copies; each missing link yields explicit absence; negative height resolves genesis

- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P1` — snapshot-at-coordinates full join
- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P2` — missing block at coordinates
- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P3` — negative-height genesis resolution
- [ ] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P4` — membership-change union with explicit resulting hash
- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P5` — getPreviousBlockOrSnapshot absent predecessor returns neither block nor snapshot
- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P6` — genesis machine-state full join
- [ ] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P7` — previous-snapshot full join
- [ ] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P8` — participants-union full join
- [ ] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P9` — previous block-or-snapshot full join
- [ ] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P10` — previous relevant-timestamp full join
- [ ] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P11` — missing snapshot for block hash
- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P12` — missing genesis snapshot
- [x] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P13` — missing machine state for genesis hash
- [ ] `UNIT-TEST-STORAGE-FACADE-1-TF3MZ1.P14` — membership-change union without explicit resulting hash
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

## UNIT-TEST-STORAGE-FACADE-3-5EA2ND

The prune operations delete exactly one phase's set across the block, snapshot, state and change-point stores.

- Setup: Store a fork genesis with its state and blocks 0..n, each with its own snapshot, state and change point, through the real stores; optionally let two heights, or a height and the genesis, hold one same state, or a second fork's genesis hold a state of the first. Call `pruneSkippedHistory`, `pruneBelowAnchor` and `pruneFork`.
- Oracle: The returned counts and the held blocks, snapshots, states and change points per height match the phase's set; a state another held snapshot references stays.

- [x] `UNIT-TEST-STORAGE-FACADE-3-5EA2ND.P1` — `pruneSkippedHistory` with anchor 0 and final point 3 over blocks 0..4: blocks and states 1 and 2 are gone; their snapshots, the anchor and final-point blocks, the tail and the change points stay
- [x] `UNIT-TEST-STORAGE-FACADE-3-5EA2ND.P2` — `pruneSkippedHistory` with the anchor at the fork genesis (-1): block 0 is skipped history too, the genesis state stays
- [x] `UNIT-TEST-STORAGE-FACADE-3-5EA2ND.P3` — `pruneSkippedHistory` where a skipped block shares its state with the final point: that state stays, the other skipped state is gone
- [x] `UNIT-TEST-STORAGE-FACADE-3-5EA2ND.P4` — `pruneSkippedHistory` with the final point right above the anchor: nothing is deleted
- [x] `UNIT-TEST-STORAGE-FACADE-3-5EA2ND.P5` — `pruneBelowAnchor` at 2 over blocks 0..4: blocks, snapshots, states and change points 0 and 1 are gone; the anchor block with its snapshot and state, the blocks above and the fork genesis with its state stay
- [x] `UNIT-TEST-STORAGE-FACADE-3-5EA2ND.P6` — `pruneBelowAnchor` where a pruned block's state is the genesis state: the genesis state stays
- [x] `UNIT-TEST-STORAGE-FACADE-3-5EA2ND.P7` — `pruneBelowAnchor` at height 0: nothing is deleted
- [x] `UNIT-TEST-STORAGE-FACADE-3-5EA2ND.P8` — `pruneFork` of a left fork: its blocks, snapshots (the genesis too), states and change points are gone; a state the next fork's genesis holds stays, and the next fork is untouched
