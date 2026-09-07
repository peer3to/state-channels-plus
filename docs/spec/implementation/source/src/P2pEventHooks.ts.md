# P2pEventHooks.ts — Source Report

> **Source:** [src/P2pEventHooks.ts](../../../../../src/P2pEventHooks.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../views/architecture/sdk/components.md)

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

The integrator hook surface (connection, turn, dispute, posted-calldata, exit events…): the
application-facing notification contract.

## Key design decisions

1. **Hooks describe committed transitions** — emitted from post-commit sites per event-fidelity.

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

| Source file                                             | Specification IDs                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [P2pEventHooks.ts](../../../../../src/P2pEventHooks.ts) | [`REQ-SDK-ARCH-3-WHTDWX`](../../../specification/runtime/sdk.md#req-sdk-arch-3-whtdwx) |

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

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

## Leave-turn hook

`onLeaveTurn` is a zero-argument signal that exists only for one pending-leave peer's eligible turn. The
runtime already owns the channel and timing context needed to author the exit. Each hook declaration also
documents what it reports and when it fires. This contributes to
[`REQ-TJOIN-7-NNGTAY`](../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay).

- [P2pEventHooksUtils](./utils/P2pEventHooksUtils.ts.md).
