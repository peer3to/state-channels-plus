# ContractExecutorTurnRelease.test.ts — Test report

> **Test file:** [test/evm/ContractExecutorTurnRelease.test.ts](../../../../../../test/evm/ContractExecutorTurnRelease.test.ts) > **Status:** Authored; engineer verification pending.

## Overview

Issues a second local EVM call from the first call resolution or rejection. Checks that it completes in a later loop iteration, with correct ordering and result.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                                                                                 | Covers                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ContractExecutor release on the next timer turn > a call issued from the previous call's resolution, with nothing queued, finishes in a later loop iteration; results are correct and in order`](../../../../../../test/evm/ContractExecutorTurnRelease.test.ts#L22) (line 22) | [`UNIT-TEST-CONTRACT-EXECUTOR-3-2FRV62.P1`](../../../../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md#unit-test-contract-executor-3-2frv62.p1) |
| [`ContractExecutor release on the next timer turn > a reverting call still releases the lock: the call issued from its rejection finishes in a later loop iteration with its correct result`](../../../../../../test/evm/ContractExecutorTurnRelease.test.ts#L68) (line 68)      | [`UNIT-TEST-CONTRACT-EXECUTOR-3-2FRV62.P2`](../../../../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md#unit-test-contract-executor-3-2frv62.p2) |
