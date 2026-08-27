# test/utils/logging/LogFlushBus.test.ts — Test Report

> **Test file:** [test/utils/logging/LogFlushBus.test.ts](../../../../../../../test/utils/logging/LogFlushBus.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [LogFlushBus.ts](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives real `LogFlushBus` instances joined by real `MessageChannel` port pairs — the same
shape the runtime and executor ports have — against a real HTTP receiver. No mocks: each fake thread
gets its own bus, logger, store and uploader, and every assertion is made on what reached the
receiver or on the totals a round returned, never on the in-memory store.

It covers the four things a collection has to get right: that a round reaches every connected realm
whichever one starts it and never echoes back to its sender; that rounds started at once finish
independently and repeats coalesce; that a realm which never answers is given up on at the bound
while one already removed costs nothing; and that the totals a caller receives distinguish uploaded,
failed and timed out. It also covers identity crossing a port — taken in full from a parent, channel
only from a child — and the same-realm follow used when there is no port between two roots.

Out of scope here: the delta watermark and the stored-chunk layout, which
[LogUploaderDelta.test.ts](../../../../../../test/utils/logging/LogUploaderDelta.test.ts) and the
crash-log server suites own.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                               | Covers                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`LogFlushBus > uploads a connected realm's logger`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L87) (line 87)                                                | [`UNIT-TEST-LOGBUS-1-Q6HZ2Q.P1`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-1-q6hz2q.p1) |
| [`LogFlushBus > reaches a realm two ports away`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L98) (line 98)                                                    | [`UNIT-TEST-LOGBUS-1-Q6HZ2Q.P2`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-1-q6hz2q.p2) |
| [`LogFlushBus > a flush started in the leaf realm uploads the root realm`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L111) (line 111)                        | [`UNIT-TEST-LOGBUS-1-Q6HZ2Q.P3`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-1-q6hz2q.p3) |
| [`LogFlushBus > does not echo the flush to the sender`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L124) (line 124)                                           | [`UNIT-TEST-LOGBUS-1-Q6HZ2Q.P4`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-1-q6hz2q.p4) |
| [`LogFlushBus > resolves after every connected realm has uploaded`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L139) (line 139)                               | [`UNIT-TEST-LOGBUS-3-151GBT.P3`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-3-151gbt.p3) |
| [`LogFlushBus > resolves when a port never acks`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L155) (line 155)                                                 | [`UNIT-TEST-LOGBUS-3-151GBT.P1`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-3-151gbt.p1) |
| [`LogFlushBus > ignores a port removed before the flush`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L172) (line 172)                                         | [`UNIT-TEST-LOGBUS-3-151GBT.P2`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-3-151gbt.p2) |
| [`LogFlushBus > coalesces concurrent flush requests`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L186) (line 186)                                             | [`UNIT-TEST-LOGBUS-2-M0271X.P2`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-2-m0271x.p2) |
| [`LogFlushBus > acks a request that arrives while a round is in flight`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L201) (line 201)                          | [`UNIT-TEST-LOGBUS-2-M0271X.P3`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-2-m0271x.p3) |
| [`LogFlushBus > two realms originating at once both resolve without a timeout`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L231) (line 231)                   | [`UNIT-TEST-LOGBUS-2-M0271X.P1`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-2-m0271x.p1) |
| [`LogFlushBus > a round folded from two children forwards back to neither`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L253) (line 253)                       | [`UNIT-TEST-LOGBUS-2-M0271X.P4`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-2-m0271x.p4) |
| [`LogFlushBus > error() uploads only this realm's store`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L285) (line 285)                                         | [`UNIT-TEST-LOGBUS-4-GJVE9W.P4`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-4-gjve9w.p4) |
| [`LogFlushBus > a child logger does not add a second upload`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L298) (line 298)                                     | [`UNIT-TEST-LOGBUS-1-Q6HZ2Q.P5`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-1-q6hz2q.p5) |
| [`LogFlushBus > a disposed logger is not uploaded`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L311) (line 311)                                               | [`UNIT-TEST-LOGBUS-1-Q6HZ2Q.P6`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-1-q6hz2q.p6) |
| [`LogFlushBus > posts nothing when uploads are disabled`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L325) (line 325)                                         | [`UNIT-TEST-LOGBUS-1-Q6HZ2Q.P7`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-1-q6hz2q.p7) |
| [`LogFlushBus > context set after connecting reaches the leaf before its first upload`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L344) (line 344)           | [`UNIT-TEST-LOGBUS-5-XCSMZB.P1`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-5-xcsmzb.p1) |
| [`LogFlushBus > a crash raised in the leaf realm uploads under the channel set after connecting`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L359) (line 359) | [`UNIT-TEST-LOGBUS-5-XCSMZB.P2`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-5-xcsmzb.p2) |
| [`LogFlushBus > does not apply a peer address arriving from a child`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L389) (line 389)                             | [`UNIT-TEST-LOGBUS-5-XCSMZB.P3`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-5-xcsmzb.p3) |
| [`LogFlushBus > a second root in the same realm follows the channel`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L410) (line 410)                             | [`UNIT-TEST-LOGBUS-5-XCSMZB.P4`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-5-xcsmzb.p4) |
| [`LogFlushBus > does not pass peer identity to the following root`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L425) (line 425)                               | [`UNIT-TEST-LOGBUS-5-XCSMZB.P5`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-5-xcsmzb.p5) |
| [`LogFlushBus > reports one ok realm per connected thread`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L441) (line 441)                                       | [`UNIT-TEST-LOGBUS-4-GJVE9W.P1`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-4-gjve9w.p1) |
| [`LogFlushBus > reports a realm whose upload failed`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L459) (line 459)                                             | [`UNIT-TEST-LOGBUS-4-GJVE9W.P2`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-4-gjve9w.p2) |
| [`LogFlushBus > reports a port that never acked as timed out`](../../../../../../../test/utils/logging/LogFlushBus.test.ts#L478) (line 478)                                    | [`UNIT-TEST-LOGBUS-4-GJVE9W.P3`](../../../../../implementation/source/src/utils/logging/LogFlushBus.ts.md#unit-test-logbus-4-gjve9w.p3) |
