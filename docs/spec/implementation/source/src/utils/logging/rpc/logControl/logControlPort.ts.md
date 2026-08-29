# logControlPort.ts — Source Report

> **Source:** [logControlPort.ts](../../../../../../../../../src/utils/logging/rpc/logControl/logControlPort.ts) > **Status:** Authored — engineer verification pending.
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

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                        | Specification IDs                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [logControlPort.ts](../../../../../../../../../src/utils/logging/rpc/logControl/logControlPort.ts) | [`REQ-LOG-1-H2VQ8X`](../../../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x), [`REQ-LOG-4-W5XR7Q`](../../../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q) |

## Assumptions, dependencies, trust boundaries, and limits

- The far root serves `logControl`; a root without it answers unknown-service, which the bus counts as never answered.

## Specification adherence

- A thread that never answers is given up on after the limit ({{REQ:[`REQ-LOG-1-H2VQ8X`](../../../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x)}}).
- Identity is pushed as a cast on connect and on change ({{REQ:[`REQ-LOG-4-W5XR7Q`](../../../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                                                               | Gap / divergence |
| --------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-LOG-1-H2VQ8X`](../../../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x) | Covered               | **Here:** `request({ timeoutMs: CRASH_LOG_FLUSH_TIMEOUT_MS })`. **Other files:** [../../../../rpc/ARpcRouter.ts.md](../../../../rpc/ARpcRouter.ts.md) rejects on timeout and on close. | None.            |
| [`REQ-LOG-4-W5XR7Q`](../../../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q) | Covered               | **Here:** `postContext` is `contextUpdate(...).sendOne()`.                                                                                                                             | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [../../LogFlushBus.ts.md](../../LogFlushBus.ts.md) — builds one per link.
- [LogControlService.ts.md](./LogControlService.ts.md) — what answers on the far side.
