# test/types/flags.test.ts — Test Report

> **Test file:** [flags.test.ts](../../../../../../test/types/flags.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [flags.ts.md](../../../../implementation/source/src/types/flags.ts.md)

## Overview

Committed and engaged statuses have separate test declarations and obligations.

Call the predicate for every current status and an unknown numeric value; only pending participant and participating return true.

## Tests and covered test IDs

| Test                                                                                                                           | Covers                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| [`isCommittedParticipantStatus > classifies PENDING_PARTICIPANT`](../../../../../../test/types/flags.test.ts#L9) (line 9)      | [`UNIT-TEST-FLAGS-32-1ZFQY7.P1`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p1)   |
| [`isCommittedParticipantStatus > classifies PARTICIPATING`](../../../../../../test/types/flags.test.ts#L14) (line 14)          | [`UNIT-TEST-FLAGS-32-1ZFQY7.P2`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p2)   |
| [`isCommittedParticipantStatus > classifies DISCOVERING`](../../../../../../test/types/flags.test.ts#L19) (line 19)            | [`UNIT-TEST-FLAGS-32-1ZFQY7.P3`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p3)   |
| [`isCommittedParticipantStatus > classifies NOT_OPENED`](../../../../../../test/types/flags.test.ts#L24) (line 24)             | [`UNIT-TEST-FLAGS-32-1ZFQY7.P4`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p4)   |
| [`isCommittedParticipantStatus > classifies OPENED`](../../../../../../test/types/flags.test.ts#L27) (line 27)                 | [`UNIT-TEST-FLAGS-32-1ZFQY7.P5`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p5)   |
| [`isCommittedParticipantStatus > classifies SYNCED`](../../../../../../test/types/flags.test.ts#L30) (line 30)                 | [`UNIT-TEST-FLAGS-32-1ZFQY7.P6`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p6)   |
| [`isCommittedParticipantStatus > rejects an unknown numeric status`](../../../../../../test/types/flags.test.ts#L33) (line 33) | [`UNIT-TEST-FLAGS-32-1ZFQY7.P7`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p7)   |
| [`isEngagedStatus > classifies PENDING_PARTICIPANT`](../../../../../../test/types/flags.test.ts#L39) (line 39)                 | [`UNIT-TEST-FLAGS-32-1ZFQY7.P8`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p8)   |
| [`isEngagedStatus > classifies PARTICIPATING`](../../../../../../test/types/flags.test.ts#L42) (line 42)                       | [`UNIT-TEST-FLAGS-32-1ZFQY7.P9`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p9)   |
| [`isEngagedStatus > classifies DISCOVERING`](../../../../../../test/types/flags.test.ts#L45) (line 45)                         | [`UNIT-TEST-FLAGS-32-1ZFQY7.P10`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p10) |
| [`isEngagedStatus > classifies NOT_OPENED`](../../../../../../test/types/flags.test.ts#L48) (line 48)                          | [`UNIT-TEST-FLAGS-32-1ZFQY7.P11`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p11) |
| [`isEngagedStatus > classifies OPENED`](../../../../../../test/types/flags.test.ts#L51) (line 51)                              | [`UNIT-TEST-FLAGS-32-1ZFQY7.P12`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p12) |
| [`isEngagedStatus > classifies SYNCED`](../../../../../../test/types/flags.test.ts#L54) (line 54)                              | [`UNIT-TEST-FLAGS-32-1ZFQY7.P13`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p13) |
| [`isEngagedStatus > rejects an unknown numeric status`](../../../../../../test/types/flags.test.ts#L57) (line 57)              | [`UNIT-TEST-FLAGS-32-1ZFQY7.P14`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p14) |
