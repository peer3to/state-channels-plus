# createContractExecutor.ts

> **Source:** [src/evm/contractExecutor/createContractExecutor.ts](../../../../../../../src/evm/contractExecutor/createContractExecutor.ts)
>
> **Design views:** [Runtime and concurrency](../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`INV-RUNTIME-1-AKRHAK` (Execution equivalence)](../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-6-6F4SSM` (Cross-context clock equivalence)](../../../../../specification/runtime/execution.md#req-runtime-6-6f4ssm)

## UNIT-TEST-CREATE-CONTRACT-EXECUTOR-1-M5H56N

Detached-error route selection

- Setup: Build the dedicated executor through genuine SDK setup with its supplied owner and the scripted worker entry
- Oracle: The supplied SDK route receives the report once and the executor keeps serving; no report is dropped

- [x] `UNIT-TEST-CREATE-CONTRACT-EXECUTOR-1-M5H56N.P1` — the supplied SDK route receives one detached report and the worker keeps serving
