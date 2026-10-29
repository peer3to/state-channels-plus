# NetworkRpcRouter.ts

> **Source:** [src/rpc/router/NetworkRpcRouter.ts](../../../../../../../src/rpc/router/NetworkRpcRouter.ts)

## Requirements

- [`REQ-RPC-2-SZDTTM` (Request lifecycle)](../../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)
- [`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)
- [`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)

## UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT

Network router ownership and shared receive forwarding.

- Setup: Actual SDK services, loopback, real provider WebRTC channel, and a real `ws` socket pair whose SDK-side transport is closed while the socket still emits a received frame.
- Oracle: One router and unchanged results, normalized frames and pending counts; `onRpc` drops a frame on a closed transport before the size bound, dispatch or logging. Existing peer-boundary families retain byte-limit, timeout, foreign-response and retirement obligations.

- [x] `UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P1` — A real SDK manager owns exactly one router shared by network services and loopback, and a self request leaves no pending entry
- [x] `UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P2` — Real WebRTC string, Buffer and Uint8Array frames normalize to the same UTF-8 text; unknown responses leave unrelated pending work unchanged
- [x] `UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P4` — A request frame emitted by a closing socket after its transport closed reaches `onRpc` once and is dropped: no service dispatch, no verbose or error log line, no pending request
