# InternalTransport.ts — Source Report

> **Source:** [src/transport/InternalTransport.ts](../../../../../../src/transport/InternalTransport.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Owns a runtime port and delivers the common logical RPC envelope by structured clone. Both inline and worker placement use this transport. It has no peer/profile policy and no network transport enum.

Closing rejects pending requests with the stored close reason directly; no failure-kind tagging is added.

## Key design decisions

- The port callback starts asynchronous router ingress without waiting for other messages. Uncaught dispatch failures reach the owning root’s `reportError` once; request endpoint failures have already become error responses in the shared router.

- `InternalTransport.onMessage` forwards port input to its typed router. The runtime router ignores closed senders. Structured clone and explicit transfer lists retain live MessagePorts and WebRTC channels that JSON cannot preserve.

- Listeners are installed before starting the port ([`InternalTransport.ts`](../../../../../../src/transport/InternalTransport.ts#L13)).
- Send posts synchronously and passes its explicit transfer list once ([`InternalTransport.ts`](../../../../../../src/transport/InternalTransport.ts#L25)).
- Close removes listeners, rejects only requests owned by this connection and closes its port ([`InternalTransport.ts`](../../../../../../src/transport/InternalTransport.ts#L42)).

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| Inputs       | A runtime router, adapted port, logical RPC envelopes, explicit transfer lists and an optional close reason.  |
| Outputs      | Synchronous sends and router ingress; closed calls fail with the owner-selected reason.                       |
| Owned state  | Port, close reason and listener removal functions, plus inherited close-once state.                           |
| Side effects | Structured cloning and transfer, listener installation/removal, exact-owner request rejection and port close. |

## Linked requirements

| Source file                                                                       | Specification IDs                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`InternalTransport.ts`](../../../../../../src/transport/InternalTransport.ts#L1) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-2-KBXKTG`](../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The same logical envelope crosses a structured-clone boundary in both placements
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): Ingress carries this exact connection identity into shared routing
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): Closing rejects this transport's pending work and removes both listeners
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y): Raw Node/browser port adaptation remains outside logical delivery

## Assumptions, dependencies, trust boundaries, and limits

A closed far-end MessagePort may silently discard a post; tests of synchronous post failure use an uncloneable value or invalid transfer list. Browser close events are not guaranteed, so the owning root explicitly closes its connections. Internal transport shapes are rejected by network recipient selection.

## Specification adherence

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The same logical envelope crosses a structured-clone boundary in both placements See [`InternalTransport.ts`](../../../../../../src/transport/InternalTransport.ts#L25).
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): Ingress carries this exact connection identity into shared routing See [`InternalTransport.ts`](../../../../../../src/transport/InternalTransport.ts#L40).
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): Closing rejects this transport's pending work and removes both listeners See [`InternalTransport.ts`](../../../../../../src/transport/InternalTransport.ts#L42).
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y): Raw Node/browser port adaptation remains outside logical delivery See [`InternalTransport.ts`](../../../../../../src/transport/InternalTransport.ts#L13).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Gap / divergence                         |
| --------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** The same logical envelope crosses a structured-clone boundary in both placements [`InternalTransport.ts`](../../../../../../src/transport/InternalTransport.ts#L25). **Other files:** [ATransport.ts](ATransport.ts.md) (neutral send and close-once surface), [RuntimePort.ts](RuntimePort.ts.md) (neutral raw-port and transfer contracts), [InternalRpcRouter.ts](../rpc/router/InternalRpcRouter.ts.md) (internal ingress and exact-connection response admission), [ARpcRouter.ts](../rpc/router/ARpcRouter.ts.md) (request registration, timers, correlation and settlement-once), [AInternalRpcRoot.ts](../rpc/internal/AInternalRpcRoot.ts.md) (endpoint connection lifetime, logger composition and local root registry). | None demonstrated for this contribution. |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** Ingress carries this exact connection identity into shared routing [`InternalTransport.ts`](../../../../../../src/transport/InternalTransport.ts#L40). **Other files:** [ATransport.ts](ATransport.ts.md) (neutral send and close-once surface), [RuntimePort.ts](RuntimePort.ts.md) (neutral raw-port and transfer contracts), [InternalRpcRouter.ts](../rpc/router/InternalRpcRouter.ts.md) (internal ingress and exact-connection response admission), [ARpcRouter.ts](../rpc/router/ARpcRouter.ts.md) (request registration, timers, correlation and settlement-once), [AInternalRpcRoot.ts](../rpc/internal/AInternalRpcRoot.ts.md) (endpoint connection lifetime, logger composition and local root registry).               | None demonstrated for this contribution. |
| [`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** Closing rejects this transport's pending work and removes both listeners [`InternalTransport.ts`](../../../../../../src/transport/InternalTransport.ts#L42). **Other files:** [ATransport.ts](ATransport.ts.md) (neutral send and close-once surface), [RuntimePort.ts](RuntimePort.ts.md) (neutral raw-port and transfer contracts), [InternalRpcRouter.ts](../rpc/router/InternalRpcRouter.ts.md) (internal ingress and exact-connection response admission), [ARpcRouter.ts](../rpc/router/ARpcRouter.ts.md) (request registration, timers, correlation and settlement-once), [AInternalRpcRoot.ts](../rpc/internal/AInternalRpcRoot.ts.md) (endpoint connection lifetime, logger composition and local root registry).         | None demonstrated for this contribution. |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** Raw Node/browser port adaptation remains outside logical delivery [`InternalTransport.ts`](../../../../../../src/transport/InternalTransport.ts#L13). **Other files:** [ATransport.ts](ATransport.ts.md) (neutral send and close-once surface), [RuntimePort.ts](RuntimePort.ts.md) (neutral raw-port and transfer contracts), [InternalRpcRouter.ts](../rpc/router/InternalRpcRouter.ts.md) (internal ingress and exact-connection response admission), [ARpcRouter.ts](../rpc/router/ARpcRouter.ts.md) (request registration, timers, correlation and settlement-once), [AInternalRpcRoot.ts](../rpc/internal/AInternalRpcRoot.ts.md) (endpoint connection lifetime, logger composition and local root registry).                | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID                                                                              | Obligation                                                                      | Public entry and setup                                                                          | Oracle and forbidden effects                                                                                                                                                      | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-internal-transport-1-3g1yg2"></a>`UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2` | Internal connection exclusion from network delivery and owned close settlement. | Actual SDK-owned roots and connected domain services; narrow controls act on those connections. | Untyped network selection throws without sending or falling back to self. Repeated close emits once, rejects its held call once and clears timers while a sibling remains usable. | <a id="unit-test-internal-transport-1-3g1yg2.p1"></a>`UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P1`: Rejects an internal transport passed to an untyped network request.<br><a id="unit-test-internal-transport-1-3g1yg2.p2"></a>`UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P2`: Rejects an internal transport passed to an untyped network send.<br><a id="unit-test-internal-transport-1-3g1yg2.p3"></a>`UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P3`: Rejects an internal transport passed to an untyped network recipient list.<br><a id="unit-test-internal-transport-1-3g1yg2.p4"></a>`UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P4`: Closes once and rejects only calls owned by that connection.; <a id="unit-test-internal-transport-1-3g1yg2.p5"></a>`UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P5` — Sending after close rejects.; <a id="unit-test-internal-transport-1-3g1yg2.p6"></a>`UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P6` — A supplied close reason reaches the pending caller unchanged.; <a id="unit-test-internal-transport-1-3g1yg2.p7"></a>`UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P7` — Both real port subscriptions are removed once. |

## Related source reports

- [ATransport.ts](ATransport.ts.md)
- [RuntimePort.ts](RuntimePort.ts.md)
- [InternalRpcRouter.ts](../rpc/router/InternalRpcRouter.ts.md)
- [ARpcRouter.ts](../rpc/router/ARpcRouter.ts.md)
- [AInternalRpcRoot.ts](../rpc/internal/AInternalRpcRoot.ts.md)
