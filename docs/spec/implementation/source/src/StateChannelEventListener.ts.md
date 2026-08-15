# StateChannelEventListener.ts — Source Report

> **Source:** [src/StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../views/architecture/sdk/components.md)

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

The provider-event subscription: registers for manager events and forwards logs into the event
sync scheduler in arrival order.

## Key design decisions

1. **Thin by design** — ordering/recovery discipline lives in the sync service, not the listener.

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | Per role above. |
| Side effects | Per role above. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                     | Specification IDs                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts) | [`REQ-STOR-3-4RJGER`](../../../specification/storage/durability.md#req-stor-3-4rjger) |

## Assumptions, dependencies, trust boundaries, and limits

- Operates inside the participant runtime; untrusted input arrives only through the documented ingress paths.

## Specification adherence

- Role-consistent with the owning views; no divergence observed at this file's boundary.

## Specification contradictions

None demonstrated.

## Missing behavior

**[`DEF-2-SHQR0A`](../../../audit/open-findings.md#def-2-shqr0a) anchor:** `OutboundMessagesProcessed` is absent from the dispatched-event set — local withdrawal accounting can go stale ([open-findings](../../../audit/open-findings.md)).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [EventSyncService](./stateManager/EventSyncService.ts.md), [EventHandler](./eventHandlers/EventHandler.ts.md).
