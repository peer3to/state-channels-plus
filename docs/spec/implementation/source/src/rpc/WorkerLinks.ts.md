# WorkerLinks.ts — Source Report

> **Source:** [WorkerLinks.ts](../../../../../../src/rpc/WorkerLinks.ts) > **Status:** Authored — engineer verification pending.
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

The realm's neighbours in the worker tree: at most one parent and children by id, each with the
transport and router that serve it and the logger whose context crosses it. Service-neutral: a
tree-wide operation reads the registry and brings its own service; the registry never knows what
runs over a link.

## Key design decisions

- **One registry per realm, one per bus in a fixture.** The module value is the realm's; a
  `LogFlushBus` owns the registry its links land on, so a fixture with several realms in one process
  keeps them apart.
- **A child needs an instance identity.** A realm can hold several children of one role (the harness
  main thread holds one sdk link per peer), so a child's id is role plus instance.
- **Listeners are replayed.** A subscriber added after links exist is told about them first, so an
  observer never misses a link by arriving late.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------ |
| Inputs       | Links added by the owners of ports; removals on dispose.                                   |
| Outputs      | The neighbours, all or all but one; the link a transport belongs to; change notifications. |
| Owned state  | The parent link; the children by id; the listeners.                                        |
| Side effects | None beyond calling listeners.                                                             |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                | Specification IDs                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [WorkerLinks.ts](../../../../../../src/rpc/WorkerLinks.ts) | [`INV-LOG-1-P4WT6R`](../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r) |

## Assumptions, dependencies, trust boundaries, and limits

- The links across all realms form a tree; the registry does not check it.
- A link's id is unique within a realm; adding a second child under an id replaces it.

## Specification adherence

- A collection walks every link but the one it arrived on, which is what makes it reach every thread
  ({{REQ:[`INV-LOG-1-P4WT6R`](../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                    | Implementation status | Evidence                                                                                                                                                                         | Gap / divergence                           |
| ------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [`INV-LOG-1-P4WT6R`](../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r) | Partial               | **Here:** `neighbours(except)` is the walk. **Other files:** [../utils/logging/LogFlushBus.ts.md](../utils/logging/LogFlushBus.ts.md) turns links into ports and runs the round. | The tree precondition is not checked here. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [../utils/logging/LogFlushBus.ts.md](../utils/logging/LogFlushBus.ts.md) — the one consumer today.
- [PortRpcRouter.ts.md](./PortRpcRouter.ts.md) — what serves a link.
