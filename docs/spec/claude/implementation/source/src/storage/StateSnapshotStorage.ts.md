# StateSnapshotStorage.ts — Source Report

> **Source:** [src/storage/StateSnapshotStorage.ts](../../../../../../../src/storage/StateSnapshotStorage.ts) > **Status:** Authored — engineer verification pending.
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

Content-addressed snapshot store plus the genesis index: snapshots by snapshot hash, and
fork id → genesis snapshot for every stored genesis.

## Key design decisions

1. **Genesis auto-registration.** A snapshot flagged `isGenesis` registers itself under its
   `forkID` on store ([#L32](../../../../../../../src/storage/StateSnapshotStorage.ts#L32)) — one write path, no separate registration API to drift.
2. **Conflict refusal is structural.** Fork id equals the hash of genesis snapshot data, so a
   _conflicting_ genesis for an existing fork id would require a hash collision; the store
   therefore performs an idempotent same-content overwrite rather than an explicit check,
   trusting producer-computed identity per the module contract.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                    |
| ------------ | ----------------------------------------------------------- |
| Inputs       | Snapshots (optional caller hash); hash and fork-id queries. |
| Outputs      | Snapshots by hash; genesis snapshot by fork id.             |
| Owned state  | `snapshotsByHash`, `genesisSnapshotByForkId`.               |
| Side effects | None.                                                       |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                         | Specification IDs                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [StateSnapshotStorage.ts](../../../../../../../src/storage/StateSnapshotStorage.ts) | [`INV-SNAPSTORE-1-DPHPJE`](../../../../specification/storage/snapshots-and-states.md#inv-snapstore-1-dphpje), [`REQ-SNAPSTORE-1-AJW0HJ`](../../../../specification/storage/snapshots-and-states.md#req-snapstore-1-ajw0hj) |

## Assumptions, dependencies, trust boundaries, and limits

- Caller-supplied hashes and the `isGenesis`/`forkID` fields are producer-guaranteed ([`INV-SNAPSTORE-1-DPHPJE`](../../../../specification/storage/snapshots-and-states.md#inv-snapstore-1-dphpje) trust rule); the store never recomputes commitments.
- In-memory medium for this protocol version: durability across restart is not yet provided; the
  target contract is [durability.md](../../../../specification/storage/durability.md).

## Specification adherence

- Exact content addressing with explicit absence ([`INV-SNAPSTORE-1-DPHPJE`](../../../../specification/storage/snapshots-and-states.md#inv-snapstore-1-dphpje)).
- Idempotent genesis registration; conflicts excluded structurally under collision resistance ([`REQ-SNAPSTORE-1-AJW0HJ`](../../../../specification/storage/snapshots-and-states.md#req-snapstore-1-ajw0hj)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                      | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                         | Gap / divergence |
| ------------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`INV-SNAPSTORE-1-DPHPJE`](../../../../specification/storage/snapshots-and-states.md#inv-snapstore-1-dphpje) | Covered               | **Here:** hash-keyed store/read, explicit absence ([#L26](../../../../../../../src/storage/StateSnapshotStorage.ts#L26)).                                                                                                                                                                                                                        | None.            |
| [`REQ-SNAPSTORE-1-AJW0HJ`](../../../../specification/storage/snapshots-and-states.md#req-snapstore-1-ajw0hj) | Covered               | **Here:** auto-registration on `isGenesis` ([#L32](../../../../../../../src/storage/StateSnapshotStorage.ts#L32)); refusal structural via forkId = hash(genesis data). **Other files:** producers computing identity — [StateManager](../stateManager/StateManager.ts.md), [ReductionManager](../stateManager/reduction/ReductionManager.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                      | Obligation                           | Public entry and setup                                               | Oracle and forbidden effects                                                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-state-snapshot-storage-1-51qze2"></a>`UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2` | Content addressing and genesis index | Store snapshots (genesis and not), repeat stores, query both indexes | Round trips exact; repeats idempotent; genesis index maps fork id to its genesis only; absence explicit | <a id="unit-test-state-snapshot-storage-1-51qze2.p1"></a>`UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P1` — round trip by hash; <a id="unit-test-state-snapshot-storage-1-51qze2.p2"></a>`UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P2` — genesis registration and lookup; <a id="unit-test-state-snapshot-storage-1-51qze2.p3"></a>`UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P3` — repeat store idempotent; <a id="unit-test-state-snapshot-storage-1-51qze2.p4"></a>`UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P4` — non-genesis not indexed; <a id="unit-test-state-snapshot-storage-1-51qze2.p5"></a>`UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P5` — absent snapshot hash; <a id="unit-test-state-snapshot-storage-1-51qze2.p6"></a>`UNIT-TEST-STATE-SNAPSHOT-STORAGE-1-51QZE2.P6` — absent genesis fork id |

## Related source reports

- [Storage.ts](./Storage.ts.md) (coordinate joins), [StateMachineStateStorage](./StateMachineStateStorage.ts.md) (the committed state level below).
