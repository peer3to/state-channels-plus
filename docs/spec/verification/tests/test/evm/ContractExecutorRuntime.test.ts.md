# ContractExecutorRuntime.test.ts

Test file: [test/evm/ContractExecutorRuntime.test.ts](../../../../../../test/evm/ContractExecutorRuntime.test.ts)

## Overview

The suite exercises actual SDK-owned components and connections. Each declaration checks its named outcome through the production implementation; shared setup and fault controls live in fixtures.

## Tests

- `waits for inline initialization and the ready signal before returning`: UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P1
- `waits for worker initialization and the ready signal before returning`: UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P2
- `keeps the supplied inline logger and starts no duplicate monitor`: UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P3
- `normalizes inline manifest addresses and preserves optional binary and BigInt values`: UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P4
- `normalizes worker manifest addresses and preserves optional binary and BigInt values`: UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P5
- `installs no probe or controller during ordinary SDK construction`: UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P6
- `keeps canonical calls and simulations ordered through the inline RPC adapter`: UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P7
- `keeps canonical calls and simulations ordered through the worker RPC adapter`: UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P8, UNIT-TEST-NODE-EXECUTOR-URL-1-59B523.P1
- `preserves inline revert bytes and serves the next call`: UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P9
- `preserves worker revert bytes and serves the next call`: UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P10
- `isolates inline returned results from executor-owned state`: UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P11
- `isolates worker returned results from executor-owned state`: UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P12
- `rejects inline calls after repeated executor disposal`: UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P13
- `rejects worker calls after repeated executor disposal`: UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P14
