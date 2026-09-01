# PortRpcRouter.ts — Source Report

> **Source:** [PortRpcRouter.ts](../../../../../../src/rpc/PortRpcRouter.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Responsibility and observable boundary

The router for worker links: one per link owner, a `MessagePortTransport` per port it attaches, the
root's services on this end and a typed endpoint for the far one. Every port is this process's own
thread, so nothing is guarded, a failed handler is logged rather than disconnected, and an unknown
method is answered. It can hold inbound requests while its root is still being built and dispatch
them once released, in arrival order.

## Key design decisions

- **The root is built with the router.** Services need the router and the router needs the root, so
  the constructor takes a factory ([`constructor`](../../../../../../src/rpc/PortRpcRouter.ts#L39)).
- **A worker has no logger until its config arrived.** The router starts on a no-op logger and
  `setLogger` hands the real one to every service on the root
  ([`setLogger`](../../../../../../src/rpc/PortRpcRouter.ts#L55)).
- **Inbound requests can be held.** A port queues what is posted before anyone listens; once a
  transport listens, `holdInbound` keeps that promise until the services can answer
  ([`holdInbound`](../../../../../../src/rpc/PortRpcRouter.ts#L73)). Replies still settle.
- **A closed link rejects what it still owed and says so.** An unexpected close logs the pending
  operations with their ages; an expected one settles them as disposed
  ([`onTransportClosed`](../../../../../../src/rpc/PortRpcRouter.ts#L125)).
- **No loopback and no addresses.** An omitted target goes to the bound far end of an endpoint; a
  port has no peer address to resolve.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | A root factory, an optional logger, options: default timeout, an inbound wrapper, a slow-request threshold, a close callback; ports to attach. |
| Outputs      | Transports; typed endpoints; the base router's replies and settled requests.                                                                   |
| Owned state  | The attached transports; the held requests while holding; the current logger.                                                                  |
| Side effects | `setTimeout` timers; logs on slow requests, failed handlers and unexpected closes; the owner's close callback.                                 |

## Linked requirements

| Source file                                                    | Specification IDs                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PortRpcRouter.ts](../../../../../../src/rpc/PortRpcRouter.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-2-KBXKTG`](../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RPC-2-SZDTTM`](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm) |

## Assumptions, dependencies, trust boundaries, and limits

- The far end of a port is this process's own thread: nothing it sends is guarded or bounded.
- Frames cross by structured clone; a transferable cannot ride in one (the bootstrap carries the one
  port that must).
- The inbound wrapper runs every dispatch, replies included.

## Specification adherence

- One router shape serves the runtime host, the runtime client, the vm worker and its owner
  ({{REQ:[`INV-RUNTIME-1-AKRHAK`](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)}}).
- Requests reach a root's services in arrival order, held or not ({{REQ:[`REQ-RUNTIME-2-KBXKTG`](../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)}}).
- A link that closes settles every request pending on it, expected or not ({{REQ:[`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)}}, {{REQ:[`REQ-RPC-2-SZDTTM`](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)}}).

## Conformance traceability

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                          | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** the same class on both ends of every worker link. **Other files:** the roots under [../evm/p2pRuntime/rpc/](../evm/p2pRuntime/rpc/P2pRuntimeHostRoot.ts.md) and [../evm/contractExecutor/rpc/](../evm/contractExecutor/rpc/ContractExecutorRoot.ts.md). | None.            |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** held requests replay in order; the wrapper serialises dispatch inside the handler context.                                                                                                                                                              | None.            |
| [`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** `onTransportClosed` rejects and reports; `onServiceFailure` logs and keeps the line. **Other files:** the owners decide what a closed link means for them.                                                                                              | None.            |
| [`REQ-RPC-2-SZDTTM`](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)    | Covered               | **Here:** `setTimeout` timers, `null` for none; settle on close. **Other files:** [ARpcRouter.ts.md](./ARpcRouter.ts.md) owns the pending map.                                                                                                                    | None.            |

## Component test obligations

| Unit test ID                                                                        | Obligation                                                                                                    | Public entry and setup                                                                                                    | Oracle and forbidden effects                                                                                                           | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-port-rpc-router-1-8j6mzg"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG` | Request/response and one-way delivery over a real port pair, and what happens when a line or a handler fails. | Two routers over a Node `MessageChannel`, each serving a probe root and holding a typed endpoint for the other; no mocks. | The result or restored error the caller gets; the pending map after timeout and close; what the logger recorded; the far root's calls. | <a id="unit-test-port-rpc-router-1-8j6mzg.p1"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P1` — a request resolves with the far handler's return value; <a id="unit-test-port-rpc-router-1-8j6mzg.p2"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P2` — a thrown handler rejects with name, revert data and code restored; <a id="unit-test-port-rpc-router-1-8j6mzg.p3"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P3` — the default timeout rejects and clears the pending entry; <a id="unit-test-port-rpc-router-1-8j6mzg.p4"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P4` — a null timeout outlives a handler slower than the default; <a id="unit-test-port-rpc-router-1-8j6mzg.p5"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P5` — closing a transport rejects its pending requests and no other transport's; <a id="unit-test-port-rpc-router-1-8j6mzg.p6"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P6` — an unknown service or method is answered with an error and the line stays up; <a id="unit-test-port-rpc-router-1-8j6mzg.p7"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P7` — a one-way call is delivered and a throwing one-way handler is logged without closing; <a id="unit-test-port-rpc-router-1-8j6mzg.p8"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P8` — the inbound wrapper runs every dispatch; <a id="unit-test-port-rpc-router-1-8j6mzg.p9"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P9` — a bigint and a byte array cross unchanged; <a id="unit-test-port-rpc-router-1-8j6mzg.p10"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P10` — a request slower than the threshold is logged; <a id="unit-test-port-rpc-router-1-8j6mzg.p11"></a>`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P11` — held inbound requests dispatch in order once released |

## Related source reports

- [ARpcRouter.ts.md](./ARpcRouter.ts.md) — the core this specialises.
- [../transport/MessagePortTransport.ts.md](../transport/MessagePortTransport.ts.md) — the transport it attaches.
- [RemoteRpcProxy.ts.md](./RemoteRpcProxy.ts.md) — builds the typed endpoint.
- [WorkerLinks.ts.md](./WorkerLinks.ts.md) — where a link is registered for tree-wide operations.
