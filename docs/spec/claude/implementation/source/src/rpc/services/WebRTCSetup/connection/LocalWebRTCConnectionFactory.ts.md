# LocalWebRTCConnectionFactory.ts — Source Report

> **Source:** [src/rpc/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory.ts](../../../../../../../../../../src/rpc/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/webrtc-setup.md](../../../../../../views/architecture/sdk/rpc/webrtc-setup.md)

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

The in-context factory: per-address strong map of RTC connections; createOffer/acceptOffer
(closing and replacing any existing connection for that address), applyAnswer/addIceCandidate
as no-ops without a pending connection, callback wiring for ICE/data-channel/state, close().

## Key design decisions

1. **Replace-and-close on new attempts** bounds pending state to one per peer ([`REQ-UPG-1`](../../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-1)); the strong map's leak-without-close is the service-level note.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                               |
| ------------ | -------------------------------------- |
| Inputs       | Offers/answers/candidates per address. |
| Outputs      | SDP; wrapped channels via callbacks.   |
| Owned state  | address → connection map.              |
| Side effects | RTC resources.                         |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                                              | Specification IDs                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [LocalWebRTCConnectionFactory.ts](../../../../../../../../../../src/rpc/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory.ts) | [`REQ-UPG-1`](../../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-1) |

## Assumptions, dependencies, trust boundaries, and limits

- Callbacks route outward signaling; the factory never sends itself.

## Specification adherence

- One-pending-per-peer with replacement ([`REQ-UPG-1`](../../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-1)); orphan answers/candidates are no-ops.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated (leak noted at service level).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                             | Implementation status | Evidence                                     | Gap / divergence                                                                 |
| --------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| [`REQ-UPG-1`](../../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-1) | Covered               | **Here:** replacement close + orphan no-ops. | None here (map leak noted in [WebRTCSetupService](../WebRTCSetupService.ts.md)). |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                    | Obligation           | Public entry and setup                        | Oracle and forbidden effects                                           | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | -------------------- | --------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-local-webrtc-factory-1"></a>`UNIT-TEST-LOCAL-WEBRTC-FACTORY-1` | Connection lifecycle | Offer/accept/replace/orphan/close per address | Replacement closes prior; orphans no-op; callbacks fire; close deletes | <a id="unit-test-local-webrtc-factory-1.p1"></a>`UNIT-TEST-LOCAL-WEBRTC-FACTORY-1.P1` — offer then replace; <a id="unit-test-local-webrtc-factory-1.p2"></a>`UNIT-TEST-LOCAL-WEBRTC-FACTORY-1.P2` — accept path; <a id="unit-test-local-webrtc-factory-1.p3"></a>`UNIT-TEST-LOCAL-WEBRTC-FACTORY-1.P3` — orphan answer/candidate; <a id="unit-test-local-webrtc-factory-1.p4"></a>`UNIT-TEST-LOCAL-WEBRTC-FACTORY-1.P4` — close cleanup |

## Related source reports

- [WebRTCSetupService](../WebRTCSetupService.ts.md).
