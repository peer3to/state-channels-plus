# PeerProfile.ts — Source Report

> **Source:** [src/PeerProfile.ts](../../../../../src/PeerProfile.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../views/architecture/sdk/rpc/README.md)

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

The per-peer record created with each transport: optional identity, blacklist flag, current
transport, and the Holepunch ban handle that survives transport replacement. Exact-transport
authentication is represented by `ATransport.peerAddress`, not duplicated on the profile.

## Key design decisions

1. **The ban handle belongs to the profile from transport creation.** Authentication adds the
   verified address and identity index without introducing a second handle store; `ProfileManager`
   remains the only ban-policy owner.

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

| Source file                                         | Specification IDs                                                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [PeerProfile.ts](../../../../../src/PeerProfile.ts) | [`REQ-AUTH-3-ZV74KB`](../../../specification/peer-communication/handshake.md#req-auth-3-zv74kb), [`REQ-UPG-4-M2XDBA`](../../../specification/peer-communication/transport-upgrade.md#req-upg-4-m2xdba) |

## Assumptions, dependencies, trust boundaries, and limits

- Operates inside the participant runtime; untrusted input arrives only through the documented ingress paths.

## Specification adherence

- Role-consistent with the owning views; no divergence observed at this file's boundary.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                               | Implementation status | Evidence                                                                                                                                                                                                                                          | Gap / divergence |
| ----------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-UPG-4-M2XDBA`](../../../specification/peer-communication/transport-upgrade.md#req-upg-4-m2xdba) | Covered               | **Here:** the bootstrap handle is attached before authentication and remains on the profile across transport replacement. **Other files:** [ProfileManager](./ProfileManager.ts.md) authenticates and indexes the profile and applies ban policy. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [ProfileManager](./ProfileManager.ts.md).
