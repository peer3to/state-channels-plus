# StateCache.ts

> **Source:** [src/utils/node/storageDiff/StateCache.ts](../../../../../../../../src/utils/node/storageDiff/StateCache.ts)

## Requirements

- [`REQ-SDS-7-PZCBQ9` (State reads come from one shared cache)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-7-pzcbq9)
- [`REQ-SDS-9-ZRPZZW` (A subscription is anchored by a complete snapshot, or told none is coming)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-9-zrpzzw)
- [`REQ-SDS-12-JDW71Y` (What peers can make the service hold is bounded)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-12-jdw71y)

## UNIT-TEST-SDS-STATE-CACHE-1-4B9043

`StateCache` moves the fields it holds forward over a block's `post` and back over its `pre`, and touches no field nobody read.

- Setup: Fill a cache with slot, balance, nonce and code values, then apply records forward and backward: a write to cached and uncached fields, a balance in non-canonical form, a rolled-back write, a rolled-back block that created the account; then clear it, and forget one of two accounts.
- Oracle: Each read through `get` equals the value the chain has after (or before) the applied records; uncached fields stay unread; a rolled-back created account reads empty; a cleared cache reads nothing; a forgotten account reads nothing and the other keeps its fields.

- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P1` — cached fields move forward over a block and fields nobody read stay uncached
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P2` — a balance a block writes is kept in canonical form
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P3` — a cached slot moves back to its pre value over a rolled-back block
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P4` — the cached fields of an account a rolled-back block created are emptied
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P5` — clear forgets every field
- [x] `UNIT-TEST-SDS-STATE-CACHE-1-4B9043.P6` — forget drops every field of one account and keeps another account's
