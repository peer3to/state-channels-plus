# createRpcProxy.ts

> **Source:** [src/rpc/createRpcProxy.ts](../../../../../../src/rpc/createRpcProxy.ts)
>
> **Design views:** [Runtime and concurrency](../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RPC-2-SZDTTM` (Request lifecycle)](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-RPC-PROXY-1-R74W81

Derived service-first call types and shared proxy behavior.

- Setup: Actual SDK-owned roots and connected domain services; narrow controls act on those connections.
- Oracle: Compiler assertions reject invalid service/method/args/result/recipient/helper use. Runtime assertions preserve result/void/send semantics, captured peer context and non-thenable roots.

- [x] `UNIT-TEST-RPC-PROXY-1-R74W81.P1` — Reads a mutable peer service context when the captured method is called
- [x] `UNIT-TEST-RPC-PROXY-1-R74W81.P2` — Preserves bound arguments results void acknowledgement and explicit sends
- [x] `UNIT-TEST-RPC-PROXY-1-R74W81.P3` — Keeps runtime proxy roots non-thenable
