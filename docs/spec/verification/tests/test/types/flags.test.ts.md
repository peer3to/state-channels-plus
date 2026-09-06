# test/types/flags.test.ts — Test Report

> **Test file:** [flags.test.ts](../../../../../../test/types/flags.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [flags.ts.md](../../../../implementation/source/src/types/flags.ts.md)

## Overview

Call the predicate for every current status and an unknown numeric value; only pending participant and participating return true.

## Tests and covered test IDs

| Test declaration                                                                                                               | Covers                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [`isCommittedParticipantStatus > classifies PENDING_PARTICIPANT`](../../../../../../test/types/flags.test.ts#L5) (line 5)      | [`UNIT-TEST-FLAGS-32-1ZFQY7.P1`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p1) |
| [`isCommittedParticipantStatus > classifies PARTICIPATING`](../../../../../../test/types/flags.test.ts#L10) (line 10)          | [`UNIT-TEST-FLAGS-32-1ZFQY7.P2`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p2) |
| [`isCommittedParticipantStatus > classifies DISCOVERING`](../../../../../../test/types/flags.test.ts#L15) (line 15)            | [`UNIT-TEST-FLAGS-32-1ZFQY7.P3`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p3) |
| [`isCommittedParticipantStatus > classifies NOT_OPENED`](../../../../../../test/types/flags.test.ts#L20) (line 20)             | [`UNIT-TEST-FLAGS-32-1ZFQY7.P4`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p4) |
| [`isCommittedParticipantStatus > classifies OPENED`](../../../../../../test/types/flags.test.ts#L23) (line 23)                 | [`UNIT-TEST-FLAGS-32-1ZFQY7.P5`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p5) |
| [`isCommittedParticipantStatus > classifies SYNCED`](../../../../../../test/types/flags.test.ts#L26) (line 26)                 | [`UNIT-TEST-FLAGS-32-1ZFQY7.P6`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p6) |
| [`isCommittedParticipantStatus > rejects an unknown numeric status`](../../../../../../test/types/flags.test.ts#L29) (line 29) | [`UNIT-TEST-FLAGS-32-1ZFQY7.P7`](../../../../implementation/source/src/types/flags.ts.md#unit-test-flags-32-1zfqy7.p7) |
