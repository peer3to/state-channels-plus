# StateMachineStateStorage.ts — Source Report

> **Source:** [src/storage/StateMachineStateStorage.ts](../../../../../../src/storage/StateMachineStateStorage.ts) > **Status:** Authored — engineer verification pending.
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

Content-addressed encoded application states: `stateMachineStateHash` → encoded bytes.

## Key design decisions

1. **Compute-or-accept keying.** The key is the keccak of the encoded state unless the caller
   supplies one ([#L20](../../../../../../src/storage/StateMachineStateStorage.ts#L20)) — the standard producer-trust escape used when the hash is already known from a commitment.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                   |
| ------------ | ------------------------------------------ |
| Inputs       | Encoded states (optional hash).            |
| Outputs      | Encoded state by hash or explicit absence. |
| Owned state  | `statesByHash`.                            |
| Side effects | None.                                      |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                              | Specification IDs                                                                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [StateMachineStateStorage.ts](../../../../../../src/storage/StateMachineStateStorage.ts) | [`INV-SNAPSTORE-1-DPHPJE`](../../../../specification/storage/snapshots-and-states.md#inv-snapstore-1-dphpje) |

## Assumptions, dependencies, trust boundaries, and limits

- Encoded states can be large; retention follows the shared obligation rules.
- In-memory medium for this protocol version: durability across restart is not yet provided; the
  target contract is [durability.md](../../../../specification/storage/durability.md).

## Specification adherence

- Exact content addressing with explicit absence ([`INV-SNAPSTORE-1-DPHPJE`](../../../../specification/storage/snapshots-and-states.md#inv-snapstore-1-dphpje)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                      | Implementation status | Evidence                                                                                                                           | Gap / divergence |
| ------------------------------------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-SNAPSTORE-1-DPHPJE`](../../../../specification/storage/snapshots-and-states.md#inv-snapstore-1-dphpje) | Covered               | **Here:** keccak-or-caller keying, exact byte round trips ([#L20](../../../../../../src/storage/StateMachineStateStorage.ts#L20)). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                                | Obligation         | Public entry and setup                                    | Oracle and forbidden effects                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-state-machine-state-storage-1-e4m0k6"></a>`UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6` | Content addressing | Store states with computed and supplied hashes; read back | Byte-exact round trips; computed key equals keccak; absence explicit | <a id="unit-test-state-machine-state-storage-1-e4m0k6.p1"></a>`UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P1` — computed-hash round trip; <a id="unit-test-state-machine-state-storage-1-e4m0k6.p2"></a>`UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P2` — caller-hash round trip; <a id="unit-test-state-machine-state-storage-1-e4m0k6.p3"></a>`UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P3` — absent key; <a id="unit-test-state-machine-state-storage-1-e4m0k6.p4"></a>`UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P4` — empty state bytes; <a id="unit-test-state-machine-state-storage-1-e4m0k6.p5"></a>`UNIT-TEST-STATE-MACHINE-STATE-STORAGE-1-E4M0K6.P5` — large state bytes |

## Related source reports

- [StateSnapshotStorage](./StateSnapshotStorage.ts.md), [Storage.ts](./Storage.ts.md) (genesis-state join).
