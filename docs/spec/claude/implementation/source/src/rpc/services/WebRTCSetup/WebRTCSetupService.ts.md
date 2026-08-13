# WebRTCSetupService.ts — Source Report

> **Source:** [src/rpc/services/WebRTCSetup/WebRTCSetupService.ts](../../../../../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupService.ts) > **Status:** Authored — engineer verification pending.
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

The upgrade-signaling service: offer creation on the tie-broken initiator, answer acceptance,
trickle-ICE application — all bound to the authenticated session identity, with the connection
factory lazily selected (in-context WebRTC or the worker bridge) and one pending connection per
peer (a newer offer closes and replaces the older attempt).

## Key design decisions

1. **Identity from the session, connections keyed by address.** Signaling state binds to the authenticated peer, so payload-claimed identities are inert ([`REQ-UPG-1-MFBTZ1`](../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-1-mfbtz1)).
2. **Best-effort, protocol-inert.** Every failure path is a logged ignore — nothing depends on signaling truthfulness, so silent-ignore is the correct consequence class ([`INV-UPG-1-KW2A02`](../../../../../../specification/peer-communication/transport-upgrade.md#inv-upg-1-kw2a02)).
3. **A successful channel becomes an ordinary transport** that runs the full handshake before cutover ([`REQ-UPG-2-WH7BC7`](../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-2-wh7bc7)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                           |
| ------------ | ---------------------------------------------------------------------------------- |
| Inputs       | Offers/answers/candidates (untrusted JSON to the RTC stack); local initiate calls. |
| Outputs      | Signaling sends; wrapped transports on success.                                    |
| Owned state  | Connection factory; per-address pending connections (in the factory).              |
| Side effects | RTC resource churn; none protocol-visible.                                         |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                            | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [WebRTCSetupService.ts](../../../../../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupService.ts) | [`INV-UPG-1-KW2A02`](../../../../../../specification/peer-communication/transport-upgrade.md#inv-upg-1-kw2a02), [`REQ-UPG-1-MFBTZ1`](../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-1-mfbtz1), [`REQ-UPG-2-WH7BC7`](../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-2-wh7bc7), [`REQ-UPG-3-T1SRMS`](../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-3-t1srms) |

## Assumptions, dependencies, trust boundaries, and limits

- Signaling payloads are `JSON.parse`d raw (not Codec) and handed to the RTC stack — acceptable only because outcomes are protocol-inert.

## Specification adherence

- Deterministic single initiator via the handshake tie-break ([`REQ-UPG-3-T1SRMS`](../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-3-t1srms)); replacement closes the prior attempt ([`REQ-UPG-1-MFBTZ1`](../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-1-mfbtz1)).

## Specification contradictions

None demonstrated.

## Missing behavior

**[`DEF-11-JN8N6H`](../../../../../../audit/open-findings.md#def-11-jn8n6h):** attacker-supplied ICE candidates reach the stack unfiltered — an authenticated peer can induce STUN/connectivity traffic toward arbitrary third-party hosts (reflection primitive). Fix or accept under the future rate limiter ([`OQ-6-4JPNE5`](../../../../../../specification/open-questions.md#oq-6-4jpne5)); tracked in [open-findings](../../../../../../audit/open-findings.md). Connection-map entries leak if `close` is never reached (bounded by replacement, unbounded across many peers).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                        | Implementation status | Evidence                                                                                                                                                                                                       | Gap / divergence                                                                                                                |
| -------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`INV-UPG-1-KW2A02`](../../../../../../specification/peer-communication/transport-upgrade.md#inv-upg-1-kw2a02) | Covered               | **Here:** every failure is a logged ignore; no protocol state touched.                                                                                                                                         | None.                                                                                                                           |
| [`REQ-UPG-1-MFBTZ1`](../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-1-mfbtz1) | Partial               | **Here:** session-identity binding + one-pending replacement.                                                                                                                                                  | [`DEF-11-JN8N6H`](../../../../../../audit/open-findings.md#def-11-jn8n6h) unfiltered ICE targets; map-entry leak without close. |
| [`REQ-UPG-2-WH7BC7`](../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-2-wh7bc7) | Covered               | **Here:** new transport runs the handshake; cutover via profile update. **Other files:** [InitHandshakeService](../initHandshake/InitHandshakeService.ts.md), [ProfileManager](../../../ProfileManager.ts.md). | None.                                                                                                                           |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                  | Obligation                      | Public entry and setup                                                                                                         | Oracle and forbidden effects                                                                                                                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-webrtc-setup-service-1-9qst0h"></a>`UNIT-TEST-WEBRTC-SETUP-SERVICE-1-9QST0H` | Signaling inertness and binding | Run success/garbage/failing signaling during live traffic; concurrent offers; orphan candidates; mismatched payload identities | Protocol state untouched in every case; binding follows the session; replacement closes prior; orphans ignored; [`DEF-11-JN8N6H`](../../../../../../audit/open-findings.md#def-11-jn8n6h) documented | <a id="unit-test-webrtc-setup-service-1-9qst0h.p1"></a>`UNIT-TEST-WEBRTC-SETUP-SERVICE-1-9QST0H.P1` — success inert until cutover; <a id="unit-test-webrtc-setup-service-1-9qst0h.p2"></a>`UNIT-TEST-WEBRTC-SETUP-SERVICE-1-9QST0H.P2` — garbage ignored; <a id="unit-test-webrtc-setup-service-1-9qst0h.p3"></a>`UNIT-TEST-WEBRTC-SETUP-SERVICE-1-9QST0H.P3` — replacement closes prior; <a id="unit-test-webrtc-setup-service-1-9qst0h.p4"></a>`UNIT-TEST-WEBRTC-SETUP-SERVICE-1-9QST0H.P4` — orphan candidate; <a id="unit-test-webrtc-setup-service-1-9qst0h.p5"></a>`UNIT-TEST-WEBRTC-SETUP-SERVICE-1-9QST0H.P5` — payload-identity inert; <a id="unit-test-webrtc-setup-service-1-9qst0h.p6"></a>`UNIT-TEST-WEBRTC-SETUP-SERVICE-1-9QST0H.P6` — hostile ICE target (documents [`DEF-11-JN8N6H`](../../../../../../audit/open-findings.md#def-11-jn8n6h)) |

## Related source reports

- [WebRTCSetupRpcMethods](./WebRTCSetupRpcMethods.ts.md), [connection/WebRTCConnectionFactory](./connection/WebRTCConnectionFactory.ts.md), [transport/WebRTCTransport](../../../transport/WebRTCTransport.ts.md).
