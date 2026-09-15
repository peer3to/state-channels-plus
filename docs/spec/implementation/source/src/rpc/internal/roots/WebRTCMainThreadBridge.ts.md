# WebRTCMainThreadBridge.ts — Source Report

> **Source:** [src/rpc/internal/roots/WebRTCMainThreadBridge.ts](../../../../../../../../src/rpc/internal/roots/WebRTCMainThreadBridge.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md), [architecture/sdk/rpc/webrtc-setup.md](../../../../../views/architecture/sdk/rpc/webrtc-setup.md)

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

The parameterless start() contains domain initialization. Common creation supplies parent attachment, parent-close cleanup and readiness; this root does not wire them.

## Responsibility and observable boundary

The domain start initializes the provider after common creation attaches a parent when supplied. Domain callbacks require a configured recipient; standalone construction never invents a parent.

## Key design decisions

The installer passes its supplied owned logger through the common createRoot option. The concrete constructor delegates context to the base; broker diagnostics use rootLogger. Existing per-port broker ownership is unchanged.

The main-thread broker remains a concrete root. Installation receives the port forwarded through the SDK service and uses common createRoot with parentPort; its logical parent is the worker-side bridge root. Provider initialization belongs to its start operation. Host readiness does not wait for this external installation.

The broker composes LocalWebRTCConnectionFactory, which owns native peer connections and the shared offer/answer/ICE setup path. The broker supplies callbacks that forward state and channel ownership over its root connection. Supported data channels transfer down to the requesting worker; otherwise the broker proxies traffic and channel state through bridge services. Per-port installer handles share one broker; disposing the last handle closes it. Recursive parent disposal also closes native resources before acknowledging cleanup. Startup failures are reported over the parent connection and logged locally when a logger is available.

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

| Source file                                                                                           | Specification IDs                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [WebRTCMainThreadBridge.ts](../../../../../../../../src/rpc/internal/roots/WebRTCMainThreadBridge.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-2-KBXKTG`](../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

## Assumptions, dependencies, trust boundaries, and limits

- One context owns each connection ([`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)); the worker side never touches RTC directly.

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

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                                                                                                                | Gap / divergence |
| --------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** transfer vs proxy modes with identical observable channel behavior. **Other files:** [WorkerBridgeWebRTCConnectionFactory](../../network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts.md) consumes. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                              | Obligation          | Public entry and setup                                                                 | Oracle and forbidden effects                                                                             | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-webrtc-main-bridge-1-7gxpta"></a>`UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA` | Bridged equivalence | Drive offer/answer/ICE/close over the port in both channel modes; uninstall mid-flight | Both modes yield equivalent channel behavior; requests settle exactly once; uninstall releases resources | <a id="unit-test-webrtc-main-bridge-1-7gxpta.p1"></a>`UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA.P1` — transfer mode; <a id="unit-test-webrtc-main-bridge-1-7gxpta.p2"></a>`UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA.P2` — proxy mode equivalence; <a id="unit-test-webrtc-main-bridge-1-7gxpta.p3"></a>`UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA.P3` — close convergence; <a id="unit-test-webrtc-main-bridge-1-7gxpta.p4"></a>`UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA.P4` — error propagation via protocol; <a id="unit-test-webrtc-main-bridge-1-7gxpta.p5"></a>`UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA.P5` — uninstall mid-flight |

## Related source reports

- [WebRTCBridgeService](../services/webRTCBridge/WebRTCBridgeService.ts.md), [WorkerBridgeWebRTCConnectionFactory](../../network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts.md).
