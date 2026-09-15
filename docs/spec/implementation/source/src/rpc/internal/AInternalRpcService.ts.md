# AInternalRpcService.ts — Source Report

> **Source:** [src/rpc/internal/AInternalRpcService.ts](../../../../../../../src/rpc/internal/AInternalRpcService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Defines the runtime service boundary; [AInternalRpcMethods](./AInternalRpcMethods.ts.md) owns the sender-bound endpoint receiver. It reuses common descriptor dispatch and awaited invocation, and sends responses directly without inheriting peer guards or a peer manager.

The afterResponse hook runs in finally after every response attempt. An admitted lifecycle or failed-setup disposal therefore releases its final resources even when posting to the parent fails.

## Key design decisions

- Unreturned endpoint errors and response-send failures use the owning root’s `reportError` method. Services receive no separate error callback. Error serialization and response sending are fixed operations; only the after-response hook varies by service.

- Internal services accept `InternalRpcRouter` and have no peer guards or manager dependency. RpcDispatch owns awaited invocation and response construction; no empty shared service superclass is added.

- Each endpoint receiver retains its own immutable service and sender references ([AInternalRpcMethods.ts](./AInternalRpcMethods.ts.md)).
- The default runtime error contract reuses the existing errorWire projection and restoration ([`AInternalRpcService.ts`](../../../../../../../src/rpc/internal/AInternalRpcService.ts#L29)).
- Reply delivery targets the invoking connection once, then runs the domain after-response hook ([`AInternalRpcService.ts`](../../../../../../../src/rpc/internal/AInternalRpcService.ts#L34)).

Endpoint errors call the shared serializer directly. Response-send errors propagate to the transport; the `finally` block still invokes `afterResponse` when sending fails. There are no separate error-preparation or send-failure override hooks.

Error restoration belongs to the internal router. This service serializes endpoint errors and always runs the response-finalization hook after the reply attempt.

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                            |
| ------------ | ----------------------------------------------------------------------------------- |
| Inputs       | Router and RPC invocation with its sender.                                          |
| Outputs      | Endpoint receivers, prepared domain errors and a promised boolean consumed verdict. |
| Owned state  | Router; receiver state is invocation-local.                                         |
| Side effects | Common endpoint invocation, response send and domain-specific post-response hooks.  |

## Linked requirements

| Source file                                                                                 | Specification IDs                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`AInternalRpcService.ts`](../../../../../../../src/rpc/internal/AInternalRpcService.ts#L2) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-2-KBXKTG`](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): Runtime failures use the existing serializable domain error contract
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): Sender-bound receivers preserve reply ownership across concurrent invocations
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): Domain cleanup hooks run after the single response-send attempt

## Assumptions, dependencies, trust boundaries, and limits

Logger upload gossip is fire-and-forget and has no acknowledgement collection policy. Helpers remain on the service, outside the endpoint receiver. The service uses its root’s handler execution context directly around endpoint execution, so errors are stamped before serialization. The service supplies this context to RpcDispatch, which awaits execution and prepares the response. The router awaits runRPC’s consumed verdict. Unreturned failures propagate through the awaited call chain; the transport reports them once to the root.

## Specification adherence

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): Runtime failures use the existing serializable domain error contract See [`AInternalRpcService.ts`](../../../../../../../src/rpc/internal/AInternalRpcService.ts#L29).
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): Sender-bound receivers preserve reply ownership across concurrent invocations See [AInternalRpcMethods.ts](./AInternalRpcMethods.ts.md).
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): Domain cleanup hooks run after the single response-send attempt See [`AInternalRpcService.ts`](../../../../../../../src/rpc/internal/AInternalRpcService.ts#L34).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                          | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Gap / divergence                         |
| ------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** Runtime failures use the existing serializable domain error contract [`AInternalRpcService.ts`](../../../../../../../src/rpc/internal/AInternalRpcService.ts#L29). **Other files:** [RpcDispatch.ts](../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [InternalRpcRouter.ts](../router/InternalRpcRouter.ts.md) (internal ingress and exact-connection response admission), [errorWire.ts](errorWire.ts.md) (runtime error preparation and restoration), [LoggerService.ts](services/logger/LoggerService.ts.md) (store collection, context direction and traversal). | None demonstrated for this contribution. |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** Sender-bound receivers preserve reply ownership across concurrent invocations [AInternalRpcMethods.ts](./AInternalRpcMethods.ts.md). **Other files:** [RpcDispatch.ts](../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [InternalRpcRouter.ts](../router/InternalRpcRouter.ts.md) (internal ingress and exact-connection response admission), [errorWire.ts](errorWire.ts.md) (runtime error preparation and restoration), [LoggerService.ts](services/logger/LoggerService.ts.md) (store collection, context direction and traversal).                               | None demonstrated for this contribution. |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** Domain cleanup hooks run after the single response-send attempt [`AInternalRpcService.ts`](../../../../../../../src/rpc/internal/AInternalRpcService.ts#L34). **Other files:** [RpcDispatch.ts](../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [InternalRpcRouter.ts](../router/InternalRpcRouter.ts.md) (internal ingress and exact-connection response admission), [errorWire.ts](errorWire.ts.md) (runtime error preparation and restoration), [LoggerService.ts](services/logger/LoggerService.ts.md) (store collection, context direction and traversal).      | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID                                                                                      | Obligation                                                  | Public entry and setup                                                                          | Oracle and forbidden effects                                                                         | Required permutations                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-runtime-domain-service-1-ckhc76"></a>`UNIT-TEST-RUNTIME-DOMAIN-SERVICE-1-CKHC76` | Immutable per-invocation sender through awaited forwarding. | Actual SDK-owned roots and connected domain services; narrow controls act on those connections. | Release interleaved calls in reverse order and assert each callback reaches its own caller identity. | <a id="unit-test-runtime-domain-service-1-ckhc76.p1"></a>`UNIT-TEST-RUNTIME-DOMAIN-SERVICE-1-CKHC76.P1`: Retains each invocation sender across interleaved awaits and callbacks. |

## Related source reports

- [RpcDispatch.ts](../RpcDispatch.ts.md)
- [InternalRpcRouter.ts](../router/InternalRpcRouter.ts.md)
- [errorWire.ts](errorWire.ts.md)
- [LoggerService.ts](services/logger/LoggerService.ts.md)
