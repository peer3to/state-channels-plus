# LogControlRpcMethods.ts — Source Report

> **Source:** [LogControlRpcMethods.ts](../../../../../../../../../src/utils/logging/rpc/logControl/LogControlRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../../../../views/architecture/sdk/components.md)

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

| Source file                                                                                                    | Specification IDs                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LogControlRpcMethods.ts](../../../../../../../../../src/utils/logging/rpc/logControl/LogControlRpcMethods.ts) | [`REQ-LOG-2-N6BJ3D`](../../../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d), [`REQ-LOG-4-W5XR7Q`](../../../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q) |

## Assumptions, dependencies, trust boundaries, and limits

- A call arriving on a transport the bus holds no port for runs a round that skips nothing.

## Specification adherence

- The asker is told what the round reached ({{REQ:[`REQ-LOG-2-N6BJ3D`](../../../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d)}}).
- Identity crosses only in the direction the tree allows ({{REQ:[`REQ-LOG-4-W5XR7Q`](../../../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)}}).

## Conformance traceability

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                  | Gap / divergence |
| --------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-LOG-2-N6BJ3D`](../../../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d) | Covered               | **Here:** `flush` returns `receiveFlush`'s totals. **Other files:** [LogControlService.ts.md](./LogControlService.ts.md). | None.            |
| [`REQ-LOG-4-W5XR7Q`](../../../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q) | Covered               | **Here:** `contextUpdate` → `applyInboundContext`. **Other files:** [../../LogFlushBus.ts.md](../../LogFlushBus.ts.md).   | None.            |

## Related source reports

- [LogControlService.ts.md](./LogControlService.ts.md) — owns the family these endpoints are tested under.
