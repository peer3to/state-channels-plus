# ExitChannelBlockStorage.test.ts

Test file: [test/storage/ExitChannelBlockStorage.test.ts](../../../../../../test/storage/ExitChannelBlockStorage.test.ts)
Exercises: [MessageBlockStorage.ts](../../../../implementation/source/src/storage/MessageBlockStorage.ts.md)

## Overview

The suite exercises `MessageBlockStorage` as the outbound (exit-channel) instance, using
factory-built exit-channel message blocks rebased onto a height-0 genesis. It covers
content-addressed stores under computed and caller-provided hashes, a duplicate store returning
the same hash, `undefined` for unknown hashes, a backward range read over a two-block linked
chain, and the latest-block helpers advancing to a higher linked block and sorting newest to
oldest. Gapped or unlinked chains, bound edge shapes, `justPersist` opt-out, equal-height
stores, and inbound/outbound isolation are not exercised, so most tip- and range-read
permutations are either covered by the inbound suite or stay unassigned; the duplicate-store
tests assert only hash equality, which is not enough for the idempotence permutations.

## Tests

- `stores block with computed hash`: none
- `accepts provided hash`: none
- `ignores duplicate stores`: none
- `returns undefined for unknown hashes`: none
- `retrieves block by hash`: none
- `returns ordered message blocks when iterating by range`: none
- `returns the most recent block`: UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P1
- `returns blocks sorted from newest to oldest when no limit is provided`: none
- `MessageBlockStorage - outbound behavior > latest block helpers > head above a hole → truncates at the gap instead of throwing`: none
