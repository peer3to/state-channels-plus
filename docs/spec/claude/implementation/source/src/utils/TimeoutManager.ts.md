# TimeoutManager.ts — Source Report

> **Source:** [src/utils/TimeoutManager.ts](../../../../../../../src/utils/TimeoutManager.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md)

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

Central scheduled-task manager: named timeouts/tasks with cancellation and disposal draining —
the scheduling substrate for queue lifetimes, author timeouts, and calldata posting.

## Key design decisions

1. **All protocol timers in one registry** so disposal can settle every pending timer exactly once.

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

| Source file                                                           | Specification IDs                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [TimeoutManager.ts](../../../../../../../src/utils/TimeoutManager.ts) | [`REQ-RUNTIME-3`](../../../../specification/runtime/execution.md#req-runtime-3) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Lifecycle-convergent scheduling ([`REQ-RUNTIME-3`](../../../../specification/runtime/execution.md#req-runtime-3)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                         | Implementation status | Evidence                           | Gap / divergence |
| ------------------------------------------------------------------------------- | --------------------- | ---------------------------------- | ---------------- |
| [`REQ-RUNTIME-3`](../../../../specification/runtime/execution.md#req-runtime-3) | Covered               | **Here:** cancel/dispose draining. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                          | Obligation           | Public entry and setup             | Oracle and forbidden effects                             | Required permutations                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------- | -------------------- | ---------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-timeout-manager-1"></a>`UNIT-TEST-TIMEOUT-MANAGER-1` | Scheduling lifecycle | Schedule/cancel/dispose under load | Exactly-once firing or cancellation; disposal drains all | <a id="unit-test-timeout-manager-1.p1"></a>`UNIT-TEST-TIMEOUT-MANAGER-1.P1` — fire; <a id="unit-test-timeout-manager-1.p2"></a>`UNIT-TEST-TIMEOUT-MANAGER-1.P2` — cancel; <a id="unit-test-timeout-manager-1.p3"></a>`UNIT-TEST-TIMEOUT-MANAGER-1.P3` — dispose drain; <a id="unit-test-timeout-manager-1.p4"></a>`UNIT-TEST-TIMEOUT-MANAGER-1.P4` — reschedule patterns |

## Related source reports

- [StateManager](../stateManager/StateManager.ts.md), [BlockQueueManager](../stateManager/BlockQueueManager.ts.md).
