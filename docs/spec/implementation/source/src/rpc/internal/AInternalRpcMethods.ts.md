# AInternalRpcMethods.ts — Source Report

> **Source:** [src/rpc/internal/AInternalRpcMethods.ts](../../../../../../../src/rpc/internal/AInternalRpcMethods.ts) > **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Binds an internal endpoint receiver to its concrete service and sending transport.

## Key design decisions

- Service and sender references are readonly and belong to one invocation. The class contains no endpoints or helpers.

## Inputs, outputs, state, and side effects

Constructor inputs are the service and InternalTransport. The receiver stores those references and performs no I/O.

## Linked requirements

| Source file                                                                            | Specification IDs                                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [AInternalRpcMethods.ts](../../../../../../../src/rpc/internal/AInternalRpcMethods.ts) | [`REQ-RUNTIME-2-KBXKTG`](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

The receiver retains the sender used by its service for replies and callbacks.

## Assumptions, dependencies, trust boundaries, and limits

AInternalRpcService constructs receivers per invocation. This class does not authenticate senders or dispatch methods.

## Specification adherence

Readonly references keep service and sender ownership explicit.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                          | Implementation status | Evidence                                                                                                                                                                | Gap / divergence   |
| ------------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** readonly service and sender references. **Other files:** [AInternalRpcService](./AInternalRpcService.ts.md) creates each receiver and owns response delivery. | None demonstrated. |

## Component test obligations

The existing [sender-isolation obligation](./AInternalRpcService.ts.md#unit-test-runtime-domain-service-1-ckhc76.p1) covers this receiver through actual service dispatch; its definition remains with that service.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [AInternalRpcService](./AInternalRpcService.ts.md)
