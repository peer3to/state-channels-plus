# WebRTCTransport.ts — Source Report

> **Source:** [src/transport/WebRTCTransport.ts](../../../../../../src/transport/WebRTCTransport.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/webrtc-setup.md](../../../views/architecture/sdk/rpc/webrtc-setup.md)

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

The upgraded direct transport: wraps an established data channel, runs its own handshake before
carrying protocol traffic, and reports the WebRTC transport type for preference logic.

## Key design decisions

1. **Re-authentication is built into the wrapper** — signaling produced connectivity, the transport proves identity ([`REQ-UPG-2-WH7BC7`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-2-wh7bc7)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | Per role above. |
| Side effects | Per role above. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                              | Specification IDs                                                                                        |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [WebRTCTransport.ts](../../../../../../src/transport/WebRTCTransport.ts) | [`REQ-UPG-2-WH7BC7`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-2-wh7bc7) |

## Assumptions, dependencies, trust boundaries, and limits

- Network transports are untrusted byte pipes; identity comes only from the handshake.

## Specification adherence

- Role-consistent with the transport/handshake views.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                  | Implementation status | Evidence                                                                                                                                                                                                                           | Gap / divergence |
| -------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-UPG-2-WH7BC7`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-2-wh7bc7) | Covered               | **Here:** the transport queues traffic until the direct channel opens, starts one identity handshake, and then sends directly. **Other files:** [ProfileManager](../ProfileManager.ts.md) owns replacement and profile continuity. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                          | Obligation                                  | Public entry and setup                                                                                        | Oracle and forbidden effects                                                                               | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-webrtc-transport-1-xep60p"></a>`UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P` | Direct-channel send and handshake lifecycle | Construct `WebRTCTransport` with a typed channel boundary, a real `ProfileManager`, and record-only RPC hooks | Connecting sends wait and flush in order; open starts one handshake and sends directly; closed drops sends | <a id="unit-test-webrtc-transport-1-xep60p.p1"></a>`UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P1` — connecting sends queue and flush in order on open; <a id="unit-test-webrtc-transport-1-xep60p.p2"></a>`UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P2` — construction with an open channel starts the handshake; <a id="unit-test-webrtc-transport-1-xep60p.p3"></a>`UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P3` — a repeated open event does not start another handshake; <a id="unit-test-webrtc-transport-1-xep60p.p4"></a>`UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P4` — an open channel sends directly; <a id="unit-test-webrtc-transport-1-xep60p.p5"></a>`UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P5` — a closed channel drops sends |

## Related source reports

- [WebRTCSetupService](../rpc/services/WebRTCSetup/WebRTCSetupService.ts.md).
