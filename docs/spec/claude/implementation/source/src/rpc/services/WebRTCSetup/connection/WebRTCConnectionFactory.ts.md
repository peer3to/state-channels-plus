# WebRTCConnectionFactory.ts — Source Report

> **Source:** [src/rpc/services/WebRTCSetup/connection/WebRTCConnectionFactory.ts](../../../../../../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCConnectionFactory.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/webrtc-setup.md](../../../../../../views/architecture/sdk/rpc/webrtc-setup.md), [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

Factory selection: in-context RTC when available, else the worker-bridge singleton (waiting for
its port), else a clear unavailability error.

## Key design decisions

1. **Capability fallback chain with explicit failure** — a runtime with neither RTC nor bridge rejects loudly instead of degrading behavior ([`REQ-RUNTIME-4-B0N70Y`](../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                      |
| ------------ | --------------------------------------------- |
| Inputs       | —                                             |
| Outputs      | A connection factory.                         |
| Owned state  | None (singleton lives in the bridge factory). |
| Side effects | Port wait.                                    |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                                    | Specification IDs                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [WebRTCConnectionFactory.ts](../../../../../../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCConnectionFactory.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y), [`INV-RUNTIME-1-AKRHAK`](../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) |

## Assumptions, dependencies, trust boundaries, and limits

- Both factories expose identical observable behavior ([`INV-RUNTIME-1-AKRHAK`](../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)).

## Specification adherence

- Explicit unsupported-capability rejection ([`REQ-RUNTIME-4-B0N70Y`](../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** the selection chain + explicit rejection. **Other files:** the two factories. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                    | Obligation      | Public entry and setup              | Oracle and forbidden effects                                  | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------- | --------------- | ----------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-webrtc-factory-select-1-36a0wm"></a>`UNIT-TEST-WEBRTC-FACTORY-SELECT-1-36A0WM` | Selection chain | RTC present / bridge-only / neither | Local factory, bridge factory, or explicit error respectively | <a id="unit-test-webrtc-factory-select-1-36a0wm.p1"></a>`UNIT-TEST-WEBRTC-FACTORY-SELECT-1-36A0WM.P1` — in-context; <a id="unit-test-webrtc-factory-select-1-36a0wm.p2"></a>`UNIT-TEST-WEBRTC-FACTORY-SELECT-1-36A0WM.P2` — bridge fallback with port present; <a id="unit-test-webrtc-factory-select-1-36a0wm.p3"></a>`UNIT-TEST-WEBRTC-FACTORY-SELECT-1-36A0WM.P3` — neither rejects; <a id="unit-test-webrtc-factory-select-1-36a0wm.p4"></a>`UNIT-TEST-WEBRTC-FACTORY-SELECT-1-36A0WM.P4` — bridge fallback after port wait |

## Related source reports

- [LocalWebRTCConnectionFactory](./LocalWebRTCConnectionFactory.ts.md), [WorkerBridgeWebRTCConnectionFactory](./WorkerBridgeWebRTCConnectionFactory.ts.md), [WebRTCProvider](./WebRTCProvider.ts.md).
