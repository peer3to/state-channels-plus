# HostRpcRpcMethods.ts — Source Report

> **Source:** [src/rpc/internal/services/hostRpc/HostRpcRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Declares only the public hostRpc endpoints: `invoke`. Each receiver uses its service for dependencies and retains its invocation sender.

## Key design decisions

- Endpoint declarations are the concrete source of bound remote argument/result types ([`HostRpcRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcRpcMethods.ts#L16)).
- Domain work delegates through the service; helpers are not added to the routable receiver ([`HostRpcRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcRpcMethods.ts#L16)).

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Typed positional endpoint arguments and the service/sender receiver supplied by shared dispatch.                                                                                                                                    |
| Outputs      | Domain values or awaited void acknowledgements through the shared response path.                                                                                                                                                    |
| Owned state  | Invocation-local receiver only; domain state stays on the service or existing owner.                                                                                                                                                |
| Side effects | The outer acknowledgement confirms host dispatch for a one-way peer send; a peer request waits for its peer result. Unknown delivery names reject with the existing host error. No live network transport is sent across this port. |

## Linked requirements

| Source file                                                                                                    | Specification IDs                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`HostRpcRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcRpcMethods.ts#L1) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The endpoint declarations and domain projections preserve argument and result meaning
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The invocation receiver delegates to the canonical domain owner

## Assumptions, dependencies, trust boundaries, and limits

The outer acknowledgement confirms host dispatch for a one-way peer send; a peer request waits for its peer result. Unknown delivery names reject with the existing host error. No live network transport is sent across this port. Constructor, base members, getters and service helpers are excluded by common descriptor dispatch. The trailing delivery operation decides whether a response is required; void does not imply fire-and-forget.

## Specification adherence

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The endpoint declarations and domain projections preserve argument and result meaning See [`HostRpcRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcRpcMethods.ts#L16).
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The invocation receiver delegates to the canonical domain owner See [`HostRpcRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcRpcMethods.ts#L16).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Gap / divergence                         |
| ------------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** The endpoint declarations and domain projections preserve argument and result meaning [`HostRpcRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcRpcMethods.ts#L16). **Other files:** [HostRpcService.ts](HostRpcService.ts.md) (forwarding delivery arguments to peer RPC), [ClientHostRpc.ts](../../../../evm/p2pRuntime/ClientHostRpc.ts.md) (client forwarding to host peer-RPC delivery), [RpcDispatch.ts](../../../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation). | None demonstrated for this contribution. |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** The invocation receiver delegates to the canonical domain owner [`HostRpcRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcRpcMethods.ts#L16). **Other files:** [HostRpcService.ts](HostRpcService.ts.md) (forwarding delivery arguments to peer RPC), [ClientHostRpc.ts](../../../../evm/p2pRuntime/ClientHostRpc.ts.md) (client forwarding to host peer-RPC delivery), [RpcDispatch.ts](../../../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation).                       | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [HostRpcService.ts](HostRpcService.ts.md)
- [ClientHostRpc.ts](../../../../evm/p2pRuntime/ClientHostRpc.ts.md)
- [RpcDispatch.ts](../../../RpcDispatch.ts.md)
- [AInternalRpcService.ts](../../AInternalRpcService.ts.md)
