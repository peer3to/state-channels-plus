# Chain Access Through Several RPC Endpoints — Implementation

> **Specification subject:** [specification/runtime/chain-observation.md](../../../specification/runtime/chain-observation.md)

> **Agent authoring status:** Current implementation design assembled from the source.
> **Engineer verification:** Pending.

## Contents

- [Implementation overview](#implementation-overview)
- [Assumptions and constraints](#assumptions-and-constraints)
- [System design](#system-design)
- [System integration test plan](#system-integration-test-plan)
- [Source inventory](#source-inventory)
- [Conformance traceability](#conformance-traceability)

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
  live logs until its catch-up has scheduled what it read. A failed catch-up is retried through the
  first connected node, and a catch-up whose socket ends is abandoned at once.
- **Sync** — [EventSyncService](../../source/src/stateManager/eventSync/EventSyncService.ts.md) pages the
  catch-up from the completed-block watermark to the node's head, deduplicates logs by block-scoped
  identity, ignores removed logs and drops streamed logs below the watermark.

[RuntimeChainContext](../../source/src/evm/p2pRuntime/RuntimeChainContext.ts.md) resolves the list,
derives the wallet, opens the nodes and returns once one node connected.

## Assumptions and constraints

- Every listed endpoint serves one chain and is trusted; events are not checked across endpoints.
- `LOG_QUERY_MAX_BLOCKS` (default 1000) must be at or below every endpoint's own `eth_getLogs` range
  limit. A reopened endpoint whose windows fail hands the rest of its catch-up to the first connected
  endpoint; when that endpoint fails the windows too, the catch-up keeps retrying through it and the
  watermark stays held until the read succeeds or the reopened socket ends. The same holds while the
  first connected endpoint's head is behind the reopened endpoint's head.

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
   first, its logs are held, the watermark is held at the catch-up's first block, its catch-up reads windows of at most
   `LOG_QUERY_MAX_BLOCKS` blocks in ascending order and
   schedules each before the next, then the held logs are released and the watermark hold ends. The
   first read goes through the reopened node; after a failed read the remaining windows are read
   through the provider, i.e. the first connected node, retried with the reconnect backoff. Those
   reads must reach the reopened node's head, asked on its socket before the switch: a head request
   answered with an error is retried on that socket with the reconnect backoff, and nothing is read
   until it answers; a first connected node behind that head reads nothing until it catches up. The socket ending abandons the
   catch-up: the held logs are released and the hold ends at once, and the node's next socket starts
   a new catch-up. A cleared or replaced subscription, or disposal, aborts it at once too: the held
   logs of the removed subscription are dropped and the hold ends without waiting for a read or a
   retry's backoff.
5. **Ownership.** The host disposes the provider, or, when the process-wide Clock still reads through
   it, stops its reconnects and releases it to the Clock, which destroys it once replaced.

## System integration test plan

The listener, provider, node and sync interaction crosses `src/StateChannelEventListener.ts`,
`src/evm/p2pRuntime/rpcNodes/` and `src/stateManager/eventSync/`. Its system cases are planned in the
specification subject's test matrix and exercised end to end against a WebSocket proxy in front of the
test node: a cut and restored only endpoint, a newer event during the catch-up read, a failed catch-up
read, two endpoints with one cut, a backup that connects after startup, the restored primary catching
up over events the backup delivered, clear and select of the channel listener, the retry's exits
(socket drop, cleared listener, disposal) with the watermark advancing afterwards, a subscription made
before the channel opened, a catch-up node whose head is behind or at the watermark, a real recovery
query that completes later blocks during a catch-up read, windows of `LOG_QUERY_MAX_BLOCKS` against
an endpoint with a smaller range limit, a backup that drops for good during its catch-up read, two
nodes catching up at once, and a connected backup whose failed window hands the rest of its
catch-up to the first node. Exact evidence is mapped in the verification reports.

## Source inventory

| Source                                                                             | Report                                                                                    | Role                                                                                                                                             |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [RuntimeChainContext.ts](../../../../src/evm/p2pRuntime/RuntimeChainContext.ts)    | [RuntimeChainContext.ts.md](../../source/src/evm/p2pRuntime/RuntimeChainContext.ts.md)    | Endpoint list, window size and wallet validation; startup on the first connected node.                                                           |
| [RpcNodeProvider.ts](../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts)   | [RpcNodeProvider.ts.md](../../source/src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts.md)   | One endpoint's socket, liveness, reconnect, chain id and socket hand-over.                                                                       |
| [MultiRpcProvider.ts](../../../../src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts) | [MultiRpcProvider.ts.md](../../source/src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts.md) | Request routing and failover, outage warning, block relay.                                                                                       |
| [StateChannelEventListener.ts](../../../../src/StateChannelEventListener.ts)       | [StateChannelEventListener.ts.md](../../source/src/StateChannelEventListener.ts.md)       | Per-node subscriptions, held reopened streams, catch-up retries through the first connected node, abandon on socket loss and the watermark hold. |
| [EventSyncService.ts](../../../../src/stateManager/eventSync/EventSyncService.ts)  | [EventSyncService.ts.md](../../source/src/stateManager/eventSync/EventSyncService.ts.md)  | Paged log reads, catch-up, block-scoped dedup, removed and below-watermark drops, watermark hold.                                                |

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. The rows roll up the file reports;
each row's evidence is auditable from its links.

| Requirement / invariant                                                                              | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                               | Gap / divergence |
| ---------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-CHAINOBS-1-5JTHY8`](../../../specification/runtime/chain-observation.md#req-chainobs-1-5jthy8) | Covered               | **Here:** startup and validation in [RuntimeChainContext](../../source/src/evm/p2pRuntime/RuntimeChainContext.ts.md). **Other files:** the shared chain id and bounded attempts in [RpcNodeProvider](../../source/src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts.md).                                                                                                                  | —                |
| [`REQ-CHAINOBS-2-2NCSQ3`](../../../specification/runtime/chain-observation.md#req-chainobs-2-2ncsq3) | Covered               | **Here:** routing, failover, outage warning and release in [MultiRpcProvider](../../source/src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts.md). **Other files:** dropped-socket answers in [RpcNodeProvider](../../source/src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts.md).                                                                                                          | —                |
| [`REQ-CHAINOBS-3-N137ZP`](../../../specification/runtime/chain-observation.md#req-chainobs-3-n137zp) | Covered               | **Here:** reconnect and liveness in [RpcNodeProvider](../../source/src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts.md); subscriptions, hold and retries in [StateChannelEventListener](../../source/src/StateChannelEventListener.ts.md). **Other files:** paged catch-up and the watermark hold in [EventSyncService](../../source/src/stateManager/eventSync/EventSyncService.ts.md). | —                |
| [`INV-CHAINOBS-1-ASVKC1`](../../../specification/runtime/chain-observation.md#inv-chainobs-1-asvkc1) | Covered               | **Here:** block-scoped dedup, removed and below-watermark drops in [EventSyncService](../../source/src/stateManager/eventSync/EventSyncService.ts.md). **Other files:** every stream fed through it by [StateChannelEventListener](../../source/src/StateChannelEventListener.ts.md).                                                                                                  | —                |
