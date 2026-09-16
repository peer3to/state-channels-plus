# WebRTCWorkerBridgeRoot.ts — Source Report

> **Source:** [src/rpc/internal/roots/WebRTCWorkerBridgeRoot.ts](../../../../../../../../src/rpc/internal/roots/WebRTCWorkerBridgeRoot.ts) > **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Owns the worker-side bridge endpoint and its main-thread broker child.

The parameterless start() contains domain initialization. Common creation supplies parent attachment, parent-close cleanup and readiness; this root does not wire them.

## Key design decisions

The bridge forwards common startup context to base construction, which creates its logger and service automatically. Bridge installation remains outside runtime readiness.

The host creates this root inline. It exposes bridge callbacks and forwards negotiation to its broker child. The service path carries the broker port upward; installation stays outside readiness. Pending negotiation waits for attachment and rejects on disposal.

## Inputs, outputs, state, and side effects

A local connection factory and broker port are required. Native data channels are transferred where supported; otherwise the existing bridge services proxy traffic. The host owns this root, and this root owns broker disposal.

## Linked requirements

| Source file                                                                                           | Specification IDs                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [WebRTCWorkerBridgeRoot.ts](../../../../../../../../src/rpc/internal/roots/WebRTCWorkerBridgeRoot.ts) | [`REQ-RUNTIME-2-KBXKTG`](../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

A local connection factory and broker port are required. Native data channels are transferred where supported; otherwise the existing bridge services proxy traffic. The host owns this root, and this root owns broker disposal.

## Specification adherence

The root owns broker attachment and disposal. Its negotiation service awaits the broker handle; callback state and channel delivery stay with the supplied connection factory. Shared creation and lifecycle services provide connection registration, readiness and response settlement.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                        | Gap / divergence                         |
| --------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** [WebRTCWorkerBridgeRoot.ts](../../../../../../../../src/rpc/internal/roots/WebRTCWorkerBridgeRoot.ts#L40) owns the worker-side bridge endpoint and its main-thread broker child. **Other files:** [WebRTCMainThreadBridge.ts](WebRTCMainThreadBridge.ts.md); [WorkerBridgeWebRTCConnectionFactory.ts](../../network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts.md); [createRoot.ts](../createRoot.ts.md). | None demonstrated for this contribution. |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** [WebRTCWorkerBridgeRoot.ts](../../../../../../../../src/rpc/internal/roots/WebRTCWorkerBridgeRoot.ts#L40) owns the worker-side bridge endpoint and its main-thread broker child. **Other files:** [WebRTCMainThreadBridge.ts](WebRTCMainThreadBridge.ts.md); [WorkerBridgeWebRTCConnectionFactory.ts](../../network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts.md); [createRoot.ts](../createRoot.ts.md). | None demonstrated for this contribution. |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** [WebRTCWorkerBridgeRoot.ts](../../../../../../../../src/rpc/internal/roots/WebRTCWorkerBridgeRoot.ts#L40) owns the worker-side bridge endpoint and its main-thread broker child. **Other files:** [WebRTCMainThreadBridge.ts](WebRTCMainThreadBridge.ts.md); [WorkerBridgeWebRTCConnectionFactory.ts](../../network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts.md); [createRoot.ts](../createRoot.ts.md). | None demonstrated for this contribution. |

## Component test obligations

| Unit test ID                                                                | Obligation                                    | Public entry and setup                             | Oracle and forbidden effects                                                                | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-bridge-root-1-k5xx3y"></a>`UNIT-TEST-BRIDGE-ROOT-1-K5XX3Y` | Forwarded broker attachment outside readiness | Real production roots and their public operations. | Forwarded broker attachment outside readiness; no duplicate completion or leaked ownership. | <a id="unit-test-bridge-root-1-k5xx3y.p1"></a>`UNIT-TEST-BRIDGE-ROOT-1-K5XX3Y.P1` — Bridge forwarding becomes ready without a broker; queued negotiation resumes after actual broker attachment, and disposal reaches that child.; <a id="unit-test-bridge-root-1-k5xx3y.p2"></a>`UNIT-TEST-BRIDGE-ROOT-1-K5XX3Y.P2` — Disposal before broker attachment closes the waiting child and rejects queued negotiation without another failure report; host remains usable. |

## Related source reports

[WebRTCMainThreadBridge.ts](WebRTCMainThreadBridge.ts.md); [WorkerBridgeWebRTCConnectionFactory.ts](../../network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts.md); [createRoot.ts](../createRoot.ts.md).
