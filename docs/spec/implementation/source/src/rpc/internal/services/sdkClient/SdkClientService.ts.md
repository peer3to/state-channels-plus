# SdkClientService.ts — Source Report

> **Source:** [src/rpc/internal/services/sdkClient/SdkClientService.ts](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Holds the public runtime client callback contract and constructs sender-bound callback endpoints. The client remains the owner of queued events and bridge-port installation. Common lifecycle and error services own readiness and upward error delivery.

## Key design decisions

- SDK client handlers contain event and bridge-port delivery only; readiness belongs to lifecycle.

- Helpers and shared state remain on this non-routable service ([`SdkClientService.ts`](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientService.ts#L15)).
- Per-invocation endpoint receivers retain their own sender ([`SdkClientService.ts`](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientService.ts#L23)).

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | The SDK root router and client event/bridge handlers.                                                                                                                                                                                                             |
| Outputs      | A sender-bound endpoint receiver and delegated domain results.                                                                                                                                                                                                    |
| Owned state  | References to existing domain owners and service-specific lifecycle hooks; no private request registry.                                                                                                                                                           |
| Side effects | BusEvent and webRTCBridgePort are typed sends. Readiness is delivered by the common lifecycle service. Event publication stays synchronous so producer-visible clone failures and local-before-bridge ordering remain observable. Bridge transfer precedes ready. |

## Linked requirements

| Source file                                                                                                    | Specification IDs                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`SdkClientService.ts`](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientService.ts#L1) | [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) |

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The service delegates state and ordering to the existing domain owner
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): The shared service boundary retains acknowledged requests and domain failure handling
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The paired endpoint methods define the serializable operation contract

## Assumptions, dependencies, trust boundaries, and limits

BusEvent and webRTCBridgePort are typed sends. Readiness is delivered by the common lifecycle service. Event publication stays synchronous so producer-visible clone failures and local-before-bridge ordering remain observable. Bridge transfer precedes ready. Request versus send is selected explicitly by the caller. The service adds no peer admission policy, transport-specific error codec or router-wide queue.

## Specification adherence

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The service delegates state and ordering to the existing domain owner See [`SdkClientService.ts`](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientService.ts#L15).
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): The shared service boundary retains acknowledged requests and domain failure handling See [`SdkClientService.ts`](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientService.ts#L15).
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The paired endpoint methods define the serializable operation contract See [`SdkClientService.ts`](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientService.ts#L15).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Gap / divergence                         |
| ------------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** The service delegates state and ordering to the existing domain owner [`SdkClientService.ts`](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientService.ts#L15). **Other files:** [SdkClientRpcMethods.ts](SdkClientRpcMethods.ts.md) (event, error and bridge-port endpoints), [EventForwarding.ts](../../../../evm/p2pRuntime/host/EventForwarding.ts.md) (synchronous application handler and event ordering), [P2pRuntimeClientRoot.ts](../../roots/P2pRuntimeClientRoot.ts.md) (public client mirrors, readiness and teardown), [P2pRuntimeClientRoot.ts](../../roots/P2pRuntimeClientRoot.ts.md) (client callback and logger composition), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation).                 | None demonstrated for this contribution. |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** The shared service boundary retains acknowledged requests and domain failure handling [`SdkClientService.ts`](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientService.ts#L15). **Other files:** [SdkClientRpcMethods.ts](SdkClientRpcMethods.ts.md) (event, error and bridge-port endpoints), [EventForwarding.ts](../../../../evm/p2pRuntime/host/EventForwarding.ts.md) (synchronous application handler and event ordering), [P2pRuntimeClientRoot.ts](../../roots/P2pRuntimeClientRoot.ts.md) (public client mirrors, readiness and teardown), [P2pRuntimeClientRoot.ts](../../roots/P2pRuntimeClientRoot.ts.md) (client callback and logger composition), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation). | None demonstrated for this contribution. |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** The paired endpoint methods define the serializable operation contract [`SdkClientService.ts`](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientService.ts#L15). **Other files:** [SdkClientRpcMethods.ts](SdkClientRpcMethods.ts.md) (event, error and bridge-port endpoints), [EventForwarding.ts](../../../../evm/p2pRuntime/host/EventForwarding.ts.md) (synchronous application handler and event ordering), [P2pRuntimeClientRoot.ts](../../roots/P2pRuntimeClientRoot.ts.md) (public client mirrors, readiness and teardown), [P2pRuntimeClientRoot.ts](../../roots/P2pRuntimeClientRoot.ts.md) (client callback and logger composition), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation).                | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [SdkClientRpcMethods.ts](SdkClientRpcMethods.ts.md)
- [EventForwarding.ts](../../../../evm/p2pRuntime/host/EventForwarding.ts.md)
- [P2pRuntimeClientRoot.ts](../../roots/P2pRuntimeClientRoot.ts.md)
- [P2pRuntimeClientRoot.ts](../../roots/P2pRuntimeClientRoot.ts.md)
- [AInternalRpcService.ts](../../AInternalRpcService.ts.md)
