# ParticipantSetChangeStorage.ts — Source Report

> **Source:** [src/storage/ParticipantSetChangeStorage.ts](../../../../../../../src/storage/ParticipantSetChangeStorage.ts) > **Status:** Authored — engineer verification pending.
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

Per-fork membership change points: the block heights at which the participant set changed,
served as ascending ranges for milestone-hop construction.

## Key design decisions

1. **Set-backed dedup, sort-on-read.** Change points live in a per-fork `Set` and are sorted at
   query time ([#L29](../../../../../../../src/storage/ParticipantSetChangeStorage.ts#L29)) — writes stay O(1) and idempotent; reads pay the sort.
2. **Inclusive defaulted bounds.** An open start defaults to the earliest point, an open end to
   the latest (implemented as last+1 with an inclusive filter); an inverted range returns
   empty.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                      |
| ------------ | --------------------------------------------- |
| Inputs       | (fork, height) change points; range queries.  |
| Outputs      | Ascending deduplicated heights within bounds. |
| Owned state  | `map` fork → Set<height>.                     |
| Side effects | None.                                         |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                       | Specification IDs                                                                           |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [ParticipantSetChangeStorage.ts](../../../../../../../src/storage/ParticipantSetChangeStorage.ts) | [`REQ-PSCSTORE-1`](../../../../specification/storage/participant-changes.md#req-pscstore-1) |

## Assumptions, dependencies, trust boundaries, and limits

- What counts as a membership change is the executing pipeline's decision; completeness of recording is the producer's obligation the spec flags as security-relevant.
- In-memory medium for this protocol version: durability across restart is not yet provided; the
  target contract is [durability.md](../../../../specification/storage/durability.md).

## Specification adherence

- Idempotent recording; ascending, bound-defaulted, inverted-empty ranges ([`REQ-PSCSTORE-1`](../../../../specification/storage/participant-changes.md#req-pscstore-1)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                     | Implementation status | Evidence                                                                                                                                                                                                                                             | Gap / divergence |
| ------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-PSCSTORE-1`](../../../../specification/storage/participant-changes.md#req-pscstore-1) | Covered               | **Here:** set-dedup writes, sorted defaulted ranges ([#L29](../../../../../../../src/storage/ParticipantSetChangeStorage.ts#L29)). **Other files:** recording completeness is [StateManager](../stateManager/StateManager.ts.md)'s commit-path duty. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                        | Obligation           | Public entry and setup                                            | Oracle and forbidden effects                                                               | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-participant-set-change-storage-1"></a>`UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1` | Recording and ranges | Record out-of-order and duplicate points; query every bound shape | Ascending dedup results; defaults honored; inverted/empty ranges empty; per-fork isolation | <a id="unit-test-participant-set-change-storage-1.p1"></a>`UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1.P1` — out-of-order + duplicates; <a id="unit-test-participant-set-change-storage-1.p2"></a>`UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1.P2` — open/closed/defaulted bounds; <a id="unit-test-participant-set-change-storage-1.p3"></a>`UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1.P3` — inverted and empty ranges; <a id="unit-test-participant-set-change-storage-1.p4"></a>`UNIT-TEST-PARTICIPANT-SET-CHANGE-STORAGE-1.P4` — per-fork isolation |

## Related source reports

- [AgreementManager](../agreementManager/AgreementManager.ts.md) (milestone construction consumer).
