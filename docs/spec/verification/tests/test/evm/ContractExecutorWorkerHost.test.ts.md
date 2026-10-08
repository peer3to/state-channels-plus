# test/evm/ContractExecutorWorkerHost.test.ts — Test Report

> **Test file:** [test/evm/ContractExecutorWorkerHost.test.ts](../../../../../../test/evm/ContractExecutorWorkerHost.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [ContractExecutorService.ts](../../../../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md)

## Overview

Real host protocol requests exercise configured, disabled and injected monitoring. Count-and-forward logger instrumentation observes start and stop; the injected sample source records disposal.

## Tests and covered test IDs

| Test                                                                                                                                                                                               | Covers                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ContractExecutorWorkerHost monitor > starts the configured monitor without injected options and stops it on dispose`](../../../../../../test/evm/ContractExecutorWorkerHost.test.ts#L4) (line 4) | [`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P8`](../../../../implementation/source/src/rpc/internal/roots/ContractExecutorRoot.ts.md#unit-test-contract-executor-worker-host-1-2trsyv)  |
| [`ContractExecutorWorkerHost monitor > does not start a disabled monitor without injected options`](../../../../../../test/evm/ContractExecutorWorkerHost.test.ts#L7) (line 7)                     | [`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P9`](../../../../implementation/source/src/rpc/internal/roots/ContractExecutorRoot.ts.md#unit-test-contract-executor-worker-host-1-2trsyv)  |
| [`ContractExecutorWorkerHost monitor > stops the injected sample source on dispose`](../../../../../../test/evm/ContractExecutorWorkerHost.test.ts#L10) (line 10)                                  | [`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P10`](../../../../implementation/source/src/rpc/internal/roots/ContractExecutorRoot.ts.md#unit-test-contract-executor-worker-host-1-2trsyv) |
