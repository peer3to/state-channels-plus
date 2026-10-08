# ContractExecutorWithoutClock.test.ts

Test file: [test/evm/ContractExecutorWithoutClock.test.ts](../../../../../../test/evm/ContractExecutorWithoutClock.test.ts)
Exercises: [ContractExecutor.ts](../../../../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md)

## Overview

Full SDK setup initializes Clock before constructing its inline or dedicated executor. Each case reads a deployed timestamp contract through that SDK-owned executor and compares it with the live Clock within one second. The former standalone zero-time setup is unreachable through this construction boundary, so these declarations do not receive the old zero-time permutation credits.

## Tests

- `initializes the Clock before creating an inline SDK executor`: UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P15
- `initializes the Clock before creating a dedicated SDK executor`: UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P16
- `uses an explicit zero clock offset even when the shared Clock is initialized`: UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P5
- `uses an explicit clock offset for an inline root`: UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P6
- `keeps timestamp zero without an adjustment or initialized Clock`: UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P7
