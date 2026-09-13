# index.ts — Source Report

> **Source:** [src/rpc/network/guards/index.ts](../../../../../../../../src/rpc/network/guards/index.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../views/architecture/sdk/rpc/README.md) > **Replaces:** `src/rpc/guards/index.ts`

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

Guard re-exports. No behavior of its own.

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

| Source file                                                         | Specification IDs                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [index.ts](../../../../../../../../src/rpc/network/guards/index.ts) | [`REQ-RPC-6-E60S4J`](../../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) |

## Assumptions, dependencies, trust boundaries, and limits

- Import order is deliberate where noted in-source.

## Specification adherence

[`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j): exports the existing network guard or service contracts. Root composition remains explicit; exports do not register internal endpoints.

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

The export boundary retains access to network guard implementations under [`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk). Guard evaluation remains owned by [runGuards](runGuards.ts.md); the barrel adds no dispatch behavior.
