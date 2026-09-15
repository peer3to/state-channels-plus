# WebRTCBridgeService.ts — Source Report

> **Source:** [src/rpc/internal/services/webRTCBridge/WebRTCBridgeService.ts](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Constructs sender-bound WebRTC callback endpoints and keeps callback failures within the bridge error contract. The existing worker bridge client owns callback registrations and channel state; this service adds no second map or pending registry.

## Key design decisions

- The inherited internal service boundary serializes endpoint errors with the common error codec.

- Each dispatch constructs endpoint methods with the invoking transport ([`WebRTCBridgeService.ts`](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeService.ts#L11)).
- Bridge failures use the existing three-field projection rather than runtime contract error metadata ([`WebRTCBridgeService.ts`](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeService.ts#L14)).

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                        |
| ------------ | ------------------------------------------------------------------------------- |
| Inputs       | The owning bridge client and invoking internal transport.                       |
| Outputs      | Typed callback methods and serializable bridge error data.                      |
| Owned state  | A reference to the existing client; no independent connection or pending state. |
| Side effects | Delegates detached callback errors to the client reporting policy.              |

## Linked requirements

| Source file                                                                                                             | Specification IDs                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`WebRTCBridgeService.ts`](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeService.ts#L1) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-4-B0N70Y`](../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): Callback failures use the bridge-specific serializable projection
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y): The callback service is platform-neutral and delegates host API details to the connection owner

## Assumptions, dependencies, trust boundaries, and limits

The internal connection is already bound to its concrete remote endpoint. Service recognition does not authenticate network peers. Native channel transfer and proxy callbacks stay with the broker/client; error preparation preserves only name, message and stack. Unknown frames are rejected or ignored by common ingress before endpoint dispatch.

## Specification adherence

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): Callback failures use the bridge-specific serializable projection See [`WebRTCBridgeService.ts`](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeService.ts#L14).
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y): The callback service is platform-neutral and delegates host API details to the connection owner See [`WebRTCBridgeService.ts`](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeService.ts#L7).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Gap / divergence                         |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** Callback failures use the bridge-specific serializable projection [`WebRTCBridgeService.ts`](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeService.ts#L14). **Other files:** [WebRTCBridgeRpcMethods.ts](WebRTCBridgeRpcMethods.ts.md) (typed channel, state, ICE and data callbacks), [errorWire.ts](../../errorWire.ts.md) (three-field WebRTC error projection), [WorkerBridgeWebRTCConnectionFactory.ts](../../../network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts.md) (worker callback/channel maps and bridge holds), [InternalRpcRouter.ts](../../../router/InternalRpcRouter.ts.md) (internal ingress and exact-connection response admission).                              | None demonstrated for this contribution. |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** The callback service is platform-neutral and delegates host API details to the connection owner [`WebRTCBridgeService.ts`](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeService.ts#L7). **Other files:** [WebRTCBridgeRpcMethods.ts](WebRTCBridgeRpcMethods.ts.md) (typed channel, state, ICE and data callbacks), [errorWire.ts](../../errorWire.ts.md) (three-field WebRTC error projection), [WorkerBridgeWebRTCConnectionFactory.ts](../../../network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts.md) (worker callback/channel maps and bridge holds), [InternalRpcRouter.ts](../../../router/InternalRpcRouter.ts.md) (internal ingress and exact-connection response admission). | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID                                                                                      | Obligation       | Public entry and setup              | Oracle and forbidden effects                     | Required permutations                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-webrtc-bridge-protocol-1-vf15nx"></a>`UNIT-TEST-WEBRTC-BRIDGE-PROTOCOL-1-VF15NX` | Error round trip | Serialize/deserialize varied errors | Message/name preserved; non-Error inputs handled | <a id="unit-test-webrtc-bridge-protocol-1-vf15nx.p1"></a>`UNIT-TEST-WEBRTC-BRIDGE-PROTOCOL-1-VF15NX.P1` — Error round trip; <a id="unit-test-webrtc-bridge-protocol-1-vf15nx.p2"></a>`UNIT-TEST-WEBRTC-BRIDGE-PROTOCOL-1-VF15NX.P2` — non-Error input; <a id="unit-test-webrtc-bridge-protocol-1-vf15nx.p3"></a>`UNIT-TEST-WEBRTC-BRIDGE-PROTOCOL-1-VF15NX.P3` — unknown message ignored by consumers |

## Related source reports

- [WebRTCBridgeRpcMethods.ts](WebRTCBridgeRpcMethods.ts.md)
- [errorWire.ts](../../errorWire.ts.md)
- [WorkerBridgeWebRTCConnectionFactory.ts](../../../network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts.md)
- [InternalRpcRouter.ts](../../../router/InternalRpcRouter.ts.md)
