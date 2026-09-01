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

| Unit test ID                                                                                                  | Obligation                               | Public entry and setup                                                            | Oracle and forbidden effects                                                        | Required permutations                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-state-channel-event-listener-1-xhnmvw"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW` | Mode-specific channel-listener ownership | Install a selected-channel filter, then run targeted or ordinary unsigned cleanup | Targeted cleanup retains exact-target delivery; ordinary cleanup removes the filter | <a id="unit-test-state-channel-event-listener-1-xhnmvw.p1"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P1` — retained same-target subscription and event delivery; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p2"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P2` — ordinary clear removes the filter |

## Related source reports

- [EventSyncService](./stateManager/eventSync/EventSyncService.ts.md), [EventHandler](./eventHandlers/EventHandler.ts.md).

## Targeted listener ownership

Targeted selection installs the existing provider subscription before pre-open matching. Unsigned targeted
cleanup retains it, so later `ChannelOpened(target)` still reaches the live runtime. Ordinary derived-ID
cleanup calls `clearChannelId` and removes the filter. Obligations use
[`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P1`](StateChannelEventListener.ts.md#unit-test-state-channel-event-listener-1-xhnmvw.p1) for retained same-target delivery and `.P2` for ordinary
clear.
