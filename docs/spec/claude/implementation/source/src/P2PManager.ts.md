# P2PManager.ts — Source Report

> **Source:** [src/P2PManager.ts](../../../../../../src/P2PManager.ts) > **Status:** Authored — engineer verification pending.
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

The frame dispatcher and correlation owner: `onRpc` runs stages 1–4 of the ingress order (16 MiB
size gate before parsing, response-first classification, envelope verification, service
resolution) before handing to the service base; `sendRpcRequest` owns the pending-request table,
per-call timeouts, the addressed-peer settlement rule (peer identity, not transport object),
late-response silent ignore, and disconnect settlement; plus broadcast/addressed delivery and
connection registry.

## Key design decisions

1. **Response-first classification** keeps response frames out of service dispatch entirely ([`REQ-RPC-6`](../../../specification/peer-communication/rpc.md#req-rpc-6)).
2. **Settlement by peer identity, not transport identity** — a WebRTC upgrade cannot orphan pending requests; a response from any _other_ peer penalizes the responder ([`REQ-RPC-2`](../../../specification/peer-communication/rpc.md#req-rpc-2)).
3. **Unknown/late responses are penalty-free by design** (must therefore stay cheap; bounded by the frame gate).

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

| Source file                                          | Specification IDs                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [P2PManager.ts](../../../../../../src/P2PManager.ts) | [`INV-RPC-1`](../../../specification/peer-communication/rpc.md#inv-rpc-1), [`REQ-RPC-1`](../../../specification/peer-communication/rpc.md#req-rpc-1), [`REQ-RPC-2`](../../../specification/peer-communication/rpc.md#req-rpc-2), [`REQ-RPC-6`](../../../specification/peer-communication/rpc.md#req-rpc-6) |

## Assumptions, dependencies, trust boundaries, and limits

- Operates inside the participant runtime; untrusted input arrives only through the documented ingress paths.

## Specification adherence

- Stages 1–4 with their per-stage consequences; correlation single-settlement.

## Specification contradictions

None demonstrated.

## Missing behavior

Per-peer rate limiting is the designated missing admission control ([OQ-6](../../../specification/open-questions.md)); request cancellation API absent (timeout-only) — documented limitation.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                   | Implementation status | Evidence                                                                                                                           | Gap / divergence                             |
| ------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [`REQ-RPC-6`](../../../specification/peer-communication/rpc.md#req-rpc-6) | Covered               | **Here:** size→classify→envelope→service with consequences. **Other files:** stages 5–7 in [ARpcService](./rpc/ARpcService.ts.md). | None.                                        |
| [`REQ-RPC-2`](../../../specification/peer-communication/rpc.md#req-rpc-2) | Covered               | **Here:** pending table, timeout, addressed-peer rule, disconnect settlement.                                                      | No cancellation beyond timeout (documented). |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                  | Obligation                    | Public entry and setup                                                                                                                                           | Oracle and forbidden effects                                                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-p2p-manager-1"></a>`UNIT-TEST-P2P-MANAGER-1` | Dispatch head and correlation | Deliver oversized/malformed/response/unknown-service frames; race response/timeout/disconnect; respond from a non-addressed peer; upgrade transports mid-request | Each stage's consequence exact; single settlement per request; non-addressed responder penalized; upgrade preserves pending requests | <a id="unit-test-p2p-manager-1.p1"></a>`UNIT-TEST-P2P-MANAGER-1.P1` — each stage-1–4 consequence; <a id="unit-test-p2p-manager-1.p2"></a>`UNIT-TEST-P2P-MANAGER-1.P2` — settlement races; <a id="unit-test-p2p-manager-1.p3"></a>`UNIT-TEST-P2P-MANAGER-1.P3` — non-addressed responder; <a id="unit-test-p2p-manager-1.p4"></a>`UNIT-TEST-P2P-MANAGER-1.P4` — late/unknown response ignored; <a id="unit-test-p2p-manager-1.p5"></a>`UNIT-TEST-P2P-MANAGER-1.P5` — transport upgrade continuity |

## Related source reports

- [ARpcService](./rpc/ARpcService.ts.md), [ProfileManager](./ProfileManager.ts.md), [transport/ATransport](./transport/ATransport.ts.md).
