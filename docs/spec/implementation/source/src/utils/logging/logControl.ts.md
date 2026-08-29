# logControl.ts — Source Report

> **Source:** [logControl.ts](../../../../../../../src/utils/logging/logControl.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../../views/architecture/sdk/components.md)

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

The shapes a log collection works with once the wire is someone else's problem: which side of the
tree a neighbour is on, the totals a round returns, what the bus sees of a neighbour (`flush`,
`postContext`, its side), the handle a registered port leaves behind, and the two helpers that add
totals up. No messages: a collection is a service call, so nothing here names a frame.

## Key design decisions

- **No message types.** The former ask / answer / context-changed messages are the `logControl`
  service's endpoints; this file keeps only what the bus and its ports share.
- **A port is two calls and a side.** `flush` returns the totals of the far subtree; `postContext` is
  a cast; `remoteRealm` decides how much of an inbound context to believe.
- **Totals are added up by a pure function over a list**, not accumulated into a shared object, so
  a partial collection cannot leave a half-updated total behind.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                      |
| ------------ | --------------------------------------------- |
| Inputs       | None; declarations and pure helpers.          |
| Outputs      | Types; `emptyFlushResult`, `sumFlushResults`. |
| Owned state  | None.                                         |
| Side effects | None.                                         |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                           | Specification IDs                                                                                                                                                                            |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [logControl.ts](../../../../../../../src/utils/logging/logControl.ts) | [`REQ-LOG-2-N6BJ3D`](../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d), [`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q) |

## Assumptions, dependencies, trust boundaries, and limits

- `LogRemoteRealm` is the link's side; the tree precondition is the registry's.

## Specification adherence

- The totals a caller receives distinguish uploaded, failed and never answered ({{REQ:[`REQ-LOG-2-N6BJ3D`](../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d)}}).
- The side of the tree is part of the port, so identity policy never has to be passed in ({{REQ:[`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-LOG-2-N6BJ3D`](../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d) | Covered               | **Here:** `LogFlushResult` and `sumFlushResults`. **Other files:** [LogFlushBus.ts.md](./LogFlushBus.ts.md) fills them. | None.            |
| [`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q) | Covered               | **Here:** `LogControlPort.remoteRealm`. **Other files:** [LogFlushBus.ts.md](./LogFlushBus.ts.md) applies the policy.   | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [LogFlushBus.ts.md](./LogFlushBus.ts.md) — the consumer.
- [rpc/logControl/logControlPort.ts.md](./rpc/logControl/logControlPort.ts.md) — builds a port over a link.
