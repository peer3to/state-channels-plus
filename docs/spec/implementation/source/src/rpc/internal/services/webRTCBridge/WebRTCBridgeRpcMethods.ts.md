# WebRTCBridgeRpcMethods.ts — Source Report

> **Source:** [src/rpc/internal/services/webRTCBridge/WebRTCBridgeRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Delivers transferred or proxy channels, state, ICE, errors and proxy messages to the existing worker bridge client.

## Key design decisions

- Only public endpoint functions live on this receiver ([`WebRTCBridgeRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeRpcMethods.ts#L10)).
- The sender and service belong to this invocation, not mutable shared dispatch state ([`WebRTCBridgeRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeRpcMethods.ts#L10)).

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Typed endpoint arguments and the invocation sender supplied by shared dispatch.                                     |
| Outputs      | Domain results, acknowledged void operations or explicit one-way callback effects.                                  |
| Owned state  | Per-invocation receiver only.                                                                                       |
| Side effects | Delivers transferred or proxy channels, state, ICE, errors and proxy messages to the existing worker bridge client. |

## Linked requirements

| Source file                                                                                                                   | Specification IDs                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`WebRTCBridgeRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeRpcMethods.ts#L1) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): Endpoint declarations retain named serializable domain arguments and results
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The receiver delegates to its existing service and domain owner

## Assumptions, dependencies, trust boundaries, and limits

Transferred channels require the explicit transfer list. Current-channel checks, callback replacement and closed proxy behavior remain with the client. Helpers and resource maps remain on the service or canonical domain owner. Common dispatch rejects base methods, constructors, accessors and non-function shadows.

## Specification adherence

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): Endpoint declarations retain named serializable domain arguments and results See [`WebRTCBridgeRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeRpcMethods.ts#L10).
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The receiver delegates to its existing service and domain owner See [`WebRTCBridgeRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeRpcMethods.ts#L10).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Gap / divergence                         |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** Endpoint declarations retain named serializable domain arguments and results [`WebRTCBridgeRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeRpcMethods.ts#L10). **Other files:** [WebRTCBridgeService.ts](WebRTCBridgeService.ts.md) (worker callback service binding), [WorkerBridgeWebRTCConnectionFactory.ts](../../../network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts.md) (worker callback/channel maps and bridge holds), [RpcDispatch.ts](../../../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation). | None demonstrated for this contribution. |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** The receiver delegates to its existing service and domain owner [`WebRTCBridgeRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeRpcMethods.ts#L10). **Other files:** [WebRTCBridgeService.ts](WebRTCBridgeService.ts.md) (worker callback service binding), [WorkerBridgeWebRTCConnectionFactory.ts](../../../network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts.md) (worker callback/channel maps and bridge holds), [RpcDispatch.ts](../../../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation).              | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [WebRTCBridgeService.ts](WebRTCBridgeService.ts.md)
- [WorkerBridgeWebRTCConnectionFactory.ts](../../../network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts.md)
- [RpcDispatch.ts](../../../RpcDispatch.ts.md)
- [AInternalRpcService.ts](../../AInternalRpcService.ts.md)
