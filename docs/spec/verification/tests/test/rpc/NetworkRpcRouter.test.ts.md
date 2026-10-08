# NetworkRpcRouter.test.ts

Test file: [test/rpc/NetworkRpcRouter.test.ts](../../../../../../test/rpc/NetworkRpcRouter.test.ts)
Exercises: [NetworkRpcRouter](../../../../implementation/source/src/rpc/router/NetworkRpcRouter.ts.md)

## Overview

Uses actual SDK roots and a real WebRTC provider to check one router per manager, shared normalized ingress and the preserved network/internal difference for late input. Observers delegate to production ingress; they implement no routing.

## Tests

- `gives the real SDK manager one router shared by services and loopback`: UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P1
- `converts WebRTC strings Buffer and Uint8Array before router ingress`: UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P2
- `keeps network receive-after-close admission unchanged`: UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P3
- `ignores internal messages after close at both receive entry points`: UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P18
- `closes registered unauthenticated transports when its manager is disposed`: UNIT-TEST-PROFILE-DISPOSAL-1-HPXAWA.P1
