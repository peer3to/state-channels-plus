# RpcContractExecutor.ts

> **Source:** [src/evm/contractExecutor/RpcContractExecutor.ts](../../../../../../../src/evm/contractExecutor/RpcContractExecutor.ts)
>
> **Design views:** [Runtime and concurrency](../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-6-6F4SSM` (Cross-context clock equivalence)](../../../../../specification/runtime/execution.md#req-runtime-6-6f4ssm)

## UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7

Worker executor lifecycle

- Setup: Create through SDK-owned setup with real precompiles; call and dispose
- Oracle: Results, logs, and errors cross intact; readiness completes before return; work is serialized; disposal settles once

- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P1` — precompile runs in worker
- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P2` — delayed precompile readiness gates worker return
- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P3` — logs serialize
- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P4` — idempotent disposal
- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P5` — post-disposal rejection
- [ ] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P6` — inline and worker serialization
- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P7` — concurrent success/error response correlation
- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P8` — a watchdog trip is one detached report carrying `eventLoopDelay`, and the executor still serves
- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P9` — an autonomous throw in the worker is one detached report, and the executor still serves
- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P10` — a worker exit after readiness rejects pending and later calls with the exit as the cause, never as a detached report
- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P11` — a worker failure before its funnel exists rejects SDK-owned creation with the original error
- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P12` — a request in flight when the worker exits rejects with the exit as the cause, as does a later request
- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P13` — an error thrown in the first microtask after the host starts is one detached report and the executor still serves
- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P16` — request failure preserves nested revert data and peer metadata across the worker
- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P17` — late worker failure after disposal leaves the pending request rejected only by disposal
- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P18` — a detached crash in the production worker is one report and the executor still serves
- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P19` — the caller's logger keeps logging and uploading after the worker crashed
- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P20` — the worker's logs file under the vm thread with the host's identity
- [x] `UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P21` — a detached crash uploads every linked realm
