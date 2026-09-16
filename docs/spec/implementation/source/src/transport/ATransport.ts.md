# ATransport.ts — Source Report

> **Source:** [src/transport/ATransport.ts](../../../../../../src/transport/ATransport.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Defines the neutral send, response, ingress and close contract for network and internal transports. It owns close-once state and close subscriptions, and requires a typed router from each concrete subclass. It has no peer address, network enum, profile registration or peer-manager accessor.

## Key design decisions

- `onMessage` is abstract. Concrete transport constructors require their category router. Network transports convert host input before calling `onRpc`; InternalTransport forwards objects to InternalRpcRouter, which filters closed senders.

- Close marks the transport before notifying a snapshot of listeners and then invokes category cleanup ([`ATransport.ts`](../../../../../../src/transport/ATransport.ts#L23)).
- Late close subscribers run immediately; live subscriptions have an explicit remover ([`ATransport.ts`](../../../../../../src/transport/ATransport.ts#L32)).
- Structural recognition checks delivery and close methods without authenticating any sender ([`ATransport.ts`](../../../../../../src/transport/ATransport.ts#L46)).

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                            |
| ------------ | ----------------------------------------------------------------------------------- |
| Inputs       | A neutral router, close classification and close listeners.                         |
| Outputs      | An abstract delivery surface, subscription removers and structural recognition.     |
| Owned state  | Closed flag and close listener set; concrete subclasses own their router reference. |
| Side effects | Runs category close hooks and subscribed listeners once.                            |

## Linked requirements

| Source file                                                         | Specification IDs                                                                                                                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ATransport.ts`](../../../../../../src/transport/ATransport.ts#L1) | [`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): Close subscriptions and category cleanup share one close-once boundary
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y): Compatible values are recognized by their neutral public methods across module graphs

## Assumptions, dependencies, trust boundaries, and limits

Concrete categories own serialization and domain policy. A neutral shape check does not establish a network recipient or peer identity. Network policy belongs to NetworkTransport; InternalTransport owns port listener removal and exact-connection pending rejection.

## Specification adherence

- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): Close subscriptions and category cleanup share one close-once boundary See [`ATransport.ts`](../../../../../../src/transport/ATransport.ts#L23).
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y): Compatible values are recognized by their neutral public methods across module graphs See [`ATransport.ts`](../../../../../../src/transport/ATransport.ts#L46).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Gap / divergence                         |
| --------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** Close subscriptions and category cleanup share one close-once boundary [`ATransport.ts`](../../../../../../src/transport/ATransport.ts#L23). **Other files:** [NetworkTransport.ts](NetworkTransport.ts.md) (peer identity, JSON wire delivery and network close policy), [InternalTransport.ts](InternalTransport.ts.md) (structured-clone delivery and port listener cleanup), [ARpcRouter.ts](../rpc/router/ARpcRouter.ts.md) (request registration, timers, correlation and settlement-once).                | None demonstrated for this contribution. |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** Compatible values are recognized by their neutral public methods across module graphs [`ATransport.ts`](../../../../../../src/transport/ATransport.ts#L46). **Other files:** [NetworkTransport.ts](NetworkTransport.ts.md) (peer identity, JSON wire delivery and network close policy), [InternalTransport.ts](InternalTransport.ts.md) (structured-clone delivery and port listener cleanup), [ARpcRouter.ts](../rpc/router/ARpcRouter.ts.md) (request registration, timers, correlation and settlement-once). | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID                                                                              | Obligation                             | Public entry and setup                                                                          | Oracle and forbidden effects                                                                                       | Required permutations                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-atransport-neutral-1-m1ef2b"></a>`UNIT-TEST-ATRANSPORT-NEUTRAL-1-M1EF2B` | Neutral transport structural boundary. | Actual SDK-owned roots and connected domain services; narrow controls act on those connections. | A real internal transport is recognized as neutral but has no peer-address, network type or peer manager metadata. | <a id="unit-test-atransport-neutral-1-m1ef2b.p1"></a>`UNIT-TEST-ATRANSPORT-NEUTRAL-1-M1EF2B.P1`: Has a neutral transport surface without network identity metadata. |

## Related source reports

- [NetworkTransport.ts](NetworkTransport.ts.md)
- [InternalTransport.ts](InternalTransport.ts.md)
- [ARpcRouter.ts](../rpc/router/ARpcRouter.ts.md)
