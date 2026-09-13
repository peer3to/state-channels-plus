# index.ts — Source Report

> **Source:** [src/rpc/network/services/index.ts](../../../../../../../../src/rpc/network/services/index.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../views/architecture/sdk/rpc/README.md) > **Replaces:** `src/rpc/services/index.ts`

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

Service/RpcMethods re-exports incl. the WebRTC bridge installer and negotiation types. No behavior of its own.

## Key design decisions

_None — the file is declarative/mechanical; behavior-shaping decisions live with its consumers._

## Inputs, outputs, state, and side effects

| Aspect       | Contents                   |
| ------------ | -------------------------- |
| Inputs       | —                          |
| Outputs      | Re-exports.                |
| Owned state  | None.                      |
| Side effects | Module-init ordering only. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                           | Specification IDs                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [index.ts](../../../../../../../../src/rpc/network/services/index.ts) | [`REQ-RPC-1-FF89Z0`](../../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) |

## Assumptions, dependencies, trust boundaries, and limits

- Import order is deliberate where noted in-source.

## Specification adherence

[`REQ-RPC-1-FF89Z0` (Typed wire contract)](../../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0): exports the existing network guard or service contracts. Root composition remains explicit; exports do not register internal endpoints.

- Mechanical re-export.

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

- The exported modules' own reports.

The category export boundary exposes network services under [`REQ-RPC-2-SZDTTM` (Request lifecycle)](../../../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm). The WebRTC main-thread broker export now belongs to its [internal root](../../internal/roots/WebRTCMainThreadBridge.ts.md); no endpoint implementation remains in the old barrel.
