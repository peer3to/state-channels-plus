# BlockStorage.ts

> **Source:** [src/storage/BlockStorage.ts](../../../../../../src/storage/BlockStorage.ts)
>
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`INV-BLKSTORE-1-MK4W8D` (Index consistency)](../../../../specification/storage/blocks.md#inv-blkstore-1-mk4w8d)
- [`REQ-BLKSTORE-1-KYHTWT` (Same-coordinate conflict is not resolved here)](../../../../specification/storage/blocks.md#req-blkstore-1-kyhtwt)
- [`REQ-BLKSTORE-2-VWXP2C` (Monotone signature merge)](../../../../specification/storage/blocks.md#req-blkstore-2-vwxp2c)
  Contradicts: Timestamp clause violated here: unconditional overwrite in setter and merge — later replaces earlier; earliest-wins holds only upstream, so a later calldata copy bypasses it. See [`OQ-IMPL-BLOCKSTORAGE-TIMESTAMP-1-SMXDZS`](../../../open-questions.md#oq-impl-blockstorage-timestamp-1-smxdzs).
- [`REQ-BLKSTORE-3-S9V2KC` (Tip tracking and bounded traversal)](../../../../specification/storage/blocks.md#req-blkstore-3-s9v2kc)
- [`REQ-STOR-6-SKP0KM` (Value semantics at the store boundary)](../../../../specification/storage/durability.md#req-stor-6-skp0km)
  Contradicts: `getIterator` yields the store's own `Block` objects and the wrapping proxy exempts generators, so a caller can mutate stored blocks without a store operation ([`FIND-STORAGE-6-MT9Z2D`](../../../../audit/open-findings.md#find-storage-6-mt9z2d)).

## UNIT-TEST-BLOCK-STORAGE-1-FY94TH

Index consistency and conflict refusal

- Setup: Store, merge, delete via both key forms; attempt same-coordinate different-block stores
- Oracle: Both indexes always agree; conflicting store returns absence with original intact; equal store merges

- [x] `UNIT-TEST-BLOCK-STORAGE-1-FY94TH.P1` — store/read via both keys
- [x] `UNIT-TEST-BLOCK-STORAGE-1-FY94TH.P2` — delete via hash key removes both
- [x] `UNIT-TEST-BLOCK-STORAGE-1-FY94TH.P3` — conflicting body refused
- [x] `UNIT-TEST-BLOCK-STORAGE-1-FY94TH.P4` — equal body merges signatures
- [x] `UNIT-TEST-BLOCK-STORAGE-1-FY94TH.P5` — delete via coordinate key removes both

## UNIT-TEST-BLOCK-STORAGE-2-K77ECA

Timestamp semantics

- Setup: Set timestamps by hash and coordinates; merge copies carrying timestamps in both orders
- Oracle: Documents current overwrite behavior vs the earliest-wins requirement (expected-fail until the engineer decision)

- [x] `UNIT-TEST-BLOCK-STORAGE-2-K77ECA.P1` — earlier-then-later
- [ ] `UNIT-TEST-BLOCK-STORAGE-2-K77ECA.P2` — later-then-earlier
- [ ] `UNIT-TEST-BLOCK-STORAGE-2-K77ECA.P3` — merge-carried timestamp vs setter

## UNIT-TEST-BLOCK-STORAGE-3-ZPT4BN

Tip and traversal bounds

- Setup: Store extending, backfill (justPersist), and out-of-order blocks; iterate with absurd bounds
- Oracle: Tip reflects only live stores; iteration clamps; latest-block agrees with tip

- [x] `UNIT-TEST-BLOCK-STORAGE-3-ZPT4BN.P1` — tip advancement
- [ ] `UNIT-TEST-BLOCK-STORAGE-3-ZPT4BN.P2` — justPersist leaves tip
- [x] `UNIT-TEST-BLOCK-STORAGE-3-ZPT4BN.P3` — absurd remote-supplied bound clamped
- [x] `UNIT-TEST-BLOCK-STORAGE-3-ZPT4BN.P4` — out-of-order store

## UNIT-TEST-BLOCK-STORAGE-32-DHXM4N

Block merge and lookup mutations

- Setup: Use factory-built copies and explicit storage keys; check timestamp values, missing-target booleans and merged signatures through public lookup/mutation methods.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-BLOCK-STORAGE-32-DHXM4N.P1` — sets a zero timestamp through the hash overload
- [x] `UNIT-TEST-BLOCK-STORAGE-32-DHXM4N.P2` — sets a timestamp through the coordinate overload
- [x] `UNIT-TEST-BLOCK-STORAGE-32-DHXM4N.P3` — returns false for absent timestamp targets in both overloads
- [x] `UNIT-TEST-BLOCK-STORAGE-32-DHXM4N.P4` — updates timestamp and signatures through explicit storage keys
- [x] `UNIT-TEST-BLOCK-STORAGE-32-DHXM4N.P5` — duplicate storage insertion keeps time when the incoming copy has none
