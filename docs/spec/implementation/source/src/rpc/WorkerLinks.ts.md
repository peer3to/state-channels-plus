# WorkerLinks.ts — Source Report

> **Source:** [WorkerLinks.ts](../../../../../../src/rpc/WorkerLinks.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

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

| Source file                                                | Specification IDs                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [WorkerLinks.ts](../../../../../../src/rpc/WorkerLinks.ts) | [`INV-LOG-1-P4WT6R`](../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r) |

## Assumptions, dependencies, trust boundaries, and limits

- The links across all realms form a tree; the registry does not check it.
- A link's id is unique within a realm; adding a second child under an id replaces it.

## Specification adherence

- A collection walks every link but the one it arrived on, which is what makes it reach every thread
  ({{REQ:[`INV-LOG-1-P4WT6R`](../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r)}}).

## Conformance traceability

| Requirement / invariant                                                                    | Implementation status | Evidence                                                                                                                                                                         | Gap / divergence                           |
| ------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [`INV-LOG-1-P4WT6R`](../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r) | Partial               | **Here:** `neighbours(except)` is the walk. **Other files:** [../utils/logging/LogFlushBus.ts.md](../utils/logging/LogFlushBus.ts.md) turns links into ports and runs the round. | The tree precondition is not checked here. |

## Related source reports

- [../utils/logging/LogFlushBus.ts.md](../utils/logging/LogFlushBus.ts.md) — the one consumer today.
- [PortRpcRouter.ts.md](./PortRpcRouter.ts.md) — what serves a link.
