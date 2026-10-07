# RpcNodeProvider.ts — Source Report

> **Source:** [src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [runtime/chain-observation.md](../../../../../views/runtime/chain-observation.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

One RPC endpoint behind a stable ethers provider. It opens the endpoint's WebSocket, checks that the
socket still answers, reconnects a dropped, refused or silent socket with a bounded doubling backoff,
and hands every open socket to its watchers. As a provider it forwards requests to the current socket
and sends a request again on the next socket when the socket drops before answering.

## Key design decisions

1. **Bounded backoff:** 250 ms doubling to a 5 s cap per failed attempt, reset by a successful
   connection ([getReconnectDelayMs](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L84)).
2. **Bounded attempts and liveness:** a socket the WebSocket constructor rejects is a failed attempt; a connection attempt fails after 10 s
   ([connect](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L353)); an open socket must answer `eth_blockNumber` every
   10 s within 5 s, or it is ended and reconnected; an error answer still proves the socket alive ([checkHeartbeat](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L448)).
3. **Hold, do not fail, after a drop:** a node that has connected never answers with a connection
   error while it reconnects; a node that never connected, or one that stopped reconnecting, fails at
   once ([awaitConnection](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L326)).
4. **No wait for failover:** [trySendOnCurrentSocket](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L234) answers
   `undefined` when there is no socket or it ends before answering, so the caller moves on. Destroy
   ends the current socket, so a request in flight answers the same way.
5. **Socket hand-over and loss:** [watchSockets](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L213) passes the open socket
   at registration (`reopened` false) and every later socket (`reopened` true);
   [watchConnectionLoss](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L222) reports each lost socket.
6. **One chain:** the nodes of one runtime share an expected chain id set by the first connected
   node; a node serving another chain is refused, logged and retried ([connect](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L353)).
7. **Owner gone:** [stopReconnecting](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L251) stops reconnects, heartbeats and
   logs for a runtime that disposed while the Clock still reads through the provider, and fails the
   requests still waiting for a reconnect.
8. **One owner of socket subscriptions:** [NodeSocketSubscriptions](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L129) subscribes a callback on a node socket, forgets destroyed sockets and unsubscribes the live ones; the block relay and the event listener both use it.
9. **Quiet when down:** the first failed attempt of an outage warns, later ones at most once a minute.
10. **No request cache:** the provider is built with ethers' `cacheTimeout` off. ethers otherwise
    keeps a failed answer for 250 ms and hands it to a repeated request without asking the node, so a
    retried log window would fail again unread.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------- |
| Inputs       | Endpoint URL; requests; watcher registrations.                                                 |
| Outputs      | JSON-RPC results; open sockets for watchers.                                                   |
| Owned state  | Current socket, reconnect timer and attempt count, pinned chain id, waiting requests.          |
| Side effects | Opens and closes WebSockets; logs connection changes with the endpoint's scheme and host only. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                  | Specification IDs                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RpcNodeProvider.ts](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts) | [`REQ-CHAINOBS-2-2NCSQ3`](../../../../../../specification/runtime/chain-observation.md#req-chainobs-2-2ncsq3), [`REQ-CHAINOBS-3-N137ZP`](../../../../../../specification/runtime/chain-observation.md#req-chainobs-3-n137zp) |

Contribution: per-endpoint connection, reconnect and socket hand-over; the request failover across
endpoints and the catch-up live in the related files.

## Assumptions, dependencies, trust boundaries, and limits

- Uses the ethers `WebSocketProvider`, which never reconnects and has no close handler; this file
  installs `onerror` and `onclose` on its socket.
- A connection that dies silently is detected within the heartbeat interval plus its timeout (15 s).

## Specification adherence

- Reconnect is bounded and independent per endpoint; a reopened socket is handed over for renewed
  subscriptions and catch-up.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Gap / divergence |
| ------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-CHAINOBS-3-N137ZP`](../../../../../../specification/runtime/chain-observation.md#req-chainobs-3-n137zp) | Covered               | **Here:** [scheduleReconnect](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L496) and [onSocketEnded](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L481) reconnect with the bounded backoff; [watchSockets](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L213) hands each reopened socket over. **Other files:** [StateChannelEventListener](../../../StateChannelEventListener.ts.md) renews subscriptions and starts the catch-up in [EventSyncService](../../../stateManager/eventSync/EventSyncService.ts.md). | —                |
| [`REQ-CHAINOBS-2-2NCSQ3`](../../../../../../specification/runtime/chain-observation.md#req-chainobs-2-2ncsq3) | Covered               | **Here:** [trySendOnCurrentSocket](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts#L234) reports a missing or dropped socket instead of waiting. **Other files:** [MultiRpcProvider](MultiRpcProvider.ts.md) chooses the endpoint and fails over.                                                                                                                                                                                                                                                                                                                        | —                |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                          | Obligation                           | Public entry and setup                                                                 | Oracle and forbidden effects                                                                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-rpc-node-1-vtxh1m"></a>`UNIT-TEST-RPC-NODE-1-VTXH1M` | Connection lifecycle of one endpoint | A real private node behind a cuttable WebSocket proxy; cut, restore, stop and destroy. | Requests answer correctly after a reconnect; watchers see each reopened socket; no reconnect after stopReconnecting; no request hangs after destroy. | <a id="unit-test-rpc-node-1-vtxh1m.p1"></a>`UNIT-TEST-RPC-NODE-1-VTXH1M.P1` — backoff values and cap; <a id="unit-test-rpc-node-1-vtxh1m.p2"></a>`UNIT-TEST-RPC-NODE-1-VTXH1M.P2` — request held while cut answers after restore; <a id="unit-test-rpc-node-1-vtxh1m.p3"></a>`UNIT-TEST-RPC-NODE-1-VTXH1M.P3` — reopened socket handed to watchers; <a id="unit-test-rpc-node-1-vtxh1m.p4"></a>`UNIT-TEST-RPC-NODE-1-VTXH1M.P4` — never-connected node fails at once; <a id="unit-test-rpc-node-1-vtxh1m.p5"></a>`UNIT-TEST-RPC-NODE-1-VTXH1M.P5` — refused first connection keeps retrying; <a id="unit-test-rpc-node-1-vtxh1m.p6"></a>`UNIT-TEST-RPC-NODE-1-VTXH1M.P6` — no reconnect after stopReconnecting; <a id="unit-test-rpc-node-1-vtxh1m.p7"></a>`UNIT-TEST-RPC-NODE-1-VTXH1M.P7` — destroy fails a held request; <a id="unit-test-rpc-node-1-vtxh1m.p8"></a>`UNIT-TEST-RPC-NODE-1-VTXH1M.P8` — node on another chain refused; <a id="unit-test-rpc-node-1-vtxh1m.p9"></a>`UNIT-TEST-RPC-NODE-1-VTXH1M.P9` — destroyed during a pending attempt: no log, no unhandled rejection; <a id="unit-test-rpc-node-1-vtxh1m.p10"></a>`UNIT-TEST-RPC-NODE-1-VTXH1M.P10` — heartbeat answered with an error keeps the socket. |

## Related source reports

- [MultiRpcProvider](MultiRpcProvider.ts.md), [RuntimeChainContext](../RuntimeChainContext.ts.md), [LoggerUtils](../../../utils/LoggerUtils.ts.md).
