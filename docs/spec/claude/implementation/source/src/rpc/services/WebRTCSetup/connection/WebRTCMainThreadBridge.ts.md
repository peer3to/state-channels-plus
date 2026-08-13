# WebRTCMainThreadBridge.ts — Source Report

> **Source:** [src/rpc/services/WebRTCSetup/connection/WebRTCMainThreadBridge.ts](../../../../../../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCMainThreadBridge.ts) > **Status:** Authored — engineer verification pending.
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

The main-thread half of the bridged deployment: `installWebRTCMainThreadBridge` owns real RTC
connections where the platform has them, serves the worker's bridge requests over a paired port,
and ships established data channels back — transferring the channel when the platform allows
(`transfer`) or proxying frames over the port (`proxy`, `auto` picks).

## Key design decisions

1. **Channel-mode negotiation (`auto`/`transfer`/`proxy`).** Transferable channels move wholesale; otherwise a frame proxy preserves identical observable behavior at higher cost — equivalence over mechanism ([`INV-RUNTIME-1`](../../../../../../../specification/runtime/execution.md#inv-runtime-1)).
2. **The bridge is an installable handle** with explicit uninstall, keeping lifecycle convergence testable ([`REQ-RUNTIME-3`](../../../../../../../specification/runtime/execution.md#req-runtime-3)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                        |
| ------------ | --------------------------------------------------------------- |
| Inputs       | Bridge requests from the worker port.                           |
| Outputs      | SDP/ICE results; channel ports/proxied frames; state snapshots. |
| Owned state  | Per-address connections + handle registry.                      |
| Side effects | RTC resources on the main thread.                               |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                                  | Specification IDs                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [WebRTCMainThreadBridge.ts](../../../../../../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCMainThreadBridge.ts) | [`INV-RUNTIME-1`](../../../../../../../specification/runtime/execution.md#inv-runtime-1), [`REQ-RUNTIME-2`](../../../../../../../specification/runtime/execution.md#req-runtime-2), [`REQ-RUNTIME-3`](../../../../../../../specification/runtime/execution.md#req-runtime-3) |

## Assumptions, dependencies, trust boundaries, and limits

- One context owns each connection ([`REQ-RUNTIME-2`](../../../../../../../specification/runtime/execution.md#req-runtime-2)); the worker side never touches RTC directly.

## Specification adherence

- Ownership confinement and ordered request handling per the runtime rules.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                  | Implementation status | Evidence                                                                                                                                                                                    | Gap / divergence |
| ---------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RUNTIME-1`](../../../../../../../specification/runtime/execution.md#inv-runtime-1) | Covered               | **Here:** transfer vs proxy modes with identical observable channel behavior. **Other files:** [WorkerBridgeWebRTCConnectionFactory](./WorkerBridgeWebRTCConnectionFactory.ts.md) consumes. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                | Obligation          | Public entry and setup                                                                 | Oracle and forbidden effects                                                                             | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-webrtc-main-bridge-1"></a>`UNIT-TEST-WEBRTC-MAIN-BRIDGE-1` | Bridged equivalence | Drive offer/answer/ICE/close over the port in both channel modes; uninstall mid-flight | Both modes yield equivalent channel behavior; requests settle exactly once; uninstall releases resources | <a id="unit-test-webrtc-main-bridge-1.p1"></a>`UNIT-TEST-WEBRTC-MAIN-BRIDGE-1.P1` — transfer mode; <a id="unit-test-webrtc-main-bridge-1.p2"></a>`UNIT-TEST-WEBRTC-MAIN-BRIDGE-1.P2` — proxy mode equivalence; <a id="unit-test-webrtc-main-bridge-1.p3"></a>`UNIT-TEST-WEBRTC-MAIN-BRIDGE-1.P3` — close/uninstall convergence; <a id="unit-test-webrtc-main-bridge-1.p4"></a>`UNIT-TEST-WEBRTC-MAIN-BRIDGE-1.P4` — error propagation via protocol |

## Related source reports

- [WebRTCBridgeProtocol](./WebRTCBridgeProtocol.ts.md), [WorkerBridgeWebRTCConnectionFactory](./WorkerBridgeWebRTCConnectionFactory.ts.md).
