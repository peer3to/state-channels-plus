# test/storage/ExitChannelBlockStorage.test.ts — Test Report

> **Test file:** [test/storage/ExitChannelBlockStorage.test.ts](../../../../../../../test/storage/ExitChannelBlockStorage.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [MessageBlockStorage.ts](../../../../implementation/source/src/storage/MessageBlockStorage.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

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

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                            | Covers                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`MessageBlockStorage - outbound behavior > store() > stores block with computed hash`](../../../../../../../test/storage/ExitChannelBlockStorage.test.ts#L28) (line 28)                                                    | —                                                                                                                                                      |
| [`MessageBlockStorage - outbound behavior > store() > accepts provided hash`](../../../../../../../test/storage/ExitChannelBlockStorage.test.ts#L34) (line 34)                                                              | —                                                                                                                                                      |
| [`MessageBlockStorage - outbound behavior > store() > ignores duplicate stores`](../../../../../../../test/storage/ExitChannelBlockStorage.test.ts#L40) (line 40)                                                           | —                                                                                                                                                      |
| [`MessageBlockStorage - outbound behavior > read operations > returns undefined for unknown hashes`](../../../../../../../test/storage/ExitChannelBlockStorage.test.ts#L52) (line 52)                                       | —                                                                                                                                                      |
| [`MessageBlockStorage - outbound behavior > read operations > retrieves block by hash`](../../../../../../../test/storage/ExitChannelBlockStorage.test.ts#L57) (line 57)                                                    | —                                                                                                                                                      |
| [`MessageBlockStorage - outbound behavior > read operations > returns ordered message blocks when iterating by range`](../../../../../../../test/storage/ExitChannelBlockStorage.test.ts#L62) (line 62)                     | —                                                                                                                                                      |
| [`MessageBlockStorage - outbound behavior > latest block helpers > returns the most recent block`](../../../../../../../test/storage/ExitChannelBlockStorage.test.ts#L80) (line 80)                                         | [`UNIT-TEST-MESSAGE-BLOCK-STORAGE-1.P1`](../../../../implementation/source/src/storage/MessageBlockStorage.ts.md#unit-test-message-block-storage-1.p1) |
| [`MessageBlockStorage - outbound behavior > latest block helpers > returns blocks sorted from newest to oldest when no limit is provided`](../../../../../../../test/storage/ExitChannelBlockStorage.test.ts#L98) (line 98) | —                                                                                                                                                      |
