# test/evm/ContractExecutorWithoutClock.test.ts — Test Report

> **Test file:** [test/evm/ContractExecutorWithoutClock.test.ts](../../../../../../test/evm/ContractExecutorWithoutClock.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [ContractExecutor.ts](../../../../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md)

## Overview

The inline and dedicated factories are created before Clock initialization. Both expose ambient time zero, and neither test shares a file-level Clock.init hook.

## Tests and covered test IDs

| Test                                                                                                                                                                                           | Covers                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ContractExecutor without a runtime Clock > the inline factory uses time zero before Clock initialization`](../../../../../../test/evm/ContractExecutorWithoutClock.test.ts#L8) (line 8)      | [`UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P4`](../../../../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md#unit-test-contract-executor-1-jhg6kj.p4) |
| [`ContractExecutor without a runtime Clock > the dedicated factory uses time zero before Clock initialization`](../../../../../../test/evm/ContractExecutorWithoutClock.test.ts#L19) (line 19) | [`UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P5`](../../../../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md#unit-test-contract-executor-1-jhg6kj.p5) |
