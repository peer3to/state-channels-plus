# InternalRpcRouter.test.ts

Test file: [test/rpc/InternalRpcRouter.test.ts](../../../../../../test/rpc/InternalRpcRouter.test.ts)

Root observation is scoped to SDK construction and restored afterward. The worker entry records its own SDK root so the network control service can find the real executor connection.

## Overview

The suite exercises actual SDK-owned components and connections. Each declaration checks its named outcome through the production implementation; shared setup and fault controls live in fixtures.

## Tests

- `shares one service instance across two actual SDK caller connections`: UNIT-TEST-RUNTIME-SERVICE-1-WH4SSY.P1
- `retains each invocation sender across interleaved awaits and callbacks`: UNIT-TEST-RUNTIME-DOMAIN-SERVICE-1-CKHC76.P1
- `controls the actual executor connection through the host harness service`: INTEGRATION-TEST-RUNTIME-RPC-1-3J92X6.P1
- `controls an SDK worker's executor connection through the same harness service`: INTEGRATION-TEST-RUNTIME-RPC-1-3J92X6.P2
- `returns a correlated error for a malformed recoverable request`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P1
- `ignores uncorrelatable garbage and continues serving`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P2
- `ignores a foreign namespace frame while a request is pending`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P3
- `transfers a MessagePort over a local SDK connection`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P4
- `transfers a MessagePort into an SDK worker`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P5
- `serves duplex reentrant calls over a local channel`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P6
- `serves duplex reentrant calls through a real worker`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P7
- `transfers an ArrayBuffer and detaches its sender`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P8
- `preserves binary and BigInt values by structured clone`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P9
- `throws a send clone failure synchronously`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P10
- `clones a mutable argument at send time`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P11
- `preserves peer identity on a synchronous inline SDK endpoint failure`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P12
- `preserves peer identity on an awaited inline SDK endpoint failure`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P13
- `preserves peer identity on a synchronous inline executor endpoint failure`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P14
- `preserves peer identity on an awaited inline executor endpoint failure`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P15
- `retains detached inline SDK peer identity after another peer enters`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P16
- `retains detached inline executor peer identity after another peer enters`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P17

- `composes lifecycle on every SDK root and preserves inactive disposal`: UNIT-TEST-RUNTIME-SERVICE-1-WH4SSY.P4

The four inline identity cases also observe the real client router’s settlement events. They assert that both the failed endpoint response and a later successful response settle under the expected peer identity. This checks the outer inbound context separately from the endpoint error stamp; the existing detached cases interleave two peers.
