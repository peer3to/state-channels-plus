# HostRpcService.ts — Source Report

> **Source:** [src/rpc/internal/services/hostRpc/HostRpcService.ts](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Replays a client host-RPC invocation onto the live peer remoteRpc surface after the host readiness accessor succeeds. It preserves delivery names, recipient arguments and timeout options.

## Key design decisions

- Helpers and shared state remain on this non-routable service ([`HostRpcService.ts`](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcService.ts#L26)).
- Per-invocation endpoint receivers retain their own sender ([`HostRpcService.ts`](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcService.ts#L16)).

Before invoking a network proxy, the bridge requires a real local network service and one of request, sendOne, sendMultiple or broadcast. Unknown selectors reject without invoking the target.

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | The SDK root router, error hook and existing domain dependencies.                                                                                                                                                                   |
| Outputs      | A sender-bound endpoint receiver and delegated domain results.                                                                                                                                                                      |
| Owned state  | References to existing domain owners and service-specific lifecycle hooks; no private request registry.                                                                                                                             |
| Side effects | The outer acknowledgement confirms host dispatch for a one-way peer send; a peer request waits for its peer result. Unknown delivery names reject with the existing host error. No live network transport is sent across this port. |

## Linked requirements

| Source file                                                                                              | Specification IDs                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`HostRpcService.ts`](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcService.ts#L1) | [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The service delegates state and ordering to the existing domain owner
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): The shared service boundary retains acknowledged requests and domain failure handling

## Assumptions, dependencies, trust boundaries, and limits

The outer acknowledgement confirms host dispatch for a one-way peer send; a peer request waits for its peer result. Unknown delivery names reject with the existing host error. No live network transport is sent across this port. Request versus send is selected explicitly by the caller. The service adds no peer admission policy, transport-specific error codec or router-wide queue.

## Specification adherence

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The service delegates state and ordering to the existing domain owner See [`HostRpcService.ts`](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcService.ts#L26).
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): The shared service boundary retains acknowledged requests and domain failure handling See [`HostRpcService.ts`](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcService.ts#L26).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Gap / divergence                         |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** The service delegates state and ordering to the existing domain owner [`HostRpcService.ts`](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcService.ts#L26). **Other files:** [HostRpcRpcMethods.ts](HostRpcRpcMethods.ts.md) (typed host peer-RPC bridge endpoint), [RpcHandler.ts](../../../network/RpcHandler.ts.md) (network recipient selection and delivery operations), [ClientHostRpc.ts](../../../../evm/p2pRuntime/ClientHostRpc.ts.md) (client forwarding to host peer-RPC delivery), [P2pRuntimeHostRoot.ts](../../roots/P2pRuntimeHostRoot.ts.md) (SDK domain and common error service composition), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation).                 | None demonstrated for this contribution. |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** The shared service boundary retains acknowledged requests and domain failure handling [`HostRpcService.ts`](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcService.ts#L26). **Other files:** [HostRpcRpcMethods.ts](HostRpcRpcMethods.ts.md) (typed host peer-RPC bridge endpoint), [RpcHandler.ts](../../../network/RpcHandler.ts.md) (network recipient selection and delivery operations), [ClientHostRpc.ts](../../../../evm/p2pRuntime/ClientHostRpc.ts.md) (client forwarding to host peer-RPC delivery), [P2pRuntimeHostRoot.ts](../../roots/P2pRuntimeHostRoot.ts.md) (SDK domain and common error service composition), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation). | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID                                                          | Obligation                                                                                                  | Public entry and setup         | Oracle and forbidden effects                                                                                | Required permutations                                                                                                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-host-rpc-1-x1qfza"></a>`UNIT-TEST-HOST-RPC-1-X1QFZA` | Unknown service and unsupported delivery selectors reject before proxy invocation; the host remains usable. | Real owner with scoped inputs. | Unknown service and unsupported delivery selectors reject before proxy invocation; the host remains usable. | <a id="unit-test-host-rpc-1-x1qfza.p1"></a>`UNIT-TEST-HOST-RPC-1-X1QFZA.P1` — Unknown service and unsupported delivery selectors reject before proxy invocation; the host remains usable. |

## Related source reports

- [HostRpcRpcMethods.ts](HostRpcRpcMethods.ts.md)
- [RpcHandler.ts](../../../network/RpcHandler.ts.md)
- [ClientHostRpc.ts](../../../../evm/p2pRuntime/ClientHostRpc.ts.md)
- [P2pRuntimeHostRoot.ts](../../roots/P2pRuntimeHostRoot.ts.md)
- [AInternalRpcService.ts](../../AInternalRpcService.ts.md)
