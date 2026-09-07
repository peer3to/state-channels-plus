# DetachedPromises.ts — Source Report

> **Source:** [src/utils/DetachedPromises.ts](../../../../../../src/utils/DetachedPromises.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../views/architecture/sdk/runtime-and-concurrency.md)

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

Tracked detached async work so fire-and-forget tasks stay drainable at disposal. Production callers use the
standard drain bound. Harness leak tests may pass a shorter local drain bound without cancelling the tracked
work.

## Key design decisions

`observe` collects the original promise and attaches one error route. The drain retains the original rejection even when the route rejects or settles a caller-owned operation. If the route throws, the untracked catch promise becomes an unhandled rejection. `DisputeManager.requestDispute` uses this deliberately to reach the runtime error funnel; other callers must handle or route the error. See [DetachedPromises.ts](../../../../../../src/utils/DetachedPromises.ts#L28).

1. **Detached ≠ forgotten:** disposal can await the registry, keeping lifecycle convergence honest.
2. **A drain timeout is diagnostic:** expiry reports unresolved origins and leaves the underlying promises
   untouched.

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

| Source file                                                            | Specification IDs                                                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [DetachedPromises.ts](../../../../../../src/utils/DetachedPromises.ts) | [`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

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

| Unit test ID                                                                          | Obligation                    | Public entry and setup                                                                    | Oracle and forbidden effects                               | Required permutations                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-detached-observe-1-vs9s55"></a>`UNIT-TEST-DETACHED-OBSERVE-1-VS9S55` | Observable operation outcomes | Use the real component and its normal collaborators, controlling only the named boundary. | The stated result holds without the forbidden side effect. | <a id="unit-test-detached-observe-1-vs9s55.p1"></a>`UNIT-TEST-DETACHED-OBSERVE-1-VS9S55.P1` — collects fulfilled work without calling the error route; <a id="unit-test-detached-observe-1-vs9s55.p2"></a>`UNIT-TEST-DETACHED-OBSERVE-1-VS9S55.P2` — routes the original rejection once and preserves it in the drain |

## Related source reports

- Consumers per the views.
