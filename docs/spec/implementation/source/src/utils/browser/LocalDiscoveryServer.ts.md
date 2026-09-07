# LocalDiscoveryServer.ts — Source Report

> **Source:** [src/utils/browser/LocalDiscoveryServer.ts](../../../../../../../src/utils/browser/LocalDiscoveryServer.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

Browser-side discovery client counterpart. The relay socket becomes the peer transport, so leaving
discovery removes its topic membership without closing the established channel connection.

## Key design decisions

1. **Discovery metadata is not authentication.** The relay's announced address selects the
   handshake peer but is not written to `transport.peerAddress`; final admission owns that field.
2. **The rendezvous key is generic discovery input.** Equal caller keys form connections for either
   existing-channel or lobby discovery. The lobby topic remains session state; it is not copied onto
   the resulting transport or treated as identity proof.
3. **The channel owns a paired relay socket after discovery.** Leave removes discovery metadata for
   the owning manager. Full runtime cleanup closes the retained socket.

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

| Source file                                                                               | Specification IDs                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LocalDiscoveryServer.ts](../../../../../../../src/utils/browser/LocalDiscoveryServer.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y), [`REQ-AUTH-3-ZV74KB`](../../../../../specification/peer-communication/handshake.md#req-auth-3-zv74kb), [`REQ-LOBBY-9-N894C0`](../../../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Role-consistent with the owning views.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                      | Implementation status | Evidence                                                                                                                                                                                                                                                            | Gap / divergence |
| ------------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-AUTH-3-ZV74KB`](../../../../../specification/peer-communication/handshake.md#req-auth-3-zv74kb)        | Covered               | **Here:** the unauthenticated browser transport starts without `peerAddress`; the handshake receives the discovery address separately. **Other files:** [InitHandshakeService](../../rpc/services/initHandshake/InitHandshakeService.ts.md) verifies and admits it. | None.            |
| [`REQ-LOBBY-9-N894C0`](../../../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0) | Covered               | **Here:** leave removes the owning manager's topic metadata but keeps the paired relay transport alive for channel traffic; runtime cleanup closes it.                                                                                                              | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- Consumers per the views.
