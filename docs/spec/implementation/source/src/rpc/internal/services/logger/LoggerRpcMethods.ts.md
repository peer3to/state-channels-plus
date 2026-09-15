# LoggerRpcMethods.ts — Source Report

> **Source:** [src/rpc/internal/services/logger/LoggerRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/logger/LoggerRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Exposes upload(index, reason) and contextUpdate(context, index) sends on every runtime root.

## Key design decisions

- Only public endpoint functions live on this receiver ([`LoggerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/logger/LoggerRpcMethods.ts#L6)).
- The sender and service belong to this invocation, not mutable shared dispatch state ([`LoggerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/logger/LoggerRpcMethods.ts#L6)).

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------- |
| Inputs       | Typed endpoint arguments and the invocation sender supplied by shared dispatch.              |
| Outputs      | Domain results, acknowledged void operations or explicit one-way callback effects.           |
| Owned state  | Per-invocation receiver only.                                                                |
| Side effects | Exposes upload(index, reason) and contextUpdate(context, index) sends on every runtime root. |

## Linked requirements

| Source file                                                                                                 | Specification IDs                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`LoggerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/logger/LoggerRpcMethods.ts#L1) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): Endpoint declarations retain named serializable domain arguments and results
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The receiver delegates to its existing service and domain owner

## Assumptions, dependencies, trust boundaries, and limits

Both endpoints pass their invocation sender to the logger service. Gossip is fire-and-forget; there is no upload acknowledgment or request registry. Helpers and resource maps remain on the service or canonical domain owner. Common dispatch rejects base methods, constructors, accessors and non-function shadows.

## Specification adherence

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): Endpoint declarations retain named serializable domain arguments and results See [`LoggerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/logger/LoggerRpcMethods.ts#L6).
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The receiver delegates to its existing service and domain owner See [`LoggerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/logger/LoggerRpcMethods.ts#L6).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Gap / divergence                         |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** Endpoint declarations retain named serializable domain arguments and results [`LoggerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/logger/LoggerRpcMethods.ts#L6). **Other files:** [LoggerService.ts](LoggerService.ts.md) (store collection, context direction and traversal), [AInternalRpcRoot.ts](../../AInternalRpcRoot.ts.md) (endpoint connection lifetime, logger composition and local root registry), [RpcDispatch.ts](../../../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation). | None demonstrated for this contribution. |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** The receiver delegates to its existing service and domain owner [`LoggerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/logger/LoggerRpcMethods.ts#L6). **Other files:** [LoggerService.ts](LoggerService.ts.md) (store collection, context direction and traversal), [AInternalRpcRoot.ts](../../AInternalRpcRoot.ts.md) (endpoint connection lifetime, logger composition and local root registry), [RpcDispatch.ts](../../../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation).              | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [LoggerService.ts](LoggerService.ts.md)
- [AInternalRpcRoot.ts](../../AInternalRpcRoot.ts.md)
- [RpcDispatch.ts](../../../RpcDispatch.ts.md)
- [AInternalRpcService.ts](../../AInternalRpcService.ts.md)
