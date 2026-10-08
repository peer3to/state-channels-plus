# RemoteRpcProxy.ts

> **Source:** [src/rpc/network/RemoteRpcProxy.ts](../../../../../../../src/rpc/network/RemoteRpcProxy.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`REQ-RPC-1-FF89Z0` (Typed wire contract)](../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)

## UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729

Service-only string access and JavaScript interoperability

- Setup: Access structurally compatible, incomplete, ordinary, missing, symbol, and `then` properties through `createProxy`; access two named services repeatedly
- Oracle: Compatible services yield name-scoped cached proxies; invalid string properties throw; symbols pass through; Promise assimilation returns the proxy without invoking RPC

- [x] `UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P1` — structurally compatible service access + repeated-access cache identity
- [x] `UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P2` — incomplete service rejects
- [x] `UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P3` — symbol passthrough
- [x] `UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P4` — ordinary and missing string properties reject
- [x] `UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P5` — `then` is reserved and Promise assimilation preserves proxy identity
- [x] `UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P6` — separate service names have separate caches
