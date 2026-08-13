# ReductionComputationService.ts — Source Report

> **Source:** [src/stateManager/reduction/ReductionComputationService.ts](../../../../../../../../src/stateManager/reduction/ReductionComputationService.ts) > **Status:** Authored — engineer verification pending.
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

The compute step: `reduce.staticCall` over the committed set, resolution of the reduced latest
snapshot/state/inbound range from local agreement data, and `reduceOutputToSnapshotData.staticCall`
producing the successor genesis and its fork id.

## Key design decisions

1. **Pure mirrored computation** — the client never re-implements the fold ([`INV-MIRROR-1`](../../../../../specification/enforcement/local-mirror.md#inv-mirror-1)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                             |
| ------------ | ---------------------------------------------------- |
| Inputs       | Committed disputes + local backing data.             |
| Outputs      | ReduceOutput, successor SnapshotData, reducedForkId. |
| Owned state  | None.                                                |
| Side effects | None (staticCalls).                                  |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                         | Specification IDs    |
| ------------------------------------------------------------------------------------------------------------------- | -------------------- |
| [ReductionComputationService.ts](../../../../../../../../src/stateManager/reduction/ReductionComputationService.ts) | `REQ-DISPUTE-PIPE-3` |

## Assumptions, dependencies, trust boundaries, and limits

- Backing data completeness guaranteed by the executor's synchronization step.

## Specification adherence

- Deterministic reduction inputs→outputs (`REQ-DISPUTE-PIPE-3`).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence                         | Gap / divergence |
| ----------------------- | --------------------- | -------------------------------- | ---------------- |
| `REQ-DISPUTE-PIPE-3`    | Covered               | **Here:** mirrored compute only. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                              | Obligation       | Public entry and setup               | Oracle and forbidden effects                                                   | Required permutations                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------- | ---------------- | ------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-reduction-compute-1"></a>`UNIT-TEST-REDUCTION-COMPUTE-1` | Mirrored compute | Compute over permuted committed sets | Identical successor for every order (documents the OQ-4 caveat where it fails) | <a id="unit-test-reduction-compute-1.p1"></a>`UNIT-TEST-REDUCTION-COMPUTE-1.P1` — order permutations; <a id="unit-test-reduction-compute-1.p2"></a>`UNIT-TEST-REDUCTION-COMPUTE-1.P2` — genesis-claim disputes; <a id="unit-test-reduction-compute-1.p3"></a>`UNIT-TEST-REDUCTION-COMPUTE-1.P3` — with/without timeout |

## Related source reports

- [ReductionExecutor](./ReductionExecutor.ts.md).
