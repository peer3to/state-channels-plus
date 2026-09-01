# ARpcRouter.ts — Source Report

> **Source:** [ARpcRouter.ts](../../../../../../src/rpc/ARpcRouter.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Responsibility and observable boundary

The request/response core every line shares: request ids and the pending map, the timeout each
request runs under, matching a reply to its request, and dispatching an inbound frame onto the
services of a root. It is abstract: the peer manager and the port router each supply timers, how a
target address resolves, and what happens when a line or a handler fails. Nothing here knows whether
the far end is a stranger on a socket or this process's own thread.

## Key design decisions

- **One core, two routers.** `P2PManager` extends it for peers (many untrusted transports, guards,
  byte frames) and `PortRpcRouter` for worker ports (one trusted transport per link, object frames).
  A service or a transport is written against the interface `RpcRouterLike` and never learns which
  ([`RpcRouterLike`](../../../../../../src/rpc/ARpcRouter.ts#L28)).
- **Replies are classified before requests.** A frame that is a reply settles a pending entry and
  never reaches a service; a request is dispatched by service and method name
  ([`onRpcFrame`](../../../../../../src/rpc/ARpcRouter.ts#L273)).
- **A stranger sending nonsense is disconnected; our own thread is told.** On an untrusted transport
  an unknown service or endpoint is a service failure. On a trusted one a request is answered
  `ok: false` and a one-way call is logged, so a stale caller learns its mistake and the link stays up
  ([`refuse`](../../../../../../src/rpc/ARpcRouter.ts#L319)).
- **`timeoutMs: null` means no timer.** An operation that owns its own bound — a dispose that drains
  sockets, a transaction that waits for a receipt — must not be rejected by a timer it cannot cancel
  ([`sendRpcRequest`](../../../../../../src/rpc/ARpcRouter.ts#L129)).
- **Only the transport a request went out on may settle it.** The default is object identity; the
  peer manager overrides it with peer identity so a transport upgrade still settles.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Envelopes to send; inbound frames as bytes or objects; the transport each arrived on.                                                       |
| Outputs      | Settled request promises; replies posted on the transport a request arrived on; dispatch onto the root's services.                          |
| Owned state  | The root and its `remoteRpc` proxy; the request counter; the pending map with each entry's transport, timer, operation name and start time. |
| Side effects | Timers through the subclass hooks; `onServiceFailure` / `onTransportClosed` on the subclass.                                                |

## Linked requirements

| Source file                                              | Specification IDs                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ARpcRouter.ts](../../../../../../src/rpc/ARpcRouter.ts) | [`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0), [`REQ-RPC-2-SZDTTM`](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm), [`REQ-RPC-6-E60S4J`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j), [`INV-RUNTIME-1-AKRHAK`](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) |

## Assumptions, dependencies, trust boundaries, and limits

- A transport is trusted or not; the router never decides that itself.
- The pending map grows with unanswered requests; a subclass without a default timeout relies on the
  transport closing to settle them.
- A frame that arrives as an object is trusted to be an object; only byte frames are size-checked.

## Specification adherence

- The envelope carries service, method, params and an optional correlation id; a reply carries the
  id, `ok`, and a result or an error ({{REQ:[`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)}}).
- A request settles at most once: by reply, by timeout, or by its transport closing
  ({{REQ:[`REQ-RPC-2-SZDTTM`](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)}}).
- Reply frames are recognised and settled before any dispatch; an oversized byte frame is refused
  before parsing ({{REQ:[`REQ-RPC-6-E60S4J`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)}}).
- The same core serves the inline and the worker deployment of every line ({{REQ:[`INV-RUNTIME-1-AKRHAK`](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)}}).

## Conformance traceability

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                    | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)    | Covered               | **Here:** `sendRpcRequest` stamps the id; `dispatch` resolves by name. **Other files:** [Rpc.ts.md](./Rpc.ts.md) owns the shapes.                                           | None.            |
| [`REQ-RPC-2-SZDTTM`](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)    | Covered               | **Here:** one pending entry per request, deleted on the first of reply, timer and close. **Other files:** [P2PManager.ts.md](../P2PManager.ts.md) settles by peer identity. | None.            |
| [`REQ-RPC-6-E60S4J`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)    | Covered               | **Here:** `onRpc` bounds and parses bytes, `onRpcFrame` classifies reply before request. **Other files:** [ARpcService.ts.md](./ARpcService.ts.md) runs guards.             | None.            |
| [`INV-RUNTIME-1-AKRHAK`](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** no branch on where the far end runs. **Other files:** [PortRpcRouter.ts.md](./PortRpcRouter.ts.md), [P2PManager.ts.md](../P2PManager.ts.md).                      | None.            |

## Related source reports

- [P2PManager.ts.md](../P2PManager.ts.md) — the peers' router.
- [PortRpcRouter.ts.md](./PortRpcRouter.ts.md) — the worker links' router.
- [Rpc.ts.md](./Rpc.ts.md) — the envelope and reply shapes.
- [serializeError.ts.md](./serializeError.ts.md) — what a failed reply carries.
