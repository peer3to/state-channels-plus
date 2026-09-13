# P2pRuntimeHostRootEntry.ts — Source Report

> **Source:** [worker/P2pRuntimeHostRootEntry.ts](../../../../../../../../src/rpc/internal/worker/P2pRuntimeHostRootEntry.ts) > **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Explicit worker entry for P2pRuntimeHostRoot. Sets the built-in diagnostic thread name, imports the class and calls the shared startRootWorker without selecting behavior by name.

## Key design decisions

Creation owns initialization. Class names label diagnostics only. Worker policy is common across root types.

## Inputs, outputs, state, and side effects

Uses the shared root bootstrap and thread environment. No domain cleanup or request tracking is duplicated.

## Linked requirements

| Source file                                                                                                     | Specification IDs                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [worker/P2pRuntimeHostRootEntry.ts](../../../../../../../../src/rpc/internal/worker/P2pRuntimeHostRootEntry.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

Worker entry modules must be bundled as entries. Root class modules are safe to import independently.

## Specification adherence

Preserves explicit initialization across inline and worker placement.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                                                                                                                                                | Gap / divergence            |
| --------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** [worker/P2pRuntimeHostRootEntry.ts](../../../../../../../../src/rpc/internal/worker/P2pRuntimeHostRootEntry.ts) supplies the entry or shared diagnostic state. **Other files:** [createRoot](../createRoot.ts.md) owns initialization and parent connections. | None for this contribution. |

## Component test obligations

Covered through the common root creation obligations in [createRoot](../createRoot.ts.md), including worker entry initialization and preservation of inline globals.

## Related source reports

[createRoot](../createRoot.ts.md).
