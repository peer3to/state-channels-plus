# EventSyncService.ts — Source Report

> **Source:** [src/stateManager/EventSyncService.ts](../../../../../../src/stateManager/EventSyncService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

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

Chain-observation intake: schedules event logs in per-channel order, records processed progress
(monotone), recovers missed calldata and dispute commitments by bounded targeted queries
(`tryRecoverBlockCalldataAndScheduleValidation`, `loadSynchronizedWindowCommitments` — widening
spans, capped attempts), and replays events after restart from the progress marker.

## Key design decisions

1. **Processed-then-marked ordering:** progress advances only after handling, so restart re-processing is safe-by-idempotence rather than skipped ([`REQ-RMSTORE-1-BWKVBG`](../../../../specification/storage/progress-markers.md#req-rmstore-1-bwkvbg)).
2. **Targeted recovery, never trust-by-absence:** a reducer's window is loaded from chain queries until local records back every commitment ([`REQ-MIRROR-3-THD7K8`](../../../../specification/enforcement/local-mirror.md#req-mirror-3-thd7k8)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                     |
| ------------ | -------------------------------------------- |
| Inputs       | Provider logs/events; recovery requests.     |
| Outputs      | Dispatched handler calls; recovered records. |
| Owned state  | Scheduling queues; progress via storage.     |
| Side effects | Provider queries.                            |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                   | Specification IDs                                                                        |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [EventSyncService.ts](../../../../../../src/stateManager/EventSyncService.ts) | [`REQ-STOR-3-4RJGER`](../../../../specification/storage/durability.md#req-stor-3-4rjger) |

## Assumptions, dependencies, trust boundaries, and limits

- Single-provider observation inherits the trust model's RPC assumption.

## Specification adherence

- Observed intake re-enters owner validation; recovery is bounded and explicit ([`REQ-STOR-3-4RJGER`](../../../../specification/storage/durability.md#req-stor-3-4rjger) consumer side).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                            | Implementation status | Evidence                                                                                                                                                                                                                                             | Gap / divergence                                                                                                                                       |
| -------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`REQ-STOR-3-4RJGER`](../../../../specification/storage/durability.md#req-stor-3-4rjger)           | Covered               | **Here:** replay-from-marker with idempotent handlers; bounded recovery. **Other files:** [EventSyncStorage](../storage/EventSyncStorage.ts.md); handlers in [EventHandler](../eventHandlers/EventHandler.ts.md).                                    | None.                                                                                                                                                  |
| [`REQ-IX-7-A004VZ`](../../../../specification/runtime/README.md#req-ix-7-a004vz)                   | Covered               | **Here:** ordered observation with bounded recovery; observed intake re-enters owner validation. **Other files:** [StateChannelEventListener](../StateChannelEventListener.ts.md), [EventHandler](../eventHandlers/EventHandler.ts.md).              | Single-provider observation (trust-model A6); [`DEF-2-SHQR0A`](../../../../audit/open-findings.md#def-2-shqr0a) event-set gap tracked at the listener. |
| [`REQ-MIRROR-3-THD7K8`](../../../../specification/enforcement/local-mirror.md#req-mirror-3-thd7k8) | Covered               | **Here:** targeted chain recovery when local records cannot back a decision. **Other files:** chain re-checks at decision sites — [DisputeValidationService](./DisputeValidationService.ts.md), [StateManager](./StateManager.ts.md) timeout checks. | None.                                                                                                                                                  |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                              | Obligation            | Public entry and setup                                                                | Oracle and forbidden effects                                                                | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-event-sync-service-1-0fb8y4"></a>`UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4` | Ordering and recovery | Deliver logs out of order; drop events; restart mid-stream; exhaust recovery attempts | Per-channel order preserved; recovery fills gaps within caps; restart resumes without skips | <a id="unit-test-event-sync-service-1-0fb8y4.p1"></a>`UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P1` — ordering; <a id="unit-test-event-sync-service-1-0fb8y4.p2"></a>`UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P2` — gap recovery within attempts; <a id="unit-test-event-sync-service-1-0fb8y4.p3"></a>`UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P3` — restart resume; <a id="unit-test-event-sync-service-1-0fb8y4.p4"></a>`UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P4` — recovery exhaustion behavior |

## Related source reports

- [StateChannelEventListener](../StateChannelEventListener.ts.md), [EventHandler](../eventHandlers/EventHandler.ts.md), [EventSyncStorage](../storage/EventSyncStorage.ts.md).
