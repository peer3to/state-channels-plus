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

1. **One completion per fork.** Final-dispute fast path, own reduction, and adoption all converge on the same per-fork operation — however the outcome arrives, installation happens once ([`REQ-DISPUTE-PIPE-4-3YVDSA`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa)).

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

| Requirement / invariant                                                                                              | Implementation status | Evidence                                                                                                                                     | Gap / divergence |
| -------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-DISPUTE-PIPE-4-3YVDSA`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa) | Covered               | **Here:** single-completion convergence + fatal mismatch. **Other files:** compute/submit in [ReductionExecutor](./ReductionExecutor.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                            | Obligation        | Public entry and setup                                                  | Oracle and forbidden effects                             | Required permutations                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-reduction-manager-1-v1y4bm"></a>`UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM` | Single completion | Complete the same fork from multiple paths and with mismatched outcomes | One installation; later completions join; mismatch fatal | <a id="unit-test-reduction-manager-1-v1y4bm.p1"></a>`UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P1` — multi-path convergence; <a id="unit-test-reduction-manager-1-v1y4bm.p2"></a>`UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P2` — mismatch fatal; <a id="unit-test-reduction-manager-1-v1y4bm.p3"></a>`UNIT-TEST-REDUCTION-MANAGER-1-V1Y4BM.P3` — restart effects |

## Related source reports

- [ReductionExecutor](./ReductionExecutor.ts.md), [StateManager](../StateManager.ts.md), [EventHandler](../../eventHandlers/EventHandler.ts.md).
