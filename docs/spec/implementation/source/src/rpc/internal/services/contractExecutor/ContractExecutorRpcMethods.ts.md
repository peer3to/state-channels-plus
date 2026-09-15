# ContractExecutorRpcMethods.ts — Source Report

> **Source:** [src/rpc/internal/services/contractExecutor/ContractExecutorRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/contractExecutor/ContractExecutorRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Exposes deploy, executeCall and simulateCall through the same receiving service in both placements. Common root startup initializes the engine; lifecycle endpoints coordinate disposal.

## Key design decisions

- Executor disposal is invoked through the root lifecycle service. Its operation still calls the executor owner; the lifecycle after-response hook retains dedicated-worker shutdown ordering. Inline disposal releases the engine and closes the root connection.

- Only public endpoint functions live on this receiver ([`ContractExecutorRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/contractExecutor/ContractExecutorRpcMethods.ts#L8)).
- The sender and service belong to this invocation, not mutable shared dispatch state ([`ContractExecutorRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/contractExecutor/ContractExecutorRpcMethods.ts#L8)).

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Typed endpoint arguments and the invocation sender supplied by shared dispatch.                                                                                                          |
| Outputs      | Domain results, acknowledged void operations or explicit one-way callback effects.                                                                                                       |
| Owned state  | Per-invocation receiver only.                                                                                                                                                            |
| Side effects | Exposes deploy, executeCall and simulateCall through the same receiving service in both placements. Common root startup initializes the engine; lifecycle endpoints coordinate disposal. |

## Linked requirements

| Source file                                                                                                                               | Specification IDs                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ContractExecutorRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/contractExecutor/ContractExecutorRpcMethods.ts#L1) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): Endpoint declarations retain named serializable domain arguments and results
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The receiver delegates to its existing service and domain owner

## Assumptions, dependencies, trust boundaries, and limits

The engine readiness check precedes execution. Canonical execution and simulation retain the engine mutex; disposal is terminal in both placements. Helpers and resource maps remain on the service or canonical domain owner. Common dispatch rejects base methods, constructors, accessors and non-function shadows.

## Specification adherence

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): Endpoint declarations retain named serializable domain arguments and results See [`ContractExecutorRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/contractExecutor/ContractExecutorRpcMethods.ts#L8).
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The receiver delegates to its existing service and domain owner See [`ContractExecutorRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/contractExecutor/ContractExecutorRpcMethods.ts#L8).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Gap / divergence                         |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** Endpoint declarations retain named serializable domain arguments and results [`ContractExecutorRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/contractExecutor/ContractExecutorRpcMethods.ts#L8). **Other files:** [ContractExecutorService.ts](ContractExecutorService.ts.md) (receiving engine initialization, monitoring and disposal), [ContractExecutor.ts](../../../../evm/contractExecutor/ContractExecutor.ts.md) (canonical EVM state and execution mutex), [RpcDispatch.ts](../../../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation). | None demonstrated for this contribution. |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** The receiver delegates to its existing service and domain owner [`ContractExecutorRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/contractExecutor/ContractExecutorRpcMethods.ts#L8). **Other files:** [ContractExecutorService.ts](ContractExecutorService.ts.md) (receiving engine initialization, monitoring and disposal), [ContractExecutor.ts](../../../../evm/contractExecutor/ContractExecutor.ts.md) (canonical EVM state and execution mutex), [RpcDispatch.ts](../../../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation).              | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [ContractExecutorService.ts](ContractExecutorService.ts.md)
- [ContractExecutor.ts](../../../../evm/contractExecutor/ContractExecutor.ts.md)
- [RpcDispatch.ts](../../../RpcDispatch.ts.md)
- [AInternalRpcService.ts](../../AInternalRpcService.ts.md)
