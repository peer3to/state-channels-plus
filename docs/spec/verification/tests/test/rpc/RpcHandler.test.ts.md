# RpcHandler.test.ts

Test file: [test/rpc/RpcHandler.test.ts](../../../../../../test/rpc/RpcHandler.test.ts)
Exercises: [RpcHandler.ts](../../../../implementation/source/src/rpc/network/RpcHandler.ts.md)

## Overview

The suite drives `RpcHandler` inside real worker-hosted peers through a test-only RPC probe. The
probe selects live transports and calls the production delivery verbs; it does not replace the
P2P manager, profile manager, loopback transport, or request-correlation path. Three declarations
cover broadcast, loopback, address and transport overloads, a constructor-independent compatible
transport adapter, empty and partially unresolved fan-out, local missing-target rejection, and
options-only timeout forwarding. Oracles are exact receiver-side nonce counts, absence on excluded
peers, returned values, and rejection messages.

## Tests

- `routes broadcast, compatible direct-transport, and loopback sends`: UNIT-TEST-RPC-HANDLER-1-8BP2K8.P1, UNIT-TEST-RPC-HANDLER-1-8BP2K8.P2, UNIT-TEST-RPC-HANDLER-1-8BP2K8.P6
- `routes transport and address lists while skipping empty and unresolved targets`: UNIT-TEST-RPC-HANDLER-1-8BP2K8.P3, UNIT-TEST-RPC-HANDLER-1-8BP2K8.P7, UNIT-TEST-RPC-HANDLER-1-8BP2K8.P8, UNIT-TEST-RPC-HANDLER-1-8BP2K8.P9, UNIT-TEST-RPC-HANDLER-1-8BP2K8.P10
- `routes compatible transport requests and rejects missing targets and loopback timeouts`: UNIT-TEST-RPC-HANDLER-1-8BP2K8.P12, UNIT-TEST-RPC-HANDLER-1-8BP2K8.P13, UNIT-TEST-RPC-HANDLER-1-8BP2K8.P14
