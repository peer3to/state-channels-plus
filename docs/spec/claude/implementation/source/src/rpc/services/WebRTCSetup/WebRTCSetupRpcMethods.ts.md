# WebRTCSetupRpcMethods.ts — Source Report

> **Source:** [src/rpc/services/WebRTCSetup/WebRTCSetupRpcMethods.ts](../../../../../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/webrtc-setup.md](../../../../../views/architecture/sdk/rpc/webrtc-setup.md)

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

The three one-way signaling endpoints (offer/answer/ICE): guarded, sender identity from the
transport, payload parsed and delegated, every failure a logged ignore.

## Key design decisions

1. **Answers return as their own one-way call**, not an RPC response — signaling stays symmetric fire-and-forget.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                          |
| ------------ | --------------------------------- |
| Inputs       | Serialized SDP/ICE.               |
| Outputs      | Service delegation; answer sends. |
| Owned state  | None.                             |
| Side effects | None protocol-visible.            |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                  | Specification IDs                                                                                |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [WebRTCSetupRpcMethods.ts](../../../../../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupRpcMethods.ts) | [`REQ-UPG-1`](../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-1) |

## Assumptions, dependencies, trust boundaries, and limits

- Guard admits only authenticated peers; degenerate missing-identity returns silently.

## Specification adherence

- Session-identity derivation per endpoint ([`REQ-UPG-1`](../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-1)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                          | Implementation status | Evidence                                                                                                                                  | Gap / divergence |
| ------------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-UPG-1`](../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-1) | Covered               | **Here:** transport-derived identity, silent-ignore consequence class. **Other files:** [WebRTCSetupService](./WebRTCSetupService.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                    | Obligation       | Public entry and setup                                         | Oracle and forbidden effects                                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-webrtc-setup-methods-1"></a>`UNIT-TEST-WEBRTC-SETUP-METHODS-1` | Endpoint routing | Each endpoint with valid/garbage payloads and missing identity | Delegation on valid; silent ignore otherwise; answer emitted as one-way call | <a id="unit-test-webrtc-setup-methods-1.p1"></a>`UNIT-TEST-WEBRTC-SETUP-METHODS-1.P1` — offer→answer round; <a id="unit-test-webrtc-setup-methods-1.p2"></a>`UNIT-TEST-WEBRTC-SETUP-METHODS-1.P2` — garbage offer payload; <a id="unit-test-webrtc-setup-methods-1.p3"></a>`UNIT-TEST-WEBRTC-SETUP-METHODS-1.P3` — missing identity; <a id="unit-test-webrtc-setup-methods-1.p4"></a>`UNIT-TEST-WEBRTC-SETUP-METHODS-1.P4` — garbage answer payload; <a id="unit-test-webrtc-setup-methods-1.p5"></a>`UNIT-TEST-WEBRTC-SETUP-METHODS-1.P5` — garbage candidate payload |

## Related source reports

- [WebRTCSetupService](./WebRTCSetupService.ts.md).
