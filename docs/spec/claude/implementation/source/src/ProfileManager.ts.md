# ProfileManager.ts — Source Report

> **Source:** [src/ProfileManager.ts](../../../../../../src/ProfileManager.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../views/architecture/sdk/rpc/README.md), [architecture/sdk/components.md](../../views/architecture/sdk/components.md)

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

Identity-keyed peer registry: profiles by checksummed address surviving transport churn,
blacklist state, transport binding with upgrade replacement (old transport retired after a
grace window), and address→live-transport resolution for addressed delivery.

## Key design decisions

1. **Identity outlives connection.** Profiles and exclusion state key by normalized address ([`REQ-ID-2`](../../../specification/protocol-model/identity.md#req-id-2)); `updateTransport` keeps profile object identity across upgrades ([`REQ-UPG-2`](../../../specification/peer-communication/transport-upgrade.md#req-upg-2)).

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

| Source file                                                  | Specification IDs                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ProfileManager.ts](../../../../../../src/ProfileManager.ts) | [`REQ-ID-2`](../../../specification/protocol-model/identity.md#req-id-2), [`REQ-UPG-2`](../../../specification/peer-communication/transport-upgrade.md#req-upg-2), [`REQ-AUTH-4`](../../../specification/peer-communication/handshake.md#req-auth-4) |

## Assumptions, dependencies, trust boundaries, and limits

- Operates inside the participant runtime; untrusted input arrives only through the documented ingress paths.

## Specification adherence

- Normalized-address keying; churn-surviving exclusion ([`REQ-AUTH-4`](../../../specification/peer-communication/handshake.md#req-auth-4) consequence store).

## Specification contradictions

None demonstrated.

## Missing behavior

Blacklist persistence across restarts is undefined (in-memory) — ban-persistence question in [OQ-34](../../../specification/open-questions.md).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                 | Implementation status | Evidence                                                                   | Gap / divergence |
| --------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------- | ---------------- |
| [`REQ-ID-2`](../../../specification/protocol-model/identity.md#req-id-2)                | Covered               | **Here:** checksum normalization at every keyed structure.                 | None.            |
| [`REQ-UPG-2`](../../../specification/peer-communication/transport-upgrade.md#req-upg-2) | Covered               | **Here:** profile-preserving transport replacement with graced retirement. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                          | Obligation          | Public entry and setup                                                       | Oracle and forbidden effects                                               | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-profile-manager-1"></a>`UNIT-TEST-PROFILE-MANAGER-1` | Identity continuity | Register, upgrade transports, reconnect, exclude with case-variant addresses | Profiles/exclusions persist by identity; variants unify; retirement graced | <a id="unit-test-profile-manager-1.p1"></a>`UNIT-TEST-PROFILE-MANAGER-1.P1` — case-variant unify; <a id="unit-test-profile-manager-1.p2"></a>`UNIT-TEST-PROFILE-MANAGER-1.P2` — upgrade preserves profile; <a id="unit-test-profile-manager-1.p3"></a>`UNIT-TEST-PROFILE-MANAGER-1.P3` — exclusion survives churn; <a id="unit-test-profile-manager-1.p4"></a>`UNIT-TEST-PROFILE-MANAGER-1.P4` — resolution returns live transport |

## Related source reports

- [PeerProfile](./PeerProfile.ts.md), [P2PManager](./P2PManager.ts.md), [InitHandshakeService](./rpc/services/initHandshake/InitHandshakeService.ts.md).
