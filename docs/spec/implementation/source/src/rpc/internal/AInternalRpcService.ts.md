# AInternalRpcService.ts

> **Source:** [src/rpc/internal/AInternalRpcService.ts](../../../../../../../src/rpc/internal/AInternalRpcService.ts)
>
> **Design views:** [Runtime and concurrency](../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

## UNIT-TEST-RUNTIME-DOMAIN-SERVICE-1-CKHC76

Immutable per-invocation sender through awaited forwarding.

- Setup: Actual SDK-owned roots and connected domain services; narrow controls act on those connections.
- Oracle: Release interleaved calls in reverse order and assert each callback reaches its own caller identity.

- [x] `UNIT-TEST-RUNTIME-DOMAIN-SERVICE-1-CKHC76.P1` — Retains each invocation sender across interleaved awaits and callbacks
