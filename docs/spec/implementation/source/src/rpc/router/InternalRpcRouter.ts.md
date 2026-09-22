# InternalRpcRouter.ts

> **Source:** [src/rpc/router/InternalRpcRouter.ts](../../../../../../../src/rpc/router/InternalRpcRouter.ts)
>
> **Design views:** [Runtime and concurrency](../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

## UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M

Internal ingress, duplex execution, transfer and invocation context.

- Setup: Actual SDK-owned roots and connected domain services; narrow controls act on those connections.
- Oracle: Malformed recoverable frames reject their own request; garbage and foreign frames cannot settle pending calls. Real transfers detach the sender and preserve bytes; clone failures remain synchronous. Context survives awaited and detached work.

- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P1` — Returns a correlated error for a malformed recoverable request
- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P2` — Ignores uncorrelatable garbage and continues serving
- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P3` — Ignores a foreign namespace frame while a request is pending
- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P4` — Transfers a MessagePort over a local SDK connection
- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P5` — Transfers a MessagePort into an SDK worker
- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P6` — Serves duplex reentrant calls over a local channel
- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P7` — Serves duplex reentrant calls through a real worker
- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P8` — Transfers an ArrayBuffer and detaches its sender
- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P9` — Preserves binary and BigInt values by structured clone
- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P10` — Throws a send clone failure synchronously
- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P11` — Clones a mutable argument at send time
- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P12` — Preserves peer identity on a synchronous inline SDK endpoint failure and during failed and successful response settlement
- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P13` — Preserves peer identity on an awaited inline SDK endpoint failure and during failed and successful response settlement
- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P14` — Preserves peer identity on a synchronous inline executor endpoint failure and during failed and successful response settlement
- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P15` — Preserves peer identity on an awaited inline executor endpoint failure and during failed and successful response settlement
- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P16` — Retains detached inline SDK peer identity after another peer enters
- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P17` — Retains detached inline executor peer identity after another peer enters
- [x] `UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P18` — Closed internal connections ignore late input through both the transport and direct router entries, without sending a response or creating pending work
