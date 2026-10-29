# runCleanup.test.ts

Test file: [test/utils/runCleanup.test.ts](../../../../../../test/utils/runCleanup.test.ts)
Exercises: [runCleanup.ts](../../../../implementation/source/src/utils/runCleanup.ts.md)

## Overview

Direct calls verify synchronous and asynchronous ordering, empty input, continued cleanup after failures, original error identity and undefined rejection preservation.

## Tests

- `accepts empty cleanup sequences`: UNIT-TEST-CLEANUP-1-14NFGW.P1
- `runs synchronous steps in order before returning`: UNIT-TEST-CLEANUP-1-14NFGW.P2
- `continues synchronous cleanup and preserves the first error`: UNIT-TEST-CLEANUP-1-14NFGW.P3
- `awaits each asynchronous step before starting the next`: UNIT-TEST-CLEANUP-1-14NFGW.P4
- `continues after throws and rejections and preserves the first error`: UNIT-TEST-CLEANUP-1-14NFGW.P5
- `preserves an asynchronous rejection before a later synchronous throw`: UNIT-TEST-CLEANUP-1-14NFGW.P6
- `preserves undefined thrown by synchronous cleanup`: UNIT-TEST-CLEANUP-1-14NFGW.P7
- `preserves undefined rejected by asynchronous cleanup`: UNIT-TEST-CLEANUP-1-14NFGW.P8
