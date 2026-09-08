# index.ts — Source Report

> **Source:** [src/stateManager/membership/index.ts](../../../../../../../src/stateManager/membership/index.ts)  
> **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Mechanical re-export boundary for membership lifecycle services.

## Linked requirements

| Source file | Specification IDs |
| --- | --- |
| [index.ts](../../../../../../../src/stateManager/membership/index.ts) | [`REQ-TJOIN-7-NNGTAY`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay), [`REQ-LIF-10-QR8NQ9`](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9) |

## Specification adherence

- Re-exports `MembershipService` and `LeaveChannelService`; it owns no state or runtime behavior.

## Conformance traceability

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| --- | --- | --- | --- |
| [`REQ-TJOIN-7-NNGTAY`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay) | Covered | **Here:** exports the terminal leave owner. **Other files:** [LeaveChannelService.ts](./LeaveChannelService.ts.md) owns behavior. | None. |
| [`REQ-LIF-10-QR8NQ9`](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9) | Covered | **Here:** makes the leave lifecycle service available to `StateManager`. **Other files:** [StateManager.ts](../StateManager.ts.md) owns composition. | None. |

## Component test obligations

None. This file is a mechanical export boundary.
