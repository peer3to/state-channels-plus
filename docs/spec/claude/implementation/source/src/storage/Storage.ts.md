# Storage.ts — Source Report

> **Source:** [src/storage/Storage.ts](../../../../../../../src/storage/Storage.ts) > **Status:** Authored — engineer verification pending.
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

The storage facade: composes the fifteen module instances (blocks, inbound/outbound message
blocks, snapshots, machine states, participant changes, queue, dispute evidence, proofs,
timeouts, intent markers, calldata, event-sync) behind one object and owns the **derived
reads** that join them: snapshot-at-coordinates (negative height resolves the fork genesis),
genesis machine state, previous snapshot/block, participant union at a coordinate, and the
author-relevant previous timestamp.

## Key design decisions

1. **Defensive copies everywhere.** Every module (and the facade itself) is wrapped in a
   deep-copy proxy, so values returned to callers are copies — a caller mutating a returned
   object can never corrupt stored state, which is what keeps storage's exact-preservation
   promise ([`REQ-IX-9`](../../../../specification/interactions.md#req-ix-9)) cheap to trust.
2. **Joins are explicit, not cached.** Derived reads re-resolve through the module keys on
   every call (block → snapshot hash → snapshot → state hash → state); nothing is
   denormalized, so module writes are the single source of truth.
3. **Disjoint key spaces.** Modules never reach into each other; only the facade composes
   them, and it holds no protocol state of its own.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                        |
| ------------ | ------------------------------------------------------------------------------- |
| Inputs       | Coordinate queries (fork id, height), hashes, participant addresses.            |
| Outputs      | Deep copies of stored records or explicit absence (`undefined`) for most reads. |
| Owned state  | None beyond the module instances it constructs.                                 |
| Side effects | None — the facade adds no writes of its own.                                    |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                               | Specification IDs                                                                                                                                                |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Storage.ts](../../../../../../../src/storage/Storage.ts) | [`REQ-SNAPSTORE-2`](../../../../specification/storage/snapshots-and-states.md#req-snapstore-2), [`REQ-IX-9`](../../../../specification/interactions.md#req-ix-9) |

## Assumptions, dependencies, trust boundaries, and limits

- Producers validated everything before storing; the facade grants no validity ([`REQ-IX-9`](../../../../specification/interactions.md#req-ix-9)).
- Deep-copy proxying trades CPU/allocations for aliasing safety; large states pay the copy cost on every read.
- In-memory medium for this protocol version: durability across restart is not yet provided; the
  target contract is [durability.md](../../../../specification/storage/durability.md).

## Specification adherence

- Coordinate reads (`getStateSnapshot`, `getGenesisStateMachineState`) return explicit absence on any missing join link and resolve negative heights to fork genesis, per [`REQ-SNAPSTORE-2`](../../../../specification/storage/snapshots-and-states.md#req-snapstore-2).
- Participant union merges previous and resulting snapshot sets, honoring an explicitly supplied resulting-snapshot hash.

## Specification contradictions

`getPreviousBlockOrSnapshot` and `getPreviousRelevantTimestamp` use non-null assertions on the
predecessor lookup: an absent predecessor produces an unclassified runtime throw instead of the
explicit absence [`REQ-SNAPSTORE-2`](../../../../specification/storage/snapshots-and-states.md#req-snapstore-2) requires. Callers currently only invoke them where the
predecessor exists, but the contract violation stands — engineer decision: harden the helpers or
narrow the spec to caller-guaranteed preconditions.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                        | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                         | Gap / divergence                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`REQ-SNAPSTORE-2`](../../../../specification/storage/snapshots-and-states.md#req-snapstore-2) | Contradicts           | **Here:** explicit-absence joins in `getStateSnapshot`/`getGenesisStateMachineState` ([Storage.ts](../../../../../../../src/storage/Storage.ts#L66)); genesis resolution for negative heights. **Other files:** [StateSnapshotStorage](./StateSnapshotStorage.ts.md), [BlockStorage](./BlockStorage.ts.md), [StateMachineStateStorage](./StateMachineStateStorage.ts.md) hold the joined levels. | `getPreviousBlockOrSnapshot`/`getPreviousRelevantTimestamp` throw on an absent predecessor (non-null assertions, [#L147](../../../../../../../src/storage/Storage.ts#L147)) instead of returning explicit absence. |
| [`REQ-IX-9`](../../../../specification/interactions.md#req-ix-9)                               | Covered               | **Here:** deep-copy proxy wrapping of every module and the facade ([#L38](../../../../../../../src/storage/Storage.ts#L38)) prevents caller-side mutation of stored state. **Other files:** each module report covers its own merge/read fidelity.                                                                                                                                               | None.                                                                                                                                                                                                              |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                        | Obligation                                        | Public entry and setup                                                    | Oracle and forbidden effects                                                                                    | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-storage-facade-1"></a>`UNIT-TEST-STORAGE-FACADE-1` | Derived reads join explicitly and fail explicitly | Populate modules with linked and gapped fixtures; query each derived read | Complete joins return exact copies; each missing link yields explicit absence; negative height resolves genesis | <a id="unit-test-storage-facade-1.p1"></a>`UNIT-TEST-STORAGE-FACADE-1.P1` — full join per derived read; <a id="unit-test-storage-facade-1.p2"></a>`UNIT-TEST-STORAGE-FACADE-1.P2` — each missing join link; <a id="unit-test-storage-facade-1.p3"></a>`UNIT-TEST-STORAGE-FACADE-1.P3` — negative-height genesis resolution; <a id="unit-test-storage-facade-1.p4"></a>`UNIT-TEST-STORAGE-FACADE-1.P4` — participant union across a membership change (with and without explicit resulting hash); <a id="unit-test-storage-facade-1.p5"></a>`UNIT-TEST-STORAGE-FACADE-1.P5` — absent-predecessor behavior of the two asserting helpers (documents the contradiction) |
| <a id="unit-test-storage-facade-2"></a>`UNIT-TEST-STORAGE-FACADE-2` | Defensive copying                                 | Read a stored record, mutate the returned object, read again              | Stored state is unaffected; successive reads are independent copies                                             | <a id="unit-test-storage-facade-2.p1"></a>`UNIT-TEST-STORAGE-FACADE-2.P1` — mutate returned snapshot/block/state; <a id="unit-test-storage-facade-2.p2"></a>`UNIT-TEST-STORAGE-FACADE-2.P2` — write-side aliasing (stored input later mutated by producer)                                                                                                                                                                                                                                                                                                                                                                                                          |

## Related source reports

- Every module report in this directory; [BlockQueueManager](../stateManager/BlockQueueManager.ts.md) and [StateManager](../stateManager/StateManager.ts.md) as the primary consumers.
