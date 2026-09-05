# P2pEventHooksUtils.ts — Source Report

> **Source:** [src/utils/P2pEventHooksUtils.ts](../../../../../../src/utils/P2pEventHooksUtils.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../views/architecture/sdk/components.md)

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

Hook composition/merging utilities for integrator event hooks.

## Key design decisions

_None — the file is declarative/mechanical; behavior-shaping decisions live with its consumers._

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

| Source file                                                                | Specification IDs |
| -------------------------------------------------------------------------- | ----------------- |
| [P2pEventHooksUtils.ts](../../../../../../src/utils/P2pEventHooksUtils.ts) |                   |

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

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

## Leave-turn selection

Turn notification asks the leave service whether this local signer owns a pending leave turn. It emits
the zero-argument `onLeaveTurn` signal instead of `onTurn` only in that case; other peers and later turns keep
normal automation. This contributes to
[`REQ-TJOIN-7-NNGTAY`](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay).

- Consumers per the views.
