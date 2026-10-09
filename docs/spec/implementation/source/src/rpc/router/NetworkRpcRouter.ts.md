# NetworkRpcRouter.ts

> **Source:** [src/rpc/router/NetworkRpcRouter.ts](../../../../../../../src/rpc/router/NetworkRpcRouter.ts)
>
> **Design views:** [RPC architecture](../../../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`REQ-RPC-2-SZDTTM` (Request lifecycle)](../../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)
- [`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)
- [`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)

## UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT

Network router ownership and shared receive forwarding.

- Setup: Actual SDK services, loopback and real provider WebRTC channel.
- Oracle: One router and unchanged results, normalized frames, pending counts and receive-after-close behavior. Existing peer-boundary families retain byte-limit, timeout, foreign-response and retirement obligations.

- [x] `UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P1` — A real SDK manager owns exactly one router shared by network services and loopback, and a self request leaves no pending entry
- [x] `UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P2` — Real WebRTC string, Buffer and Uint8Array frames normalize to the same UTF-8 text; unknown responses leave unrelated pending work unchanged
- [x] `UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P3` — A closed real network transport still forwards late response frames, preserving network admission and leaving unrelated pending work unchanged
