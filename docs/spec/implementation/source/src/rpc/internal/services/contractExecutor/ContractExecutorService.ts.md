# ContractExecutorService.ts

> **Source:** [src/rpc/internal/services/contractExecutor/ContractExecutorService.ts](../../../../../../../../../src/rpc/internal/services/contractExecutor/ContractExecutorService.ts)
>
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-6-6F4SSM` (Cross-context clock equivalence)](../../../../../../../specification/runtime/execution.md#req-runtime-6-6f4ssm)

## UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K

Transfer-safe executor messages for [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) and readiness input for [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

- Setup: Drive the SDK-owned executor with real precompile options, calls, errors, and disposal.
- Oracle: Boundary values survive exactly; invalid states reject; responses stay correlated.

- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P1` — init configuration and precompile manifest
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P2` — successful request/response correlation
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P3` — serialized error correlation
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P4` — disposal message and terminal state
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P5` — An inline root with a zero adjustment uses wall time even when Clock is initialized
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P6` — An inline root with an explicit adjustment uses that offset rather than the shared Clock
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P7` — Without an adjustment or initialized Clock, real timestamp bytecode observes zero
