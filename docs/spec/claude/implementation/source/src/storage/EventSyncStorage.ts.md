# EventSyncStorage.ts — Source Report

> **Source:** [src/storage/EventSyncStorage.ts](../../../../../../../src/storage/EventSyncStorage.ts) > **Status:** Authored — engineer verification pending.
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

Per-channel chain-observation progress: the latest base-layer block number whose events the
node has processed — where observation resumes after a gap.

## Key design decisions

1. **Monotone by max().** A store keeps the maximum of retained and incoming ([#L14](../../../../../../../src/storage/EventSyncStorage.ts#L14)); regressions are ignored, so progress can never be talked backward.
2. **Normalized keys.** Channel keys are lowercased ([#L25](../../../../../../../src/storage/EventSyncStorage.ts#L25)) — the identity-normalization rule applied to channel ids so case variance cannot split progress.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                            |
| ------------ | ----------------------------------- |
| Inputs       | (channel, block number).            |
| Outputs      | Latest processed block per channel. |
| Owned state  | `latestProcessedBlocks`.            |
| Side effects | None.                               |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                 | Specification IDs                                                                                                                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [EventSyncStorage.ts](../../../../../../../src/storage/EventSyncStorage.ts) | [`REQ-RMSTORE-1`](../../../../specification/storage/progress-markers.md#req-rmstore-1), [`REQ-ID-2`](../../../../specification/protocol-model/identity.md#req-id-2) |

## Assumptions, dependencies, trust boundaries, and limits

- Producers store only _processed_ positions — a forward-jumped marker would skip events; the store can only prevent regression.
- In-memory medium for this protocol version: durability across restart is not yet provided; the
  target contract is [durability.md](../../../../specification/storage/durability.md).

## Specification adherence

- Monotone per-channel progress ([`REQ-RMSTORE-1`](../../../../specification/storage/progress-markers.md#req-rmstore-1)).
- Normalized key comparison ([`REQ-ID-2`](../../../../specification/protocol-model/identity.md#req-id-2) applied to channel ids).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                | Implementation status | Evidence                                                                                                                                                                                                                          | Gap / divergence |
| -------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RMSTORE-1`](../../../../specification/storage/progress-markers.md#req-rmstore-1) | Covered               | **Here:** max() retention per normalized channel key ([#L14](../../../../../../../src/storage/EventSyncStorage.ts#L14)). **Other files:** processed-only discipline — [EventSyncService](../stateManager/EventSyncService.ts.md). | None.            |
| [`REQ-ID-2`](../../../../specification/protocol-model/identity.md#req-id-2)            | Covered               | **Here:** lowercased channel keys ([#L25](../../../../../../../src/storage/EventSyncStorage.ts#L25)).                                                                                                                             | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                | Obligation                   | Public entry and setup                                                      | Oracle and forbidden effects                                                    | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-event-sync-storage-1"></a>`UNIT-TEST-EVENT-SYNC-STORAGE-1` | Monotone normalized progress | Store increasing, repeated, regressing values with case-variant channel ids | Monotone per channel; regressions ignored; case variants resolve to one channel | <a id="unit-test-event-sync-storage-1.p1"></a>`UNIT-TEST-EVENT-SYNC-STORAGE-1.P1` — advance; <a id="unit-test-event-sync-storage-1.p2"></a>`UNIT-TEST-EVENT-SYNC-STORAGE-1.P2` — regression ignored; <a id="unit-test-event-sync-storage-1.p3"></a>`UNIT-TEST-EVENT-SYNC-STORAGE-1.P3` — case-variant keys unify; <a id="unit-test-event-sync-storage-1.p4"></a>`UNIT-TEST-EVENT-SYNC-STORAGE-1.P4` — per-channel isolation |

## Related source reports

- [EventSyncService](../stateManager/EventSyncService.ts.md) (the producer enforcing processed-only).
