# StateCache.ts

> **Source:** [src/utils/node/storageDiff/StateCache.ts](../../../../../../../../src/utils/node/storageDiff/StateCache.ts)

## Requirements

- [`REQ-SDS-7-PZCBQ9` (State reads come from one shared cache)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-7-pzcbq9)
- [`REQ-SDS-9-ZRPZZW` (A subscription is anchored by a complete snapshot, or told none is coming)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-9-zrpzzw)
- [`REQ-SDS-12-JDW71Y` (What peers can make the service hold is bounded)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-12-jdw71y)

## UNIT-TEST-SDS-STATE-CACHE-1-4B9043

`StateCache` moves the fields it holds forward over a block's `post` and back over its `pre`, and touches no field nobody read. For a complete account, one a backfill made whole, every slot counts as held: a slot it lacks reads as zero, and a block's write to it lands in both directions.

- Setup: Fill a cache with slot, balance, nonce and code values, then apply records forward and backward: a write to cached and uncached fields, a balance in non-canonical form, a rolled-back write, a rolled-back block that created the account; make an account complete, apply a write to a slot it lacks, roll back a block that cleared one of its slots, count its non-zero slots, mark it lazy; then clear it, and forget one of two accounts and a complete one.
- Oracle: Each read through `get` equals the value the chain has after (or before) the applied records; uncached fields stay unread; a rolled-back created account reads empty; a complete account reads a slot it lacks as zero and reports its fields in the shape of a record; a lazy account reads its uncached slots as uncached; a cleared cache reads nothing and holds no complete account; a forgotten account reads nothing, is not complete, and the other keeps its fields.

- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P1` — cached fields move forward over a block and fields nobody read stay uncached
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P2` — a balance a block writes is kept in canonical form
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P3` — a cached slot moves back to its pre value over a rolled-back block
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P4` — the cached fields of an account a rolled-back block created are emptied
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P5` — clear forgets every field
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P6` — forget drops every field of one account and keeps another account's
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P7` — a slot a complete account never wrote reads as zero; an unread slot of another account stays uncached
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P8` — a slot of a complete account nobody read moves forward over a block
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P9` — a slot of a complete account moves back to its pre value over a rolled-back block that cleared it
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P10` — making an account complete replaces what was cached of it, and it is reported in the shape of a record
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P11` — only the non-zero slots of an account are counted
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P12` — an account marked lazy keeps its cached slots and reads its other slots as uncached
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P13` — clear forgets that an account was complete
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P14` — forget forgets that an account was complete
