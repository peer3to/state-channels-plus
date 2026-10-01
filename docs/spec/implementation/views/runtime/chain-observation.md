# Chain Access Through Several RPC Endpoints — Implementation

> **Specification subject:** [specification/runtime/chain-observation.md](../../../specification/runtime/chain-observation.md)

> **Agent authoring status:** Current implementation design assembled from the source.
> **Engineer verification:** Pending.

## Contents

- [Implementation overview](#implementation-overview)
- [System design](#system-design)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Integration test plan](#integration-test-plan)
- [Source reports](#source-reports)

## Implementation overview

The runtime reaches the chain through the ordered endpoint list `PROVIDER_URLS`, or the single
`PROVIDER_URL` when that list is empty. Four parts split the work:

- **Node** — one [RpcNodeProvider](../../source/src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts.md) per
  endpoint owns its WebSocket: a bounded connection attempt, a heartbeat that ends a socket which stops
  answering, a bounded doubling reconnect, the chain id every node must share, and the hand-over of each
  open socket to subscribers.
- **Provider** — [MultiRpcProvider](../../source/src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts.md) is the
  runtime's one chain provider. Every request goes to the first connected node and moves on when that
  node drops; it warns once while every node is down and relays block events from the node sockets.
- **Listener** — [StateChannelEventListener](../../source/src/StateChannelEventListener.ts.md) subscribes
  the channel's manager events on every node socket. A socket opened after the subscription holds its
  live logs until its catch-up has scheduled what it read, and a failed catch-up is retried.
- **Sync** — [EventSyncService](../../source/src/stateManager/eventSync/EventSyncService.ts.md) pages the
  catch-up from the completed-block watermark to the node's head, deduplicates logs by block-scoped
  identity, ignores removed logs and drops streamed logs below the watermark.

[RuntimeChainContext](../../source/src/evm/p2pRuntime/RuntimeChainContext.ts.md) resolves the list,
derives the wallet, opens the nodes and returns once one node connected.

## System design

1. **Startup.** URLs are validated before any node opens; the first connected node fixes the chain id
   and startup returns; the other nodes connect in the background.
2. **Requests.** The provider asks each node in list order to send on its current socket. A node with no
   socket, or whose socket ends before answering, is skipped; a node's error answer is returned as is.
   While no node is connected, requests wait; destroy rejects waiting and in-flight requests, and stopping
   reconnects rejects waiting requests.
3. **Liveness.** Each open socket answers `eth_blockNumber` every 10 s within 5 s; an error answer still
   proves liveness, a timeout or a socket failure ends the socket. Connection attempts are bounded to 10 s.
4. **Observation.** Every node socket carries the channel subscription. A reopened socket is subscribed
   first, its logs are held, its catch-up reads windows of at most 1000 blocks in ascending order and
   schedules each before the next, then the held logs are released.
5. **Ownership.** The host disposes the provider, or, when the process-wide Clock still reads through
   it, stops its reconnects and releases it to the Clock, which destroys it once replaced.

## Assumptions and constraints

- Every listed endpoint serves one chain and is trusted; events are not checked across endpoints.
- A catch-up read is limited by the endpoint's own log-query caps only above 1000 blocks per window.

## Integration test plan

The listener, provider, node and sync interaction crosses `src/StateChannelEventListener.ts`,
`src/evm/p2pRuntime/rpcNodes/` and `src/stateManager/eventSync/`. Its system cases are planned in the
specification subject's test matrix and exercised end to end against a WebSocket proxy in front of the
test node: a cut and restored only endpoint, a newer event during the catch-up read, a failed catch-up
read, two endpoints with one cut, a backup that connects after startup, the restored primary catching
up over events the backup delivered, clear and select of the channel listener, the retry's exits, a
subscription made before the channel opened, and a catch-up node whose head is behind or at the
watermark. Exact evidence is mapped in the verification reports.

## Source reports

- [RuntimeChainContext.ts](../../source/src/evm/p2pRuntime/RuntimeChainContext.ts.md)
- [RpcNodeProvider.ts](../../source/src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts.md)
- [MultiRpcProvider.ts](../../source/src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts.md)
- [StateChannelEventListener.ts](../../source/src/StateChannelEventListener.ts.md)
- [EventSyncService.ts](../../source/src/stateManager/eventSync/EventSyncService.ts.md)
