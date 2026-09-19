# TimeoutManager.ts — Source Report

> **Source:** [src/utils/TimeoutManager.ts](../../../../../../src/utils/TimeoutManager.ts) > **Status:** Authored — engineer verification pending.
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
2. **A cancelled task may have a waiter, so `scheduleTask` takes an optional `onCancel`**
   ([#L22](../../../../../../src/utils/TimeoutManager.ts#L22)). Some callers schedule a timer that is the _only_ thing
   that can ever settle a promise they handed out — a bounded wait whose success path is an event
   that may never arrive. Cancelling that timer wholesale used to leave the promise pending
   forever. The handler is kept beside the timer in `cancelHandlers`
   ([#L8](../../../../../../src/utils/TimeoutManager.ts#L8)) and run when the manager cancels tasks wholesale
   ([#L97](../../../../../../src/utils/TimeoutManager.ts#L97)) — channel reset through `cancelAllTasks()`, or disposal, which is the
   same body behind the terminal flag. Three boundaries make it exact rather than approximate: the
   firing path deletes the handler before running the task ([#L37](../../../../../../src/utils/TimeoutManager.ts#L37)), so a task that
   already ran is never "cancelled" as well; `cancelTask` deletes it without running it
   ([#L78](../../../../../../src/utils/TimeoutManager.ts#L78)), because an owner that cancels its own task has already settled its
   own waiter and a second settle would be a double-resolution; and the handlers are snapshotted and
   the map cleared before any of them runs ([#L97](../../../../../../src/utils/TimeoutManager.ts#L97)), each inside its own
   `try`/`catch` that logs and continues ([#L100](../../../../../../src/utils/TimeoutManager.ts#L100)), so one handler that throws cannot
   strand the rest — the pending-operation obligation of
   [`REQ-SDK-ARCH-2-QBZAT8` (Ordered lifecycle)](../../../../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8).

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

| Source file                                                        | Specification IDs                                                                                                                                                                        |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [TimeoutManager.ts](../../../../../../src/utils/TimeoutManager.ts) | [`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-SDK-ARCH-2-QBZAT8`](../../../../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Lifecycle-convergent scheduling ([`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)).

- `cancelAllTasks()` cancels pending timeouts and drains running tasks without marking the manager disposed ([#L91](../../../../../../src/utils/TimeoutManager.ts#L91)), and `dispose()` is that same body behind the terminal flag ([#L81](../../../../../../src/utils/TimeoutManager.ts#L81)) — one implementation, two lifecycles. The drain is bounded by `TASK_DRAIN_TIMEOUT_MS` ([#L4](../../../../../../src/utils/TimeoutManager.ts#L4)); the race's deadline timer is cleared once the drain settles ([#L112](../../../../../../src/utils/TimeoutManager.ts#L112)), so a completed drain leaves no stray timer behind, and a timed-out drain logs and continues. Callers must stop their own producers first, because a task still running here may schedule another; the channel-reset caller does exactly that. Contributes to [`REQ-SDK-ARCH-2-QBZAT8` (Ordered lifecycle)](../../../../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8).

- Cancelling tasks wholesale settles the waiters that only those tasks could have settled: each registered `onCancel` runs once ([#L97](../../../../../../src/utils/TimeoutManager.ts#L97)), so a pending operation fails instead of hanging across a channel reset or a disposal, which is this file's part of the pending-operation clause of [`REQ-SDK-ARCH-2-QBZAT8` (Ordered lifecycle)](../../../../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8). An owner's own `cancelTask` does not run it ([#L78](../../../../../../src/utils/TimeoutManager.ts#L78)) — that caller settled its waiter already — and neither does a task that has already fired ([#L37](../../../../../../src/utils/TimeoutManager.ts#L37)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Gap / divergence                                                                                           |
| --------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** cancel/dispose draining, and a cancel handler per pending task so a wholesale cancel settles the waiter that only that task could have settled ([#L97](../../../../../../src/utils/TimeoutManager.ts#L97)). **Other files:** the waiters themselves are owned by their schedulers — [JoinChannelService](../rpc/network/services/joinChannel/JoinChannelService.ts.md) is the first to register one.                                                                                                                                                                                                                                                                                                                                  | None.                                                                                                      |
| [`REQ-SDK-ARCH-2-QBZAT8`](../../../../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8)     | Covered               | **Here:** one body for the non-terminal `cancelAllTasks()` and terminal `dispose()` ([#L91](../../../../../../src/utils/TimeoutManager.ts#L91), [#L81](../../../../../../src/utils/TimeoutManager.ts#L81)), each pending task's `onCancel` run exactly once and isolated by `try`/`catch` ([#L97](../../../../../../src/utils/TimeoutManager.ts#L97)), and an owner's explicit `cancelTask` excluded ([#L78](../../../../../../src/utils/TimeoutManager.ts#L78)). **Other files:** [StateManager](../stateManager/StateManager.ts.md) calls `cancelAllTasks()` at the scheduled-work step of the reset; [JoinChannelService](../rpc/network/services/joinChannel/JoinChannelService.ts.md) supplies the handler that fails a pending join wait. | This file settles the timers only; whether a given waiter registers a handler is the scheduler's decision. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                        | Obligation           | Public entry and setup                                                                      | Oracle and forbidden effects                                                                                                                                                                                                                                               | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-timeout-manager-1-jngdyk"></a>`UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK` | Scheduling lifecycle | Schedule/cancel/dispose under load, with and without a cancel handler on the scheduled task | Exactly-once firing or cancellation; disposal drains all; a pending task's cancel handler runs exactly once on a wholesale cancel or disposal, never after the task fired and never on the owner's own `cancelTask`, and one throwing handler does not suppress the others | <a id="unit-test-timeout-manager-1-jngdyk.p1"></a>`UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P1` — fire; <a id="unit-test-timeout-manager-1-jngdyk.p2"></a>`UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P2` — cancel; <a id="unit-test-timeout-manager-1-jngdyk.p3"></a>`UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P3` — dispose drain; <a id="unit-test-timeout-manager-1-jngdyk.p4"></a>`UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P4` — reschedule patterns; <a id="unit-test-timeout-manager-1-jngdyk.p5"></a>`UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P5` — wholesale cancel: a pending task's cancel handler runs exactly once when `cancelAllTasks()` cancels it; <a id="unit-test-timeout-manager-1-jngdyk.p6"></a>`UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P6` — disposal: the same handler runs exactly once on `dispose()`; <a id="unit-test-timeout-manager-1-jngdyk.p7"></a>`UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P7` — no-op boundary: an owner's explicit `cancelTask` does not run the handler, and a later wholesale cancel does not run it either; <a id="unit-test-timeout-manager-1-jngdyk.p8"></a>`UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P8` — no-op boundary: a task that already fired ran its body and its handler is never run; <a id="unit-test-timeout-manager-1-jngdyk.p9"></a>`UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P9` — failure isolation: one throwing cancel handler does not stop the remaining handlers from running |

## Related source reports

- [StateManager](../stateManager/StateManager.ts.md), [BlockQueueManager](../stateManager/ingest/BlockQueueManager.ts.md), [JoinChannelService](../rpc/network/services/joinChannel/JoinChannelService.ts.md).
