# GasUsageReadSettle.test.ts

Test file: [test/unit/GasUsageReadSettle.test.ts](../../../../../../test/unit/GasUsageReadSettle.test.ts)
Exercises: [ChainSignerService.ts](../../../../implementation/source/src/rpc/internal/services/chainSigner/ChainSignerService.ts.md)

## Overview

Inits the `Clock` on a private chain whose blocks are 2 s or 12 s apart and reads `gasUsageReadSettleMs`: 6000 ms on 2 s blocks, the 15000 ms cap (half a 30 s request timeout) on 12 s blocks, and the full 36000 ms when the request has no timeout.

## Tests

- `waits three blocks at the measured block time when that fits half the request timeout`: UNIT-TEST-GAS-USAGE-READ-SETTLE-1-04CYEA.P1
- `waits half the request timeout when three blocks take longer`: UNIT-TEST-GAS-USAGE-READ-SETTLE-1-04CYEA.P2
- `waits three blocks when the request has no timeout`: UNIT-TEST-GAS-USAGE-READ-SETTLE-1-04CYEA.P3
