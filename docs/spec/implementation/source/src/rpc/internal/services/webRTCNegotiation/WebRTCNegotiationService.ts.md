# WebRTCNegotiationService.ts — Source Report

> **Source:** [src/rpc/internal/services/webRTCNegotiation/WebRTCNegotiationService.ts](../../../../../../../../../src/rpc/internal/services/webRTCNegotiation/WebRTCNegotiationService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Binds negotiation endpoints to the main-thread bridge broker and uses the shared internal error projection. The broker delegates peer connection setup to LocalWebRTCConnectionFactory and owns channel forwarding. The main-thread installer separately tracks handles for each broker port.

## Key design decisions

- The inherited internal service boundary serializes errors through the common error codec.

- Each invocation constructs endpoint methods bound to its sender ([`WebRTCNegotiationService.ts`](../../../../../../../../../src/rpc/internal/services/webRTCNegotiation/WebRTCNegotiationService.ts#L11)).
- Errors use the shared internal error projection, as do callback failures ([`WebRTCNegotiationService.ts`](../../../../../../../../../src/rpc/internal/services/webRTCNegotiation/WebRTCNegotiationService.ts#L14)).

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                        |
| ------------ | --------------------------------------------------------------- |
| Inputs       | The existing broker and invoking internal connection.           |
| Outputs      | Negotiation endpoint receivers and serialized bridge errors.    |
| Owned state  | Broker reference only.                                          |
| Side effects | Delegates endpoint execution and detached errors to the broker. |

## Linked requirements

| Source file                                                                                                                            | Specification IDs                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`WebRTCNegotiationService.ts`](../../../../../../../../../src/rpc/internal/services/webRTCNegotiation/WebRTCNegotiationService.ts#L1) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-4-B0N70Y`](../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): Negotiation errors retain the bridge-specific serializable fields
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The broker remains the canonical connection-state owner
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y): The service stays independent of native transfer capability and delegates it to the broker

## Assumptions, dependencies, trust boundaries, and limits

This service does not create a root for each port hold. The broker owns first-port sharing and final-owner cleanup; shared routing owns deadlines and pending calls. Native transfer failure, auto fallback and proxy behavior are unchanged.

## Specification adherence

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): Negotiation errors retain the bridge-specific serializable fields See [`WebRTCNegotiationService.ts`](../../../../../../../../../src/rpc/internal/services/webRTCNegotiation/WebRTCNegotiationService.ts#L14).
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The broker remains the canonical connection-state owner See [`WebRTCNegotiationService.ts`](../../../../../../../../../src/rpc/internal/services/webRTCNegotiation/WebRTCNegotiationService.ts#L8).
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y): The service stays independent of native transfer capability and delegates it to the broker See [`WebRTCNegotiationService.ts`](../../../../../../../../../src/rpc/internal/services/webRTCNegotiation/WebRTCNegotiationService.ts#L8).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Gap / divergence                         |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** Negotiation errors retain the bridge-specific serializable fields [`WebRTCNegotiationService.ts`](../../../../../../../../../src/rpc/internal/services/webRTCNegotiation/WebRTCNegotiationService.ts#L14). **Other files:** [WebRTCNegotiationRpcMethods.ts](WebRTCNegotiationRpcMethods.ts.md) (typed negotiation and proxy endpoints), [WebRTCMainThreadBridge.ts](../../roots/WebRTCMainThreadBridge.ts.md) (broker connection maps, transfer detection and refcounts), [errorWire.ts](../../errorWire.ts.md) (three-field WebRTC error projection), [ARpcRouter.ts](../../../router/ARpcRouter.ts.md) (request registration, timers, correlation and settlement-once).                         | None demonstrated for this contribution. |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** The broker remains the canonical connection-state owner [`WebRTCNegotiationService.ts`](../../../../../../../../../src/rpc/internal/services/webRTCNegotiation/WebRTCNegotiationService.ts#L8). **Other files:** [WebRTCNegotiationRpcMethods.ts](WebRTCNegotiationRpcMethods.ts.md) (typed negotiation and proxy endpoints), [WebRTCMainThreadBridge.ts](../../roots/WebRTCMainThreadBridge.ts.md) (broker connection maps, transfer detection and refcounts), [errorWire.ts](../../errorWire.ts.md) (three-field WebRTC error projection), [ARpcRouter.ts](../../../router/ARpcRouter.ts.md) (request registration, timers, correlation and settlement-once).                                    | None demonstrated for this contribution. |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** The service stays independent of native transfer capability and delegates it to the broker [`WebRTCNegotiationService.ts`](../../../../../../../../../src/rpc/internal/services/webRTCNegotiation/WebRTCNegotiationService.ts#L8). **Other files:** [WebRTCNegotiationRpcMethods.ts](WebRTCNegotiationRpcMethods.ts.md) (typed negotiation and proxy endpoints), [WebRTCMainThreadBridge.ts](../../roots/WebRTCMainThreadBridge.ts.md) (broker connection maps, transfer detection and refcounts), [errorWire.ts](../../errorWire.ts.md) (three-field WebRTC error projection), [ARpcRouter.ts](../../../router/ARpcRouter.ts.md) (request registration, timers, correlation and settlement-once). | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [WebRTCNegotiationRpcMethods.ts](WebRTCNegotiationRpcMethods.ts.md)
- [WebRTCMainThreadBridge.ts](../../roots/WebRTCMainThreadBridge.ts.md)
- [errorWire.ts](../../errorWire.ts.md)
- [ARpcRouter.ts](../../../router/ARpcRouter.ts.md)
