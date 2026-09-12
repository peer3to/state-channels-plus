# RpcRouter.ts — Source Report

> **Source:** [RpcRouter.ts](../../../../../../src/rpc/RpcRouter.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Responsibility and observable boundary

The one router every line runs on: request ids and the pending map, the timeout each request runs
under, matching a reply to its request, and dispatching an inbound frame onto the services of a
root. It is concrete — the peers' `P2PManager` extends it and assigns its peer policy to public
fields; a worker port keeps the defaults. Nothing here knows whether the far end is a stranger on a
socket or this process's own thread.

## Key design decisions

- **One class, one policy surface.** Five assigned fields are where a peer differs from a port:
  `resolveTransport`, `isSameSender`, `onBadFrame`, `onFrameDispatched` and `requestTimeoutMs`, plus
  the optional `wrapInbound` ([policy fields](../../../../../../src/rpc/RpcRouter.ts#L80)). A service
  or a transport is written against `RpcRouter` and never learns which end it serves.
- **Replies are classified before requests.** A frame that is a reply settles a pending entry and
  never reaches a service; a request is dispatched by service and method name
  ([`deliverFrame`](../../../../../../src/rpc/RpcRouter.ts#L342)).
- **A byte frame is parsed once.** `onRpc` decodes reply-or-request in a single pass, so an
  up-to-16MB peer frame is never parsed twice
  ([`onRpc`](../../../../../../src/rpc/RpcRouter.ts#L281)).
- **The frame-size guard brings its own `Buffer`.** It runs on every untrusted line, including a
  browser realm where `Buffer` is not a global, so the module imports it rather than reading one
  off the page ([`onRpc`](../../../../../../src/rpc/RpcRouter.ts#L281)).
- **A reply's error is decoded by the line's trust, not by its shape.** An untrusted reply
  contributes its message and nothing else — never a name, stack, revert `data` or origin-peer
  stamp a peer chose; a trusted line is deserialized whole
  ([`handleRpcResponse`](../../../../../../src/rpc/RpcRouter.ts#L233)).
- **Every inbound delivery goes through one wrapper.** `wrapInbound` runs both the byte path and the
  object path, so a realm with a handler execution context enters it for peer frames and port frames
  alike ([`runInbound`](../../../../../../src/rpc/RpcRouter.ts#L334)).
- **A stranger sending nonsense is disconnected; our own thread is told.** On an untrusted transport
  an unknown service or endpoint is a bad frame. On a trusted one a request is answered `ok: false`
  and a one-way call is logged, so a stale caller learns its mistake and the link stays up
  ([`refuse`](../../../../../../src/rpc/RpcRouter.ts#L392)).
- **`timeoutMs: null` means no timer.** An operation that owns its own bound — a dispose that drains
  sockets, a transaction that waits for a receipt — must not be rejected by a timer it cannot cancel
  ([`sendRpcRequest`](../../../../../../src/rpc/RpcRouter.ts#L174)).
- **Only the transport a request went out on may settle it.** The default is object identity; the
  peer manager assigns peer identity so a transport upgrade still settles.
- **The root is built with the router.** Services need the router and the router needs the root, so
  the constructor takes a factory; a root that cannot exist before its owner's fields do attaches
  later ([`constructor`](../../../../../../src/rpc/RpcRouter.ts#L115)).
- **A worker has no logger until its config arrived.** The router starts on a no-op logger and
  `setLogger` hands the real one to every service on the root
  ([`setLogger`](../../../../../../src/rpc/RpcRouter.ts#L127)).
- **A closed line rejects what it still owed and says so.** An unexpected close logs the pending
  operations with their ages; an expected one settles them as disposed
  ([`onTransportClosed`](../../../../../../src/rpc/RpcRouter.ts#L153)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | A root factory, a logger and a timer; envelopes to send; inbound frames as bytes or objects; the transport each arrived on.                                                  |
| Outputs      | Settled request promises; replies posted on the transport a request arrived on; dispatch onto the root's services; the typed `remoteRpc` endpoint.                           |
| Owned state  | The root and its `remoteRpc` proxy; every transport delivering here; the request counter; the pending map with each entry's transport, timer, operation name and start time. |
| Side effects | Timers through the injected `RpcTimer`; the policy fields' own effects (peer disconnects, logs).                                                                             |

## Linked requirements

| Source file                                            | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RpcRouter.ts](../../../../../../src/rpc/RpcRouter.ts) | [`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0), [`REQ-RPC-2-SZDTTM`](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm), [`REQ-RPC-6-E60S4J`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j), [`INV-RUNTIME-1-AKRHAK`](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-2-KBXKTG`](../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

## Assumptions, dependencies, trust boundaries, and limits

- **`onTransportCreated` is how a router learns of a transport it did not build.** The peer router
  gives every transport a profile as it is constructed; a port router has no profiles and keeps the
  default.
- A transport is trusted or not; the router never decides that itself.
- The pending map grows with unanswered requests; a router whose `requestTimeoutMs` returns `null`
  relies on the transport closing to settle them.
- A frame that arrives as an object is trusted to be an object; only byte frames are size-checked.
- Frames on a port cross by structured clone; a transferable cannot ride in one (the bootstrap
  carries the one port that must).
- The far end of a port is this process's own thread: nothing it sends is guarded or bounded.

## Specification adherence

- The envelope carries service, method, params and an optional correlation id; a reply carries the
  id, `ok`, and a result or an error ({{REQ:[`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)}}).
- A request settles at most once: by reply, by timeout, or by its transport closing
  ({{REQ:[`REQ-RPC-2-SZDTTM`](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)}}).
- Reply frames are recognised and settled before any dispatch; an oversized byte frame is refused
  before parsing ({{REQ:[`REQ-RPC-6-E60S4J`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)}}).
- The same class serves the inline and the worker deployment of every line — peers, the runtime host
  and client, the vm worker and its owner ({{REQ:[`INV-RUNTIME-1-AKRHAK`](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)}}).
- Requests reach a root's services in the order the port delivered them
  ({{REQ:[`REQ-RUNTIME-2-KBXKTG`](../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)}}).
- A link that closes settles every request pending on it, expected or not
  ({{REQ:[`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)}}).

## Conformance traceability

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                                         | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)    | Covered               | **Here:** [`sendRpcRequest`](../../../../../../src/rpc/RpcRouter.ts#L174) stamps the id; [`dispatch`](../../../../../../src/rpc/RpcRouter.ts#L370) resolves by name. **Other files:** [Rpc.ts.md](./Rpc.ts.md) owns the shapes.                                                                                  | None.            |
| [`REQ-RPC-2-SZDTTM`](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)    | Covered               | **Here:** one pending entry per request, deleted on the first of reply, timer and close ([`handleRpcResponse`](../../../../../../src/rpc/RpcRouter.ts#L233), [`rejectPending`](../../../../../../src/rpc/RpcRouter.ts#L255)). **Other files:** [P2PManager.ts.md](../P2PManager.ts.md) settles by peer identity. | None.            |
| [`REQ-RPC-6-E60S4J`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)    | Covered               | **Here:** [`onRpc`](../../../../../../src/rpc/RpcRouter.ts#L281) bounds and parses bytes once, [`deliverFrame`](../../../../../../src/rpc/RpcRouter.ts#L342) classifies reply before request. **Other files:** [ARpcService.ts.md](./ARpcService.ts.md) runs guards.                                             | None.            |
| [`INV-RUNTIME-1-AKRHAK`](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** no branch on where the far end runs. **Other files:** [P2PManager.ts.md](../P2PManager.ts.md), the roots under [../evm/p2pRuntime/rpc/](../evm/p2pRuntime/rpc/P2pRuntimeHostRoot.ts.md) and [../evm/contractExecutor/rpc/](../evm/contractExecutor/rpc/ContractExecutorRoot.ts.md).                    | None.            |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** [`onRpcFrame`](../../../../../../src/rpc/RpcRouter.ts#L329) dispatches in arrival order, through `wrapInbound` when the realm has one. **Other files:** [../evm/p2pRuntime/P2pRuntimeHost.ts.md](../evm/p2pRuntime/P2pRuntimeHost.ts.md) gates the late signer instead of holding frames.              | None.            |
| [`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** [`onTransportClosed`](../../../../../../src/rpc/RpcRouter.ts#L153) rejects and reports; the default `onBadFrame` logs and keeps the line. **Other files:** the owners decide what a closed link means for them.                                                                                        | None.            |

## Component test obligations

| Unit test ID                                                                        | Obligation                                                                                                    | Public entry and setup                                                                                                    | Oracle and forbidden effects                                                                                                           | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-port-rpc-router-1-8j6mzg"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG` | Request/response and one-way delivery over a real port pair, and what happens when a line or a handler fails. | Two routers over a Node `MessageChannel`, each serving a probe root and holding a typed endpoint for the other; no mocks. | The result or restored error the caller gets; the pending map after timeout and close; what the logger recorded; the far root's calls. | <a id="unit-test-port-rpc-router-1-8j6mzg.p1"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P1` — a request resolves with the far handler's return value; <a id="unit-test-port-rpc-router-1-8j6mzg.p2"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P2` — a thrown handler rejects with name, revert data and code restored; <a id="unit-test-port-rpc-router-1-8j6mzg.p3"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P3` — the router's own timeout bound rejects and clears the pending entry; <a id="unit-test-port-rpc-router-1-8j6mzg.p4"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P4` — a null timeout outlives a handler slower than that bound; <a id="unit-test-port-rpc-router-1-8j6mzg.p5"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P5` — closing a transport rejects its pending requests and no other transport's; <a id="unit-test-port-rpc-router-1-8j6mzg.p6"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P6` — an unknown service or method is answered with an error and the line stays up; <a id="unit-test-port-rpc-router-1-8j6mzg.p7"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P7` — a one-way call is delivered and a throwing one-way handler is logged without closing; <a id="unit-test-port-rpc-router-1-8j6mzg.p8"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P8` — the inbound wrapper runs every dispatch; <a id="unit-test-port-rpc-router-1-8j6mzg.p9"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P9` — a bigint and a byte array cross unchanged; <a id="unit-test-port-rpc-router-1-8j6mzg.p12"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P12` — a request on a closed transport is refused at once, never posted or timed; <a id="unit-test-port-rpc-router-1-8j6mzg.p13"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P13` — a logger handed to a router built without one reaches every service on the root and leaves a non-service field untouched; <a id="unit-test-port-rpc-router-1-8j6mzg.p14"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P14` — a reply on an untrusted line contributes only its message: the crafted name, stack, revert data and origin-peer stamp are dropped, while the same reply on a trusted line keeps them; <a id="unit-test-port-rpc-router-1-8j6mzg.p15"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P15` — an inbound peer frame arriving as bytes runs inside `wrapInbound`, exactly once around the dispatch; <a id="unit-test-port-rpc-router-1-8j6mzg.p16"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P16` — an inbound peer frame on an untrusted line dispatches in a realm with no `Buffer` global |

## Related source reports

- [P2PManager.ts.md](../P2PManager.ts.md) — the peers' router, and the only subclass.
- [Rpc.ts.md](./Rpc.ts.md) — the envelope and reply shapes, and the single-pass frame decoder.
- [RpcHandler.ts.md](./RpcHandler.ts.md) — resolves a delivery target against this router.
- [RemoteRpcProxy.ts.md](./RemoteRpcProxy.ts.md) — builds the typed `remoteRpc` endpoint.
- [serializeError.ts.md](./serializeError.ts.md) — what a failed reply carries.
- [../transport/MessagePortTransport.ts.md](../transport/MessagePortTransport.ts.md) — the transport a worker link attaches.
