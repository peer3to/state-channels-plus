# RpcContractExecutorWorker.test.ts

Test file: [test/evm/RpcContractExecutorWorker.test.ts](../../../../../../test/evm/RpcContractExecutorWorker.test.ts)
Exercises: [RpcContractExecutor.ts](../../../../implementation/source/src/evm/contractExecutor/RpcContractExecutor.ts.md)

## Overview

These cases obtain the actual executor through SDK setup with its owning root, callback service and connection. Real worker entries and manifest precompiles exercise readiness, concurrent success/error correlation, logs, disposal, first-fatal-error selection and detached report-and-continue behavior. Both placements exercise the same RPC facade and canonical engine mutex. Crash collection reaches the linked stores and preserves the supplied caller logger.

Scripted fault entries use production bootstrap. Load-time failure rejects SDK-owned construction with the original error; an error after funnel installation reports once and leaves the worker serving. The removed standalone factory/no-route cases receive no coverage credit.

## Tests

- `request failure preserves nested revert data and peer metadata across the worker`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P16
- `should execute custom precompiles in worker mode`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P1, UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P2, UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P1
- `should wait for precompile readiness before returning`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P2, UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P1, REQ-RUNTIME-3-VQXW59.T2.P2
- `should correlate a worker error with a concurrent successful response`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P7, UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P3, UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P2, UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P3
- `should return RPC-style logs from the worker`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P3
- `late worker failure after disposal leaves the pending request rejected only by disposal`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P17
- `should dispose idempotently`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P4, UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P4, UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P4
- `should reject calls immediately after disposal`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P5
- `reports a detached worker crash and keeps serving`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P18
- `keeps the caller's logger working after the worker crashed`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P19
- `uploads the worker's logs under the vm thread`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P20, REQ-LOG-6-Q8KY4N.T1.P3
- `an unhandled rejection in the worker uploads every linked realm`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P21
- `should serialize simulations with local writes (inline)`: none
- `should serialize simulations with local writes (worker)`: none
- `reports a watchdog trip once with its delay data and keeps serving`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P8, UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P5
- `reports an autonomous throw once and keeps serving`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P9, UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P6, UNIT-TEST-CREATE-CONTRACT-EXECUTOR-1-M5H56N.P1
- `fails every pending and later call when the worker exits after readiness`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P10, REQ-RUNTIME-3-VQXW59.T1.P11
- `rejects creation when the worker fails before its funnel exists`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P11, REQ-RUNTIME-3-VQXW59.T1.P12
- `fails a request that is in flight when the worker exits, with the exit as the cause`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P12, REQ-RUNTIME-3-VQXW59.T1.P13
- `reports an error thrown right after the host starts, before any request`: UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P13, UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P7, REQ-RUNTIME-3-VQXW59.T1.P14
- `does not export a standalone executor factory`: none
- `node runtime keeps the first error when the exit follows it`: UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P1
