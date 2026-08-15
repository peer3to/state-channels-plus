# WorkerBridgeWebRTCConnectionFactory.ts — Source Report

> **Source:** [src/rpc/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts](../../../../../../../../../src/rpc/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md), [architecture/sdk/rpc/webrtc-setup.md](../../../../../../views/architecture/sdk/rpc/webrtc-setup.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

The worker-side factory singleton: waits for the bridge port, forwards factory calls as bridge
requests, correlates responses, and reconstitutes returned channels (transferred port or frame
proxy) as `WebRTCDataChannelLike` — the same interface the local factory serves.

## Key design decisions

1. **Singleton with port hand-off** because the worker has exactly one bridge; `hasPort`/`waitForPort` make availability explicit for the selector.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                            |
| ------------ | --------------------------------------------------- |
| Inputs       | Factory calls; bridge port messages.                |
| Outputs      | Bridge requests; channel-like objects.              |
| Owned state  | Port, pending correlation, per-address bookkeeping. |
| Side effects | Port traffic only.                                  |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                                                         | Specification IDs                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [WorkerBridgeWebRTCConnectionFactory.ts](../../../../../../../../../src/rpc/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

## Assumptions, dependencies, trust boundaries, and limits

- Request/response correlation on the port settles exactly once per request ([`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)).

## Specification adherence

- Interface-equivalent behavior to the local factory ([`INV-RUNTIME-1-AKRHAK`](../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                        | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** interface parity + channel reconstitution. **Other files:** [WebRTCMainThreadBridge](./WebRTCMainThreadBridge.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                    | Obligation                | Public entry and setup                                             | Oracle and forbidden effects                                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-worker-bridge-factory-1-c3nbb8"></a>`UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8` | Port lifecycle and parity | Calls before/after port arrival; both channel modes; bridge errors | Pre-port waits resolve on arrival; behavior matches the local factory; errors deserialize | <a id="unit-test-worker-bridge-factory-1-c3nbb8.p1"></a>`UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P1` — waitForPort resolution; <a id="unit-test-worker-bridge-factory-1-c3nbb8.p2"></a>`UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P2` — createOffer parity; <a id="unit-test-worker-bridge-factory-1-c3nbb8.p3"></a>`UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P3` — bridge error propagation; <a id="unit-test-worker-bridge-factory-1-c3nbb8.p4"></a>`UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P4` — port loss behavior; <a id="unit-test-worker-bridge-factory-1-c3nbb8.p5"></a>`UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P5` — acceptOffer parity; <a id="unit-test-worker-bridge-factory-1-c3nbb8.p6"></a>`UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P6` — addIceCandidate parity; <a id="unit-test-worker-bridge-factory-1-c3nbb8.p7"></a>`UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P7` — close parity |

## Related source reports

- [WebRTCMainThreadBridge](./WebRTCMainThreadBridge.ts.md), [WebRTCConnectionFactory](./WebRTCConnectionFactory.ts.md).
