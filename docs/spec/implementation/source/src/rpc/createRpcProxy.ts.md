# createRpcProxy.ts — Source Report

> **Source:** [src/rpc/createRpcProxy.ts](../../../../../../src/rpc/createRpcProxy.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Builds service/method/argument payloads for both peer facades and bound runtime connections. Delivery is injected, so this module contains no transport selection, pending registry or domain serialization.

## Key design decisions

- One method proxy builds the same logical payload for all call styles ([`createRpcProxy.ts`](../../../../../../src/rpc/createRpcProxy.ts#L3)).
- A service name may be read at invocation time to preserve the existing mutable peer method context ([`createRpcProxy.ts`](../../../../../../src/rpc/createRpcProxy.ts#L17)).
- Root service proxies are cached; symbols and thenable inspection retain their existing behavior ([`createRpcProxy.ts`](../../../../../../src/rpc/createRpcProxy.ts#L27)).

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------- |
| Inputs       | Delivery callback, optional root target and service validator; service name or accessor. |
| Outputs      | Cached root/service proxies whose method calls construct logical RPC payloads.           |
| Owned state  | One service-name-to-proxy cache per root proxy.                                          |
| Side effects | Invokes the supplied delivery builder; no network or port operation by itself.           |

## Linked requirements

| Source file                                                           | Specification IDs                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`createRpcProxy.ts`](../../../../../../src/rpc/createRpcProxy.ts#L1) | [`REQ-RPC-2-SZDTTM`](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm), [`REQ-RUNTIME-1-RSM6MZ`](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

- [`REQ-RPC-2-SZDTTM` (Request lifecycle)](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm): Peer delivery keeps its service/method/argument construction through an injected delivery handler
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): Internal and peer facades construct the same logical envelope without changing domain values
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y): Symbol access, service caches and non-thenable roots remain platform-neutral

## Assumptions, dependencies, trust boundaries, and limits

The peer facade alone adds address, self and broadcast selectors. Internal connections bind the recipient before method selection and expose trailing request/send operations. Endpoint types derive from service method declarations; this runtime builder does not infer send versus request from erased TypeScript return types.

## Specification adherence

- [`REQ-RPC-2-SZDTTM` (Request lifecycle)](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm): Peer delivery keeps its service/method/argument construction through an injected delivery handler See [`createRpcProxy.ts`](../../../../../../src/rpc/createRpcProxy.ts#L3).
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): Internal and peer facades construct the same logical envelope without changing domain values See [`createRpcProxy.ts`](../../../../../../src/rpc/createRpcProxy.ts#L17).
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y): Symbol access, service caches and non-thenable roots remain platform-neutral See [`createRpcProxy.ts`](../../../../../../src/rpc/createRpcProxy.ts#L27).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Gap / divergence                         |
| --------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RPC-2-SZDTTM`](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)    | Covered               | **Here:** Peer delivery keeps its service/method/argument construction through an injected delivery handler [`createRpcProxy.ts`](../../../../../../src/rpc/createRpcProxy.ts#L3). **Other files:** [RemoteRpcProxy.ts](network/RemoteRpcProxy.ts.md) (typed peer root facade), [RpcHandleProxy.ts](network/RpcHandleProxy.ts.md) (peer method typing and mutable service context), [ClientHostRpc.ts](../evm/p2pRuntime/ClientHostRpc.ts.md) (client forwarding to host peer-RPC delivery), [AInternalRpcRoot.ts](internal/AInternalRpcRoot.ts.md) (endpoint connection lifetime, logger composition and local root registry). | None demonstrated for this contribution. |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** Internal and peer facades construct the same logical envelope without changing domain values [`createRpcProxy.ts`](../../../../../../src/rpc/createRpcProxy.ts#L17). **Other files:** [RemoteRpcProxy.ts](network/RemoteRpcProxy.ts.md) (typed peer root facade), [RpcHandleProxy.ts](network/RpcHandleProxy.ts.md) (peer method typing and mutable service context), [ClientHostRpc.ts](../evm/p2pRuntime/ClientHostRpc.ts.md) (client forwarding to host peer-RPC delivery), [AInternalRpcRoot.ts](internal/AInternalRpcRoot.ts.md) (endpoint connection lifetime, logger composition and local root registry).     | None demonstrated for this contribution. |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** Symbol access, service caches and non-thenable roots remain platform-neutral [`createRpcProxy.ts`](../../../../../../src/rpc/createRpcProxy.ts#L27). **Other files:** [RemoteRpcProxy.ts](network/RemoteRpcProxy.ts.md) (typed peer root facade), [RpcHandleProxy.ts](network/RpcHandleProxy.ts.md) (peer method typing and mutable service context), [ClientHostRpc.ts](../evm/p2pRuntime/ClientHostRpc.ts.md) (client forwarding to host peer-RPC delivery), [AInternalRpcRoot.ts](internal/AInternalRpcRoot.ts.md) (endpoint connection lifetime, logger composition and local root registry).                     | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID                                                            | Obligation                                                  | Public entry and setup                                                                          | Oracle and forbidden effects                                                                                                                                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-rpc-proxy-1-r74w81"></a>`UNIT-TEST-RPC-PROXY-1-R74W81` | Derived service-first call types and shared proxy behavior. | Actual SDK-owned roots and connected domain services; narrow controls act on those connections. | Compiler assertions reject invalid service/method/args/result/recipient/helper use. Runtime assertions preserve result/void/send semantics, captured peer context and non-thenable roots. | <a id="unit-test-rpc-proxy-1-r74w81.p1"></a>`UNIT-TEST-RPC-PROXY-1-R74W81.P1`: Reads a mutable peer service context when the captured method is called.<br><a id="unit-test-rpc-proxy-1-r74w81.p2"></a>`UNIT-TEST-RPC-PROXY-1-R74W81.P2`: Preserves bound arguments results void acknowledgement and explicit sends.<br><a id="unit-test-rpc-proxy-1-r74w81.p3"></a>`UNIT-TEST-RPC-PROXY-1-R74W81.P3`: Keeps runtime proxy roots non-thenable. |

## Related source reports

- [RemoteRpcProxy.ts](network/RemoteRpcProxy.ts.md)
- [RpcHandleProxy.ts](network/RpcHandleProxy.ts.md)
- [ClientHostRpc.ts](../evm/p2pRuntime/ClientHostRpc.ts.md)
- [AInternalRpcRoot.ts](internal/AInternalRpcRoot.ts.md)
