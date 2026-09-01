# logControlPort.ts — Source Report

> **Source:** [logControlPort.ts](../../../../../../../../../src/utils/logging/rpc/logControl/logControlPort.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../../../../views/architecture/sdk/components.md)

## Responsibility and observable boundary

The far end of a link as the bus's port: `flush` is the typed call on the far root's `logControl`,
bounded by the configured collection timeout, and `postContext` its cast. The bus builds one per
link it is told about and never learns the service behind it.

## Key design decisions

- **The bound is the call's timeout.** A realm that never answers rejects the call, which the bus
  counts as never answered; no timer of the bus's own
  ([`logControlPortOver`](../../../../../../../../../src/utils/logging/rpc/logControl/logControlPort.ts#L8)).
- **Read per call.** Config is reassigned during worker startup, so the timeout is read when a round
  arms, as before.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                 |
| ------------ | ---------------------------------------- |
| Inputs       | A link.                                  |
| Outputs      | A `LogControlPort`.                      |
| Owned state  | None.                                    |
| Side effects | Requests and casts on the link's router. |

## Linked requirements

| Source file                                                                                        | Specification IDs                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [logControlPort.ts](../../../../../../../../../src/utils/logging/rpc/logControl/logControlPort.ts) | [`REQ-LOG-1-H2VQ8X`](../../../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x), [`REQ-LOG-4-W5XR7Q`](../../../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q) |

## Assumptions, dependencies, trust boundaries, and limits

- The far root serves `logControl`; a root without it answers unknown-service, which the bus counts as never answered.

## Specification adherence

- A thread that never answers is given up on after the limit ({{REQ:[`REQ-LOG-1-H2VQ8X`](../../../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x)}}).
- Identity is pushed as a cast on connect and on change ({{REQ:[`REQ-LOG-4-W5XR7Q`](../../../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)}}).

## Conformance traceability

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                                                               | Gap / divergence |
| --------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-LOG-1-H2VQ8X`](../../../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x) | Covered               | **Here:** `request({ timeoutMs: CRASH_LOG_FLUSH_TIMEOUT_MS })`. **Other files:** [../../../../rpc/ARpcRouter.ts.md](../../../../rpc/ARpcRouter.ts.md) rejects on timeout and on close. | None.            |
| [`REQ-LOG-4-W5XR7Q`](../../../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q) | Covered               | **Here:** `postContext` is `contextUpdate(...).sendOne()`.                                                                                                                             | None.            |

## Related source reports

- [../../LogFlushBus.ts.md](../../LogFlushBus.ts.md) — builds one per link.
- [LogControlService.ts.md](./LogControlService.ts.md) — what answers on the far side.
