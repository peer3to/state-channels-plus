# Mutex.ts — Source Report

> **Source:** [src/utils/Mutex.ts](../../../../../../src/utils/Mutex.ts) > **Status:** Authored — engineer verification pending.
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

The async mutex serializing state-transition application (the StateManager execution boundary):
FIFO waiters, named tasks for diagnostics.

## Key design decisions

1. **One tiny primitive carries the concurrency model** — the pipeline's serialized regime is exactly this lock's holders.

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

| Source file                                      | Specification IDs                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [Mutex.ts](../../../../../../src/utils/Mutex.ts) | [`REQ-RUNTIME-2-KBXKTG`](../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- FIFO fairness; single holder.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                 | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------- | ---------------- |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** ordered exclusive acquisition. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                    | Obligation    | Public entry and setup                                | Oracle and forbidden effects                                    | Required permutations                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ------------- | ----------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-mutex-1-yqgdqh"></a>`UNIT-TEST-MUTEX-1-YQGDQH` | Serialization | Contend, throw inside critical sections, verify order | Exclusive FIFO; throws release; no deadlock on reentry attempts | <a id="unit-test-mutex-1-yqgdqh.p1"></a>`UNIT-TEST-MUTEX-1-YQGDQH.P1` — contention order; <a id="unit-test-mutex-1-yqgdqh.p2"></a>`UNIT-TEST-MUTEX-1-YQGDQH.P2` — throw releases; <a id="unit-test-mutex-1-yqgdqh.p3"></a>`UNIT-TEST-MUTEX-1-YQGDQH.P3` — unlock discipline |

## Related source reports

- [StateManager](../stateManager/StateManager.ts.md).
