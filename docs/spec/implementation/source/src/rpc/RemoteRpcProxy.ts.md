# RemoteRpcProxy.ts — Source Report

> **Source:** [src/rpc/RemoteRpcProxy.ts](../../../../../../src/rpc/RemoteRpcProxy.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Responsibility and observable boundary

`createRemoteRpcProxy(router)` builds one router's `remoteRpc`: a proxy that answers every service
name on the far root with that service's RpcMethods-typed sending surface
(`remoteRpc.initHandshakeService.…`), caching one per-service proxy even when the service came from
another JavaScript module graph. The far root is never instantiated here — the type parameter names
its services and nothing else. It is a function, not a class: the router is its only caller and it
holds no state of its own.

## Key design decisions

1. **The type is the contract.** Every string property answers with a methods proxy for a service of
   that name; whether the far root actually serves it is settled by the far end's own refusal, not
   locally. Symbol reads pass through for JavaScript inspection, while `then` always reads as
   `undefined` so Promise assimilation cannot treat the proxy as a thenable
   ([`get`](../../../../../../src/rpc/RemoteRpcProxy.ts#L30)). This `get` boundary is a trusted local
   calling API, not a reflective object sandbox: property enumeration, descriptors, and `in` retain
   ordinary JavaScript proxy behavior.
2. **Service identity is structural at runtime.** `RemoteRpcServices` retains `ARpcService` for
   compile-time mapping; nothing at runtime requires one constructor object
   ([`RemoteRpcServices`](../../../../../../src/rpc/RemoteRpcProxy.ts#L6)).
3. **The cache is per service name.** Repeated access to one service returns its existing methods
   proxy, while different service names receive different proxies ([`proxyCache`](../../../../../../src/rpc/RemoteRpcProxy.ts#L22)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                |
| ------------ | --------------------------------------------------------------------------------------- |
| Inputs       | String or symbol property accesses on a trusted local RPC root.                         |
| Outputs      | Cached per-service typed proxies, passthrough symbol values, or `undefined` for `then`. |
| Owned state  | Proxy cache.                                                                            |
| Side effects | None.                                                                                   |

## Linked requirements

| Source file                                                      | Specification IDs                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [RemoteRpcProxy.ts](../../../../../../src/rpc/RemoteRpcProxy.ts) | [`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) |

## Assumptions, dependencies, trust boundaries, and limits

- Custom roots extend the same declared shape; their services join the typed surface even when a
  production bundler emits the extension and runtime through separate module graphs.
- The root and its service-name bindings remain stable after proxy creation. Replacing a service does
  not invalidate the cached methods proxy.
- The structural property check follows JavaScript's `in` semantics, so a compatible inherited service
  is accepted. Custom roots are locally constructed and trusted; this proxy is not a hostile-object
  validation boundary.
- `then` is reserved by the proxy and cannot be used as a service name.

## Specification adherence

- Public-surface confinement at the type and runtime levels ([`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)).

## Conformance traceability

| Requirement / invariant                                                                    | Implementation status | Evidence                                                                                                                                                                                                                | Gap / divergence |
| ------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) | Covered               | **Here:** structural service-only access with runtime enforcement. **Other files:** [ObjectChecks](../utils/ObjectChecks.ts.md) owns the shared predicate; [MainRpcService](./MainRpcService.ts.md) defines the roster. | None.            |

## Component test obligations

| Unit test ID                                                                          | Obligation                                                 | Public entry and setup                                                                                                                                                                                | Oracle and forbidden effects                                                                                                                                                                                           | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-remote-rpc-proxy-1-tzz729"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729` | Service-only string access and JavaScript interoperability | Access structurally compatible, incomplete, arbitrary, symbol, and `then` properties through `createProxy`; access two named services repeatedly; send a frame for a name the far root does not serve | Compatible services yield name-scoped cached proxies; any string name yields a live handle and the far end refuses it; symbols and `then` are `undefined`; Promise assimilation returns the proxy without invoking RPC | <a id="unit-test-remote-rpc-proxy-1-tzz729.p1"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P1` — structurally compatible service access + repeated-access cache identity; <a id="unit-test-remote-rpc-proxy-1-tzz729.p2"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P2` — incomplete service rejects; <a id="unit-test-remote-rpc-proxy-1-tzz729.p5"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P5` — `then` is reserved and Promise assimilation preserves proxy identity; <a id="unit-test-remote-rpc-proxy-1-tzz729.p6"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P6` — separate service names have separate caches; <a id="unit-test-remote-rpc-proxy-1-tzz729.p7"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P7` — symbol property access returns `undefined`; <a id="unit-test-remote-rpc-proxy-1-tzz729.p8"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P8` — an arbitrary string name still yields a live handle whose frame is sent, and the far router answers `Unknown RPC service` |

## Related source reports

- [RpcHandleProxy](./RpcHandleProxy.ts.md), [MainRpcService](./MainRpcService.ts.md).
