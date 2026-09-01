# RemoteRpcProxy.ts — Source Report

> **Source:** [src/rpc/RemoteRpcProxy.ts](../../../../../../src/rpc/RemoteRpcProxy.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Responsibility and observable boundary

The root typed proxy: substitutes every structurally valid service on the local root with its
RpcMethods-typed sending surface (`remoteRpc.initHandshakeService.…`), caching one per-service
proxy even when the service came from another JavaScript module graph. `createEndpoint` builds the
same proxy for the far end of a worker link, typed by the far root's manifest and bound to that link
as its default target.

## Key design decisions

1. **Normal string property access exposes only services.** Accessing an ordinary or missing string
   property throws. Symbol reads pass through for JavaScript inspection, while `then` always reads as
   `undefined` so Promise assimilation cannot treat the proxy as a thenable
   ([#L33](../../../../../../src/rpc/RemoteRpcProxy.ts#L33)). This `get` boundary is a trusted local
   calling API, not a reflective object sandbox: property enumeration, descriptors, and `in` retain
   ordinary JavaScript proxy behavior.
2. **Service identity is structural at runtime.** The proxy retains `ARpcService` for compile-time mapping but recognizes the public service operations instead of requiring one constructor object ([#L1](../../../../../../src/rpc/RemoteRpcProxy.ts#L1), [#L41](../../../../../../src/rpc/RemoteRpcProxy.ts#L41)).
3. **The cache is per service name.** Repeated access to one service returns its existing methods
   proxy, while different service names receive different proxies ([#L49](../../../../../../src/rpc/RemoteRpcProxy.ts#L49)).

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

| Unit test ID                                                                          | Obligation                                                 | Public entry and setup                                                                                                                                   | Oracle and forbidden effects                                                                                                                                             | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-remote-rpc-proxy-1-tzz729"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729` | Service-only string access and JavaScript interoperability | Access structurally compatible, incomplete, ordinary, missing, symbol, and `then` properties through `createProxy`; access two named services repeatedly | Compatible services yield name-scoped cached proxies; invalid string properties throw; symbols pass through; Promise assimilation returns the proxy without invoking RPC | <a id="unit-test-remote-rpc-proxy-1-tzz729.p1"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P1` — structurally compatible service access + repeated-access cache identity; <a id="unit-test-remote-rpc-proxy-1-tzz729.p2"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P2` — incomplete service rejects; <a id="unit-test-remote-rpc-proxy-1-tzz729.p3"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P3` — symbol passthrough; <a id="unit-test-remote-rpc-proxy-1-tzz729.p4"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P4` — ordinary and missing string properties reject; <a id="unit-test-remote-rpc-proxy-1-tzz729.p5"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P5` — `then` is reserved and Promise assimilation preserves proxy identity; <a id="unit-test-remote-rpc-proxy-1-tzz729.p6"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P6` — separate service names have separate caches |

## Related source reports

- [RpcHandleProxy](./RpcHandleProxy.ts.md), [MainRpcService](./MainRpcService.ts.md).
