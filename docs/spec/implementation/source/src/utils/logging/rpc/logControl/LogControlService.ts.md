# LogControlService.ts — Source Report

> **Source:** [LogControlService.ts](../../../../../../../../../src/utils/logging/rpc/logControl/LogControlService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../../../../views/architecture/sdk/components.md)

## Responsibility and observable boundary

Log collection over a worker link, as a service every root that serves a link composes. It is bound
to the bus of the logger whose context crosses that link — the realm's bus in production, a private
one in a fixture — so a call arriving on a link runs on the bus that holds the link's port.

## Key design decisions

- **One service class in every root.** Adding a realm to the log tree is composing this service and
  registering the link; no transport, union or switch changes
  ([`constructor`](../../../../../../../../../src/utils/logging/rpc/logControl/LogControlService.ts#L19)).
- **Bound to the owner logger's bus.** `logger.logFlushBus` decides which bus answers, which is what
  lets several realms share a process in a fixture.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                          |
| ------------ | --------------------------------------------------------------------------------- |
| Inputs       | The router that dispatches to it, the logger it logs through, optionally the bus. |
| Outputs      | The endpoints below.                                                              |
| Owned state  | The bus.                                                                          |
| Side effects | None of its own.                                                                  |

## Linked requirements

| Source file                                                                                              | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [LogControlService.ts](../../../../../../../../../src/utils/logging/rpc/logControl/LogControlService.ts) | [`INV-LOG-1-P4WT6R`](../../../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r), [`REQ-LOG-2-N6BJ3D`](../../../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d), [`REQ-LOG-4-W5XR7Q`](../../../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q), [`REQ-LOG-8-B7VN3J`](../../../../../../../specification/runtime/log-collection.md#req-log-8-b7vn3j) |

## Assumptions, dependencies, trust boundaries, and limits

- A link's far end is trusted; what it sends about identity is still filtered by tree side.

## Specification adherence

- A collection arriving on a link runs on this realm and answers with what it reached ({{REQ:[`INV-LOG-1-P4WT6R`](../../../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r)}}, {{REQ:[`REQ-LOG-2-N6BJ3D`](../../../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d)}}).
- Identity arriving on a link is applied by tree side ({{REQ:[`REQ-LOG-4-W5XR7Q`](../../../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)}}).
- Nothing platform-specific: the same service on every host ({{REQ:[`REQ-LOG-8-B7VN3J`](../../../../../../../specification/runtime/log-collection.md#req-log-8-b7vn3j)}}).

## Conformance traceability

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                                         | Gap / divergence                                |
| --------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [`INV-LOG-1-P4WT6R`](../../../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r) | Covered               | **Here:** every root composes it. **Other files:** [../../LogFlushBus.ts.md](../../LogFlushBus.ts.md) runs the round it hands over.                              | None.                                           |
| [`REQ-LOG-2-N6BJ3D`](../../../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d) | Covered               | **Here:** `flush` returns the totals as the reply. **Other files:** [../../LogFlushBus.ts.md](../../LogFlushBus.ts.md) sums them.                                | None.                                           |
| [`REQ-LOG-4-W5XR7Q`](../../../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q) | Covered               | **Here:** `contextUpdate` hands the context to the bus with its port. **Other files:** [../../LogFlushBus.ts.md](../../LogFlushBus.ts.md) decides what to apply. | None.                                           |
| [`REQ-LOG-8-B7VN3J`](../../../../../../../specification/runtime/log-collection.md#req-log-8-b7vn3j) | Covered               | **Here:** imports nothing platform-specific.                                                                                                                     | Browser paths are written but not yet executed. |

## Component test obligations

| Unit test ID                                                                | Obligation                                                                                          | Public entry and setup                                                                                  | Oracle and forbidden effects                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-log-control-1-2rhz4r"></a>`UNIT-TEST-LOG-CONTROL-1-2RHZ4R` | The collection call answers with the subtree's totals and the context cast is applied by tree side. | Realms joined by real `MessageChannel` pairs through routers, each serving this service on its own bus. | The totals the asker receives; the context the far root holds afterwards. | <a id="unit-test-log-control-1-2rhz4r.p1"></a>`UNIT-TEST-LOG-CONTROL-1-2RHZ4R.P1` — a flush answers with the totals of the realms it reached; <a id="unit-test-log-control-1-2rhz4r.p2"></a>`UNIT-TEST-LOG-CONTROL-1-2RHZ4R.P2` — a context arriving from a child applies the channel and refuses the identity; <a id="unit-test-log-control-1-2rhz4r.p3"></a>`UNIT-TEST-LOG-CONTROL-1-2RHZ4R.P3` — a context arriving from a parent reaches the leaf before its first upload |

## Related source reports

- [LogControlRpcMethods.ts.md](./LogControlRpcMethods.ts.md) — the endpoints.
- [logControlPort.ts.md](./logControlPort.ts.md) — the far end as a port.
- [../../LogFlushBus.ts.md](../../LogFlushBus.ts.md) — the bus.
