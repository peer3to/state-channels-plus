# ATransport.ts — Source Report

> **Source:** [src/transport/ATransport.ts](../../../../../../../src/transport/ATransport.ts) > **Status:** Authored — engineer verification pending.
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

The transport base: `send` (serialize + `_send`), `sendRpcResponse`, `peerAddress` (written only
by handshake verification), `isSamePeer` (checksum-address comparison — the settlement identity
rule), and `isTrusted` (false for every network transport).

## Key design decisions

1. **`isSamePeer` compares identities, not objects** — response settlement survives transport upgrades ([`REQ-RPC-2`](../../../../specification/peer-communication/rpc.md#req-rpc-2)).
2. **`isTrusted` defaults false**; only loopback overrides — the guard-bypass boundary is a transport property, not a call-site decision.

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

| Source file                                                       | Specification IDs                                                                                                                                          |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ATransport.ts](../../../../../../../src/transport/ATransport.ts) | [`INV-RPC-1`](../../../../specification/peer-communication/rpc.md#inv-rpc-1), [`REQ-RPC-2`](../../../../specification/peer-communication/rpc.md#req-rpc-2) |

## Assumptions, dependencies, trust boundaries, and limits

- Network transports are untrusted byte pipes; identity comes only from the handshake.

## Specification adherence

- Identity-bearing surface for identity-bound dispatch ([`INV-RPC-1`](../../../../specification/peer-communication/rpc.md#inv-rpc-1)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                      | Implementation status | Evidence                                              | Gap / divergence |
| ---------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------- | ---------------- |
| [`REQ-RPC-2`](../../../../specification/peer-communication/rpc.md#req-rpc-2) | Covered               | **Here:** `isSamePeer` identity comparison.           | None.            |
| [`INV-RPC-1`](../../../../specification/peer-communication/rpc.md#inv-rpc-1) | Covered               | **Here:** peerAddress written only from verification. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                | Obligation       | Public entry and setup                                                              | Oracle and forbidden effects                                 | Required permutations                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-atransport-1"></a>`UNIT-TEST-ATRANSPORT-1` | Identity surface | Compare peers across case variants and transport replacements; check trust defaults | Identity comparison normalized; network transports untrusted | <a id="unit-test-atransport-1.p1"></a>`UNIT-TEST-ATRANSPORT-1.P1` — isSamePeer variants; <a id="unit-test-atransport-1.p2"></a>`UNIT-TEST-ATRANSPORT-1.P2` — isTrusted defaults; <a id="unit-test-atransport-1.p3"></a>`UNIT-TEST-ATRANSPORT-1.P3` — send/serialize path |

## Related source reports

- [LoopbackTransport](./LoopbackTransport.ts.md), [P2PManager](../P2PManager.ts.md).
