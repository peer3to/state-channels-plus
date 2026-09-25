# RpcDispatch.ts

> **Source:** [src/rpc/RpcDispatch.ts](../../../../../../src/rpc/RpcDispatch.ts)
>
> **Design views:** [Runtime and concurrency](../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)
- [`REQ-RPC-2-SZDTTM` (Request lifecycle)](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)

## UNIT-TEST-RPC-DISPATCH-1-5WY71T

Descriptor-safe endpoint selection and awaited invocation.

- Setup: Actual SDK-owned roots and connected domain services; narrow controls act on those connections.
- Oracle: Only captured callable endpoint descriptors execute. Missing or shadowed endpoints reject without invoking accessors. Void requests wait for completion; sends create neither a response nor a pending request.

- [x] `UNIT-TEST-RPC-DISPATCH-1-5WY71T.P1` — Invokes an own endpoint
- [x] `UNIT-TEST-RPC-DISPATCH-1-5WY71T.P2` — Invokes an inherited endpoint
- [x] `UNIT-TEST-RPC-DISPATCH-1-5WY71T.P3` — Rejects a getter shadow without executing it
- [x] `UNIT-TEST-RPC-DISPATCH-1-5WY71T.P4` — Rejects a non-function shadow
- [x] `UNIT-TEST-RPC-DISPATCH-1-5WY71T.P5` — Rejects a missing service
- [x] `UNIT-TEST-RPC-DISPATCH-1-5WY71T.P6` — Rejects a missing method
- [x] `UNIT-TEST-RPC-DISPATCH-1-5WY71T.P7` — Rejects a constructor
- [x] `UNIT-TEST-RPC-DISPATCH-1-5WY71T.P8` — Rejects an Object base method
- [x] `UNIT-TEST-RPC-DISPATCH-1-5WY71T.P9` — Rejects service helpers
- [x] `UNIT-TEST-RPC-DISPATCH-1-5WY71T.P10` — Invokes the captured callable
- [x] `UNIT-TEST-RPC-DISPATCH-1-5WY71T.P11` — Preserves positional and optional arguments
- [x] `UNIT-TEST-RPC-DISPATCH-1-5WY71T.P12` — Supports empty arguments and undefined results
- [x] `UNIT-TEST-RPC-DISPATCH-1-5WY71T.P13` — Returns sync endpoint errors
- [x] `UNIT-TEST-RPC-DISPATCH-1-5WY71T.P14` — Returns async endpoint errors
- [x] `UNIT-TEST-RPC-DISPATCH-1-5WY71T.P15` — Acknowledges void only after the endpoint completes
- [x] `UNIT-TEST-RPC-DISPATCH-1-5WY71T.P16` — Sends without a response or pending entry
