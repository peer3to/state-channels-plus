# ForceExitStorage.ts — Source Report

> **Source:** [src/storage/ForceExitStorage.ts](../../../../../../../src/storage/ForceExitStorage.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

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

The local force-exit intent flag: the node intends to exit through the dispute path.

## Key design decisions

1. **A boolean with explicit set-both-ways.** Clearing is `setForceExit(false)`; absent state is `false` by initialization ([#L2](../../../../../../../src/storage/ForceExitStorage.ts#L2)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents            |
| ------------ | ------------------- |
| Inputs       | Boolean intent.     |
| Outputs      | Current intent.     |
| Owned state  | `shouldIForceExit`. |
| Side effects | None.               |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                 | Specification IDs                                                                      |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [ForceExitStorage.ts](../../../../../../../src/storage/ForceExitStorage.ts) | [`REQ-RMSTORE-2`](../../../../specification/storage/progress-markers.md#req-rmstore-2) |

## Assumptions, dependencies, trust boundaries, and limits

- Consumers must not infer intent from any other module.
- In-memory medium for this protocol version: durability across restart is not yet provided; the
  target contract is [durability.md](../../../../specification/storage/durability.md).

## Specification adherence

- Explicit intent lifecycle with false default ([`REQ-RMSTORE-2`](../../../../specification/storage/progress-markers.md#req-rmstore-2)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                      | Gap / divergence |
| -------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RMSTORE-2`](../../../../specification/storage/progress-markers.md#req-rmstore-2) | Covered               | **Here:** explicit set/read with false default ([#L2](../../../../../../../src/storage/ForceExitStorage.ts#L2)). **Other files:** [ForceJoinStorage](./ForceJoinStorage.ts.md) covers the join-marker half; intent production — [StateManager](../stateManager/StateManager.ts.md) exit path. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                | Obligation       | Public entry and setup                             | Oracle and forbidden effects                         | Required permutations                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------- | ---------------- | -------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-force-exit-storage-1"></a>`UNIT-TEST-FORCE-EXIT-STORAGE-1` | Intent lifecycle | Set, read, and clear the flag incl. before any set | Explicit lifecycle; default false; idempotent clears | <a id="unit-test-force-exit-storage-1.p1"></a>`UNIT-TEST-FORCE-EXIT-STORAGE-1.P1` — default false; <a id="unit-test-force-exit-storage-1.p2"></a>`UNIT-TEST-FORCE-EXIT-STORAGE-1.P2` — set/read/clear; <a id="unit-test-force-exit-storage-1.p3"></a>`UNIT-TEST-FORCE-EXIT-STORAGE-1.P3` — repeated set idempotent |

## Related source reports

- [DisputeManager](../disputeManager/DisputeManager.ts.md) (reads `selfRemoval` at construction).
