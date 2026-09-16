# test/rpc/NetworkRpcRouter.test.ts — Test Report

> **Test file:** [test/rpc/NetworkRpcRouter.test.ts](../../../../../../test/rpc/NetworkRpcRouter.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [NetworkRpcRouter](../../../../implementation/source/src/rpc/router/NetworkRpcRouter.ts.md)

## Overview

Uses actual SDK roots and a real WebRTC provider to check one router per manager, shared normalized ingress and the preserved network/internal difference for late input. Observers delegate to production ingress; they implement no routing.

## Tests and covered test IDs

| Test                                                                                                                                                            | Covers                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`NetworkRpcRouter > gives the real SDK manager one router shared by services and loopback`](../../../../../../test/rpc/NetworkRpcRouter.test.ts#L12) (line 12) | [`UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P1`](../../../../implementation/source/src/rpc/router/NetworkRpcRouter.ts.md#unit-test-network-rpc-router-1-xkt6dt.p1)    |
| [`NetworkRpcRouter > converts WebRTC strings Buffer and Uint8Array before router ingress`](../../../../../../test/rpc/NetworkRpcRouter.test.ts#L15) (line 15)   | [`UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P2`](../../../../implementation/source/src/rpc/router/NetworkRpcRouter.ts.md#unit-test-network-rpc-router-1-xkt6dt.p2)    |
| [`NetworkRpcRouter > keeps network receive-after-close admission unchanged`](../../../../../../test/rpc/NetworkRpcRouter.test.ts#L18) (line 18)                 | [`UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P3`](../../../../implementation/source/src/rpc/router/NetworkRpcRouter.ts.md#unit-test-network-rpc-router-1-xkt6dt.p3)    |
| [`NetworkRpcRouter > ignores internal messages after close at both receive entry points`](../../../../../../test/rpc/NetworkRpcRouter.test.ts#L21) (line 21)    | [`UNIT-TEST-RUNTIME-RPC-ROUTER-1-C1MH7M.P18`](../../../../implementation/source/src/rpc/router/InternalRpcRouter.ts.md#unit-test-runtime-rpc-router-1-c1mh7m.p18) |
| [closes registered unauthenticated transports when its manager is disposed](../../../../../../test/rpc/NetworkRpcRouter.test.ts#L9)                             | [`UNIT-TEST-PROFILE-DISPOSAL-1-HPXAWA.P1`](../../../../implementation/source/src/ProfileManager.ts.md#unit-test-profile-disposal-1-hpxawa.p1)                     |
