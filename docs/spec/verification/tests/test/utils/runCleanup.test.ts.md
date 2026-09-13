# runCleanup.test.ts

> **Test file:** [test/utils/runCleanup.test.ts](../../../../../../test/utils/runCleanup.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [runCleanup.ts](../../../../implementation/source/src/utils/runCleanup.ts.md)

## Overview

Direct calls verify synchronous and asynchronous ordering, empty input, continued cleanup after failures, original error identity and undefined rejection preservation.

## Tests and covered test IDs

| Test                                                                                                                                               | Covers                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [runCleanup > accepts empty cleanup sequences](../../../../../../test/utils/runCleanup.test.ts#L5) (line 5)                                        | [`UNIT-TEST-CLEANUP-1-14NFGW.P1`](../../../../implementation/source/src/utils/runCleanup.ts.md#unit-test-cleanup-1-14nfgw.p1) |
| [runCleanup > runs synchronous steps in order before returning](../../../../../../test/utils/runCleanup.test.ts#L10) (line 10)                     | [`UNIT-TEST-CLEANUP-1-14NFGW.P2`](../../../../implementation/source/src/utils/runCleanup.ts.md#unit-test-cleanup-1-14nfgw.p2) |
| [runCleanup > continues synchronous cleanup and preserves the first error](../../../../../../test/utils/runCleanup.test.ts#L23) (line 23)          | [`UNIT-TEST-CLEANUP-1-14NFGW.P3`](../../../../implementation/source/src/utils/runCleanup.ts.md#unit-test-cleanup-1-14nfgw.p3) |
| [runCleanup > awaits each asynchronous step before starting the next](../../../../../../test/utils/runCleanup.test.ts#L44) (line 44)               | [`UNIT-TEST-CLEANUP-1-14NFGW.P4`](../../../../implementation/source/src/utils/runCleanup.ts.md#unit-test-cleanup-1-14nfgw.p4) |
| [runCleanup > continues after throws and rejections and preserves the first error](../../../../../../test/utils/runCleanup.test.ts#L59) (line 59)  | [`UNIT-TEST-CLEANUP-1-14NFGW.P5`](../../../../implementation/source/src/utils/runCleanup.ts.md#unit-test-cleanup-1-14nfgw.p5) |
| [runCleanup > preserves an asynchronous rejection before a later synchronous throw](../../../../../../test/utils/runCleanup.test.ts#L79) (line 79) | [`UNIT-TEST-CLEANUP-1-14NFGW.P6`](../../../../implementation/source/src/utils/runCleanup.ts.md#unit-test-cleanup-1-14nfgw.p6) |
| [runCleanup > preserves undefined thrown by synchronous cleanup](../../../../../../test/utils/runCleanup.test.ts#L94) (line 94)                    | [`UNIT-TEST-CLEANUP-1-14NFGW.P7`](../../../../implementation/source/src/utils/runCleanup.ts.md#unit-test-cleanup-1-14nfgw.p7) |
| [runCleanup > preserves undefined rejected by asynchronous cleanup](../../../../../../test/utils/runCleanup.test.ts#L112) (line 112)               | [`UNIT-TEST-CLEANUP-1-14NFGW.P8`](../../../../implementation/source/src/utils/runCleanup.ts.md#unit-test-cleanup-1-14nfgw.p8) |
