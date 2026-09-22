# HostRpcService.ts

> **Source:** [src/rpc/internal/services/hostRpc/HostRpcService.ts](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcService.ts)
>
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

## UNIT-TEST-HOST-RPC-1-X1QFZA

Unknown service and unsupported delivery selectors reject before proxy invocation; the host remains usable.

- Setup: Real owner with scoped inputs.
- Oracle: Unknown service and unsupported delivery selectors reject before proxy invocation; the host remains usable.

- [x] `UNIT-TEST-HOST-RPC-1-X1QFZA.P1` — Unknown service and unsupported delivery selectors reject before proxy invocation; the host remains usable
