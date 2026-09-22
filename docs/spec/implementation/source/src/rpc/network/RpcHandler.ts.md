# RpcHandler.ts

> **Source:** [src/rpc/network/RpcHandler.ts](../../../../../../../src/rpc/network/RpcHandler.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`REQ-RPC-1-FF89Z0` (Typed wire contract)](../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)
- [`REQ-RPC-2-SZDTTM` (Request lifecycle)](../../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-RPC-HANDLER-1-8BP2K8

Delivery routing and typed face

- Setup: Exercise every delivery verb through real peer runtimes using loopback, address, native transport, and constructor-independent compatible transport targets; include missing targets
- Oracle: Intended peers receive each envelope exactly once; loopback reaches self; unresolved fire-and-forget targets have no effect; unresolvable requests and remote errors reject; request options control timeout

- [x] `UNIT-TEST-RPC-HANDLER-1-8BP2K8.P1` — broadcast reaches each open peer once and not self
- [x] `UNIT-TEST-RPC-HANDLER-1-8BP2K8.P2` — `sendOne` accepts a constructor-independent compatible direct transport
- [x] `UNIT-TEST-RPC-HANDLER-1-8BP2K8.P3` — `sendMultiple` native transports overload
- [x] `UNIT-TEST-RPC-HANDLER-1-8BP2K8.P4` — loopback request registers and resolves
- [x] `UNIT-TEST-RPC-HANDLER-1-8BP2K8.P5` — `sendOne` by address reaches the addressed peer
- [x] `UNIT-TEST-RPC-HANDLER-1-8BP2K8.P6` — targetless `sendOne` reaches loopback self
- [x] `UNIT-TEST-RPC-HANDLER-1-8BP2K8.P7` — `sendMultiple` addresses overload reaches each addressed peer once
- [x] `UNIT-TEST-RPC-HANDLER-1-8BP2K8.P8` — empty `sendMultiple` has no effect
- [x] `UNIT-TEST-RPC-HANDLER-1-8BP2K8.P9` — unresolved `sendOne` address has no effect
- [x] `UNIT-TEST-RPC-HANDLER-1-8BP2K8.P10` — address-list delivery skips an unresolved entry and continues to later valid entries
- [x] `UNIT-TEST-RPC-HANDLER-1-8BP2K8.P11` — addressed request with options resolves
- [x] `UNIT-TEST-RPC-HANDLER-1-8BP2K8.P12` — request accepts a constructor-independent compatible direct transport
- [x] `UNIT-TEST-RPC-HANDLER-1-8BP2K8.P13` — request to an unresolved address rejects locally with no send
- [x] `UNIT-TEST-RPC-HANDLER-1-8BP2K8.P14` — options-only loopback request forwards its timeout
- [x] `UNIT-TEST-RPC-HANDLER-1-8BP2K8.P15` — remote request error propagates
- [x] `UNIT-TEST-RPC-HANDLER-1-8BP2K8.P16` — compile-time face exposes only fire-and-forget verbs for `void` methods and only `request` for value methods
