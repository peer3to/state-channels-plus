# BlacklistStorage.test.ts — Verification Report

> **Test file:** [test/storage/BlacklistStorage.test.ts](../../../../../../test/storage/BlacklistStorage.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [BlacklistStorage](../../../../implementation/source/src/storage/BlacklistStorage.ts.md)

## Overview

Direct black-box cases on the persisted verdict store: a verdict is recorded with its reason and read back
by address, a second verdict keeps the first reason, every operation normalizes the address to its
checksum form, an absent address reads as absent and removes as a no-op, and clearing empties the record.
No manager or transport is involved; the store is the whole component.

## Tests and covered test IDs

| Test declaration                                                                                                                                                 | Covers                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`BlacklistStorage > records a verdict with its reason and reports it by address`](../../../../../../test/storage/BlacklistStorage.test.ts#L8) (line 8)          | [`UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P1`](../../../../implementation/source/src/storage/BlacklistStorage.ts.md#unit-test-blacklist-storage-1-c0xqyf) |
| [`BlacklistStorage > keeps the first reason when the same address is recorded again`](../../../../../../test/storage/BlacklistStorage.test.ts#L22) (line 22)     | [`UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P2`](../../../../implementation/source/src/storage/BlacklistStorage.ts.md#unit-test-blacklist-storage-1-c0xqyf) |
| [`BlacklistStorage > keys every operation by the checksummed address`](../../../../../../test/storage/BlacklistStorage.test.ts#L30) (line 30)                    | [`UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P4`](../../../../implementation/source/src/storage/BlacklistStorage.ts.md#unit-test-blacklist-storage-1-c0xqyf) |
| [`BlacklistStorage > reports a missing address as absent and a removal of it as a no-op`](../../../../../../test/storage/BlacklistStorage.test.ts#L42) (line 42) | [`UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P3`](../../../../implementation/source/src/storage/BlacklistStorage.ts.md#unit-test-blacklist-storage-1-c0xqyf) |
| [`BlacklistStorage > clears every verdict`](../../../../../../test/storage/BlacklistStorage.test.ts#L51) (line 51)                                               | [`UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P5`](../../../../implementation/source/src/storage/BlacklistStorage.ts.md#unit-test-blacklist-storage-1-c0xqyf) |
