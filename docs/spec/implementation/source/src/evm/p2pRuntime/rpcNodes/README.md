# src/evm/p2pRuntime/rpcNodes — Subsystem

> **Status:** Authored — engineer verification pending.

## Contents

- [MultiRpcProvider.ts](./MultiRpcProvider.ts.md)
- [RpcNodeProvider.ts](./RpcNodeProvider.ts.md)

## Responsibility

The host's chain access through an ordered list of RPC endpoints
([`REQ-CHAINOBS-1-5JTHY8` (Ordered endpoint set)](../../../../../../specification/runtime/chain-observation.md#req-chainobs-1-5jthy8)). One
`RpcNodeProvider` owns each endpoint's WebSocket, its bounded reconnect and the hand-over of every
open socket to subscribers. `MultiRpcProvider` is the runtime's single chain provider: each request
goes to the first connected node and fails over when that node drops
([`REQ-CHAINOBS-2-2NCSQ3` (One endpoint per request, with failover)](../../../../../../specification/runtime/chain-observation.md#req-chainobs-2-2ncsq3)), and block events
are relayed from the node sockets. Manager-event subscriptions are made per node by the event
listener ([StateChannelEventListener](../../../StateChannelEventListener.ts.md)).

## Design decisions

- No ethers `FallbackProvider`: it waits on a dropped backend's request after starting the next one,
  counts a backend's error as a quorum-1 answer, and broadcasts a transaction to every backend.
- A node never answers with a connection error once it has connected: requests wait for its
  reconnect. `MultiRpcProvider` does not wait on a dropped node; it moves the request to the next one.
- No integration-test family of its own: the two files are exercised together by the
  [`UNIT-TEST-MULTI-RPC-1-SVGGZ5`](MultiRpcProvider.ts.md#unit-test-multi-rpc-1-svggz5) cases over real proxied nodes.

## Source inventory

| Source | Report |
| --- | --- |
| [MultiRpcProvider.ts](../../../../../../../../src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts) | [MultiRpcProvider.ts.md](./MultiRpcProvider.ts.md) |
| [RpcNodeProvider.ts](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts) | [RpcNodeProvider.ts.md](./RpcNodeProvider.ts.md) |
