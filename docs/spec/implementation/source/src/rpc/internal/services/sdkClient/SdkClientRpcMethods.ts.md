# SdkClientRpcMethods.ts — Source Report

> **Source:** [src/rpc/internal/services/sdkClient/SdkClientRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Declares only the public callbacks endpoints: `busEvent`, `webRTCBridgePort`. Each receiver uses its service for dependencies and retains its invocation sender.

## Key design decisions

- Endpoint declarations are the concrete source of bound remote argument/result types ([`SdkClientRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientRpcMethods.ts#L7)).
- Domain work delegates through the service; helpers are not added to the routable receiver ([`SdkClientRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientRpcMethods.ts#L7)).

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Typed positional endpoint arguments and the service/sender receiver supplied by shared dispatch.                                                                                                                                                                  |
| Outputs      | Domain values or awaited void acknowledgements through the shared response path.                                                                                                                                                                                  |
| Owned state  | Invocation-local receiver only; domain state stays on the service or existing owner.                                                                                                                                                                              |
| Side effects | BusEvent and webRTCBridgePort are typed sends. Readiness is delivered by the common lifecycle service. Event publication stays synchronous so producer-visible clone failures and local-before-bridge ordering remain observable. Bridge transfer precedes ready. |

## Linked requirements

| Source file                                                                                                          | Specification IDs                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`SdkClientRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientRpcMethods.ts#L1) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The endpoint declarations and domain projections preserve argument and result meaning
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The invocation receiver delegates to the canonical domain owner

## Assumptions, dependencies, trust boundaries, and limits

BusEvent and webRTCBridgePort are typed sends. Readiness is delivered by the common lifecycle service. Event publication stays synchronous so producer-visible clone failures and local-before-bridge ordering remain observable. Bridge transfer precedes ready. Constructor, base members, getters and service helpers are excluded by common descriptor dispatch. The trailing delivery operation decides whether a response is required; void does not imply fire-and-forget.

## Specification adherence

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The endpoint declarations and domain projections preserve argument and result meaning See [`SdkClientRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientRpcMethods.ts#L7).
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The invocation receiver delegates to the canonical domain owner See [`SdkClientRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientRpcMethods.ts#L7).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Gap / divergence                         |
| ------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** The endpoint declarations and domain projections preserve argument and result meaning [`SdkClientRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientRpcMethods.ts#L7). **Other files:** [SdkClientService.ts](SdkClientService.ts.md) (client callback dependency ownership), [P2pRuntimeClientRoot.ts](../../roots/P2pRuntimeClientRoot.ts.md) (public client mirrors, readiness and teardown), [RpcDispatch.ts](../../../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation). | None demonstrated for this contribution. |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** The invocation receiver delegates to the canonical domain owner [`SdkClientRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientRpcMethods.ts#L7). **Other files:** [SdkClientService.ts](SdkClientService.ts.md) (client callback dependency ownership), [P2pRuntimeClientRoot.ts](../../roots/P2pRuntimeClientRoot.ts.md) (public client mirrors, readiness and teardown), [RpcDispatch.ts](../../../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation).                       | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [SdkClientService.ts](SdkClientService.ts.md)
- [P2pRuntimeClientRoot.ts](../../roots/P2pRuntimeClientRoot.ts.md)
- [RpcDispatch.ts](../../../RpcDispatch.ts.md)
- [AInternalRpcService.ts](../../AInternalRpcService.ts.md)
