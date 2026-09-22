# RpcHandleProxy.ts

> **Source:** [src/rpc/network/RpcHandleProxy.ts](../../../../../../../src/rpc/network/RpcHandleProxy.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`REQ-RPC-1-FF89Z0` (Typed wire contract)](../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)

## UNIT-TEST-RPC-HANDLE-PROXY-1-SM6M47

Envelope fabrication

- Setup: Access methods incl. symbols and `then`
- Oracle: Envelopes carry exact service/method/params; symbol/`then` access fabricates nothing

- [ ] `UNIT-TEST-RPC-HANDLE-PROXY-1-SM6M47.P1` — method access → envelope
- [ ] `UNIT-TEST-RPC-HANDLE-PROXY-1-SM6M47.P2` — symbol access exempt
- [ ] `UNIT-TEST-RPC-HANDLE-PROXY-1-SM6M47.P3` — params passed verbatim
- [ ] `UNIT-TEST-RPC-HANDLE-PROXY-1-SM6M47.P4` — `then` access exempt
