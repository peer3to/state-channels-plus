# HolepunchTransport.ts — Source Report

> **Source:** [src/transport/HolepunchTransport.ts](../../../../../../src/transport/HolepunchTransport.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

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

The hyperswarm bootstrap transport: wraps a Holepunch socket, stores its narrow ban handle on the
profile created by `ATransport`, and starts authentication immediately.

## Key design decisions

1. **Handshake-on-construct:** no window where an unauthenticated bootstrap connection idles usable.
2. **Ban policy stays outside the transport.** Construction supplies the SDK handle to its profile;
   the transport neither decides nor exposes ban/unban policy.

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

| Source file                                                                    | Specification IDs                                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [HolepunchTransport.ts](../../../../../../src/transport/HolepunchTransport.ts) | [`REQ-AUTH-3-ZV74KB`](../../../../specification/peer-communication/handshake.md#req-auth-3-zv74kb), [`REQ-UPG-4-M2XDBA`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-4-m2xdba) |

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

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [Holepunch](../Holepunch.ts.md), [InitHandshakeService](../rpc/services/initHandshake/InitHandshakeService.ts.md).
