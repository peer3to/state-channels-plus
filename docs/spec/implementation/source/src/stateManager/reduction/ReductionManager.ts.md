# ReductionManager.ts — Source Report

> **Source:** [src/stateManager/reduction/ReductionManager.ts](../../../../../../../src/stateManager/reduction/ReductionManager.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/dispute-pipeline.md](../../../../views/architecture/sdk/dispute-pipeline.md)

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

Per-fork reduction orchestration: one shared completion promise per fork (single successor
installation), scheduling at kill-period end, `completeWithGenesis` installing the successor
genesis under the execution boundary, and channel restart on the reduced fork.

## Key design decisions

1. **One normal reduction completion per fork.** Final-dispute completion and ordinary attempts share the operation. Sync-payload verification is separate: after installing a different fork it cancels only the old pending operation with `undefined`, never supplies the sync result. [`settleForkLeft`](../../../../../../../src/stateManager/reduction/ReductionManager.ts#L93) cancels its timer and removes the pending entry while preserving an already-completed result. `tryReduce` rechecks the fork after its admission read; obsolete scheduling is ignored, and `completeWithGenesis` cannot create or await an orphan for an old fork. See [`REQ-DISPUTE-PIPE-4-3YVDSA`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa).
2. **The manager is the terminal owner.** `dispose` sets a disposed flag, cancels scheduled timers, and settles every pending completion once with `undefined`; settled results stay unchanged and disposal itself never rejects, so no detached error reaches the drain. The shared completion is the caller boundary: `tryReduce` returns it as soon as it exists and drives the executor attempt as observed detached work behind it, so disposal settles every caller without waiting for the attempt's provider or VM calls to return. A fatal attempt error rejects the completion exactly once, before the abort, and the promise carries a handled branch so a rejection nobody awaits never becomes an orphan. Afterwards `schedule` returns, `tryReduce` returns `undefined`, `getOrCreateCompletion` hands out an already-settled `undefined` completion instead of inserting into the map, and `completeWithGenesis` returns `false`. The completion type is `CompletedReduction | undefined` and every caller handles the disposed result ([`REQ-DISPUTE-PIPE-3-PHE3SQ`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq)).
3. **Genesis application is staged under the state mutex.** `completeWithGenesis` delegates to `StateApplicationService.unsafeApplyReductionGenesis` with a `shouldCommit` predicate (`!disposed && !stateManager.isDisposed`) evaluated after the VM reads and before any storage, fork, status, timer, or hook mutation; a `false` result installs nothing.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                            |
| ------------ | --------------------------------------------------- |
| Inputs       | Schedule/complete calls with fork ids and outcomes. |
| Outputs      | Installed successor genesis; restarted execution.   |
| Owned state  | Per-fork operations map.                            |
| Side effects | Fork transition via the state manager.              |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                | Specification IDs                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ReductionManager.ts](../../../../../../../src/stateManager/reduction/ReductionManager.ts) | [`REQ-DISPUTE-PIPE-4-3YVDSA`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa), [`REQ-DIS-6-Y92H1M`](../../../../../specification/disputes/disputes.md#req-dis-6-y92h1m) |

## Assumptions, dependencies, trust boundaries, and limits

- A completion resolving to a different successor than expected is fatal, not retryable.

## Specification adherence

- Every dispute path terminates in one installed successor ([`REQ-DIS-6-Y92H1M`](../../../../../specification/disputes/disputes.md#req-dis-6-y92h1m) client side).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                              | Implementation status | Evidence                                                                                                                                                                                                                                                      | Gap / divergence |
| -------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-DISPUTE-PIPE-4-3YVDSA`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa) | Covered               | **Here:** normal reduction convergence, fatal mismatch, and pending-operation cancellation after verified sync installs a different fork; completed results are preserved. **Other files:** compute/submit in [ReductionExecutor](./ReductionExecutor.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                            | Obligation        | Public entry and setup                                                  | Oracle and forbidden effects                                                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-reduction-manager-1-v1y4bm"></a>`UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM` | Single completion | Complete the same fork from multiple paths and with mismatched outcomes | One installation; later completions join; mismatch fatal; after disposal no attempt, completion, or reduction-owned write is created | <a id="unit-test-reduction-manager-1-v1y4bm.p1"></a>`UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P1` — multi-path convergence; <a id="unit-test-reduction-manager-1-v1y4bm.p2"></a>`UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P2` — mismatch fatal; <a id="unit-test-reduction-manager-1-v1y4bm.p3"></a>`UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P3` — restart effects; <a id="unit-test-reduction-manager-1-v1y4bm.p4"></a>`UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P4` — disposal after the completion exists settles the attempt as `undefined` and installs nothing; <a id="unit-test-reduction-manager-1-v1y4bm.p5"></a>`UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P5` — disposal while a direct `completeWithGenesis` waits for the state mutex returns `false` and installs nothing; <a id="unit-test-reduction-manager-1-v1y4bm.p6"></a>`UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P6` — disposal settles the caller while the attempt is still held at its executor entry; <a id="unit-test-reduction-manager-1-v1y4bm.p7"></a>`UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P7` — a fatal attempt error rejects the caller once with the original error and aborts the runtime; <a id="unit-test-reduction-manager-1-v1y4bm.p8"></a>`UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P8` — live sync settles shared callers, cancels obsolete work and permits late chain-event handling; <a id="unit-test-reduction-manager-1-v1y4bm.p9"></a>`UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P9` — admission read returning after sync creates no completion; <a id="unit-test-reduction-manager-1-v1y4bm.p10"></a>`UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P10` — completed result survives pending-operation cleanup |

## Related source reports

- [ReductionExecutor](./ReductionExecutor.ts.md), [StateManager](../StateManager.ts.md), [EventHandler](../../eventHandlers/EventHandler.ts.md).
