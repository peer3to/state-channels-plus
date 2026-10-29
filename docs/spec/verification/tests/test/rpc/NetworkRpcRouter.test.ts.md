# NetworkRpcRouter.test.ts

Test file: [test/rpc/NetworkRpcRouter.test.ts](../../../../../../test/rpc/NetworkRpcRouter.test.ts)
Exercises: [NetworkRpcRouter](../../../../implementation/source/src/rpc/router/NetworkRpcRouter.ts.md)

## Overview

Uses actual SDK roots and a real WebRTC provider to check one router per manager and shared normalized ingress. Observers delegate to production ingress; they implement no routing.

The closed-transport case wraps the real SDK host's router in a real `ws` socket pair through a `LocalTransport`, closes that transport (the server socket is then `CLOSING`), and makes the socket emit a serialized `initHandshakeService` request, as `ws` still does for frames it already received. The oracles: `onRpc` ran once, the service's `runRPC` never ran, the manager logger wrote no verbose or error line, and the router has no pending request.

## Tests

- `gives the real SDK manager one router shared by services and loopback`: UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P1
- `converts WebRTC strings Buffer and Uint8Array before router ingress`: UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P2
- `drops network frames on a closed transport before dispatch or logging`: UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P4, REQ-RPC-6-E60S4J.T1.P12
- `ignores internal messages after close at both receive entry points`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P18
- `closes registered unauthenticated transports when its manager is disposed`: UNIT-TEST-PROFILE-DISPOSAL-1-HPXAWA.P1
