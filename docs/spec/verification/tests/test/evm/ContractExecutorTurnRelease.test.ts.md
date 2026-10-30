# ContractExecutorTurnRelease.test.ts

Test file: [test/evm/ContractExecutorTurnRelease.test.ts](../../../../../../test/evm/ContractExecutorTurnRelease.test.ts)

## Overview

Issues a second local EVM call from the first call resolution or rejection. Checks that it completes in a later loop iteration, with correct ordering and result.

## Tests

- `a call issued from the previous call's resolution, with nothing queued, finishes in a later loop iteration; results are correct and in order`: UNIT-TEST-CONTRACT-EXECUTOR-3-2FRV62.P1
- `a reverting call still releases the lock: the call issued from its rejection finishes in a later loop iteration with its correct result`: UNIT-TEST-CONTRACT-EXECUTOR-3-2FRV62.P2
