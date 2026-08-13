# WebRTCBridgeProtocol.ts — Source Report

> **Source:** [src/rpc/services/WebRTCSetup/connection/WebRTCBridgeProtocol.ts](../../../../../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCBridgeProtocol.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

The bridge wire protocol: namespaced request/port message types for offer/answer/ICE/close/state
across the worker↔main-thread port, plus error (de)serialization preserving message/name/stack.

## Key design decisions

1. **Errors cross as data.** Serialized error shapes reconstruct on the far side — failures keep their meaning across the boundary ([`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents              |
| ------------ | --------------------- |
| Inputs       | —                     |
| Outputs      | Types + error codecs. |
| Owned state  | None.                 |
| Side effects | None.                 |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                           | Specification IDs                                                                                      |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [WebRTCBridgeProtocol.ts](../../../../../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCBridgeProtocol.ts) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) |

## Assumptions, dependencies, trust boundaries, and limits

- Both bridge ends speak exactly this namespace; unknown messages are ignored by receivers.

## Specification adherence

- Canonical cross-context encoding for the bridge domain ([`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                | Implementation status | Evidence                                     | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** typed messages + error round-trip. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                      | Obligation       | Public entry and setup              | Oracle and forbidden effects                     | Required permutations                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-webrtc-bridge-protocol-1-vf15nx"></a>`UNIT-TEST-WEBRTC-BRIDGE-PROTOCOL-1-VF15NX` | Error round trip | Serialize/deserialize varied errors | Message/name preserved; non-Error inputs handled | <a id="unit-test-webrtc-bridge-protocol-1-vf15nx.p1"></a>`UNIT-TEST-WEBRTC-BRIDGE-PROTOCOL-1-VF15NX.P1` — Error round trip; <a id="unit-test-webrtc-bridge-protocol-1-vf15nx.p2"></a>`UNIT-TEST-WEBRTC-BRIDGE-PROTOCOL-1-VF15NX.P2` — non-Error input; <a id="unit-test-webrtc-bridge-protocol-1-vf15nx.p3"></a>`UNIT-TEST-WEBRTC-BRIDGE-PROTOCOL-1-VF15NX.P3` — unknown message ignored by consumers |

## Related source reports

- [WebRTCMainThreadBridge](./WebRTCMainThreadBridge.ts.md), [WorkerBridgeWebRTCConnectionFactory](./WorkerBridgeWebRTCConnectionFactory.ts.md).
