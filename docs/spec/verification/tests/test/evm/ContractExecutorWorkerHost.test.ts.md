# ContractExecutorWorkerHost.test.ts

Test file: [test/evm/ContractExecutorWorkerHost.test.ts](../../../../../../test/evm/ContractExecutorWorkerHost.test.ts)
Exercises: [ContractExecutorService.ts](../../../../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md)

## Overview

Real host protocol requests exercise configured, disabled and injected monitoring. Count-and-forward logger instrumentation observes start and stop; the injected sample source records disposal.

## Tests

- `starts the configured monitor without injected options and stops it on dispose`: UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P8
- `does not start a disabled monitor without injected options`: UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P9
- `stops the injected sample source on dispose`: UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P10
