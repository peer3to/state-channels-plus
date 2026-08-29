# LogControlRpcMethods.ts — Source Report

> **Source:** [LogControlRpcMethods.ts](../../../../../../../../../src/utils/logging/rpc/logControl/LogControlRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../../../../views/architecture/sdk/components.md)

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

The two endpoints of log control: `flush(reason)`, a call answered with the totals of everything
reachable from this realm but the asker's side, and `contextUpdate(context)`, a cast that says the far
realm's channel or identity changed.

## Key design decisions

- **The reply is the ack.** There is no ack message and no id of the bus's own: the request/response
  core correlates, times out and settles on close ([`flush`](../../../../../../../../../src/utils/logging/rpc/logControl/LogControlRpcMethods.ts#L18)).
- **Only endpoints live here.** Anything on this class is callable from the far end; the bus lookup
  goes through the service.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                         |
| ------------ | ------------------------------------------------ |
| Inputs       | A reason; a shared context.                      |
| Outputs      | Totals; nothing.                                 |
| Owned state  | None.                                            |
| Side effects | A round on the bus; a context applied to a root. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                    | Specification IDs                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LogControlRpcMethods.ts](../../../../../../../../../src/utils/logging/rpc/logControl/LogControlRpcMethods.ts) | [`REQ-LOG-2-N6BJ3D`](../../../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d), [`REQ-LOG-4-W5XR7Q`](../../../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q) |

## Assumptions, dependencies, trust boundaries, and limits

- A call arriving on a transport the bus holds no port for runs a round that skips nothing.

## Specification adherence

- The asker is told what the round reached ({{REQ:[`REQ-LOG-2-N6BJ3D`](../../../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d)}}).
- Identity crosses only in the direction the tree allows ({{REQ:[`REQ-LOG-4-W5XR7Q`](../../../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                  | Gap / divergence |
| --------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-LOG-2-N6BJ3D`](../../../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d) | Covered               | **Here:** `flush` returns `receiveFlush`'s totals. **Other files:** [LogControlService.ts.md](./LogControlService.ts.md). | None.            |
| [`REQ-LOG-4-W5XR7Q`](../../../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q) | Covered               | **Here:** `contextUpdate` → `applyInboundContext`. **Other files:** [../../LogFlushBus.ts.md](../../LogFlushBus.ts.md).   | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [LogControlService.ts.md](./LogControlService.ts.md) — owns the family these endpoints are tested under.
