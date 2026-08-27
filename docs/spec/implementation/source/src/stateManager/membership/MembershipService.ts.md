# MembershipService.ts — Source Report

> **Source:** [src/stateManager/membership/MembershipService.ts](../../../../../../../src/stateManager/membership/MembershipService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [join channel](../../../../views/architecture/sdk/rpc/join-channel.md)

## Responsibility and observable boundary

Owns local membership lifecycle operations and authoritative on-chain participant/threshold reads.
It does not announce membership to peers or control connection admission.

## Key design decisions

1. **Chain observations are authoritative.** A successful join updates local status through the
   existing event/state flow; it sends no peer-supplied admission hint.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                 |
| ------------ | ------------------------------------------------------------------------ |
| Inputs       | Channel IDs, join confirmations, expected snapshot and fork commitments. |
| Outputs      | Participant/threshold sets and join completion or typed failure.         |
| Owned state  | No independent membership cache.                                         |
| Side effects | Join transaction, local status, and force-join bookkeeping.              |

## Linked requirements

| Source file                                                                                   | Specification IDs                                                                                           |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [MembershipService.ts](../../../../../../../src/stateManager/membership/MembershipService.ts) | [`REQ-AUTH-5-BQG9AG`](../../../../../specification/peer-communication/synchronization.md#req-auth-5-bqg9ag) |

## Assumptions, dependencies, trust boundaries, and limits

- Contract reads and confirmed events define membership. Remote claims are not an authority.

## Specification adherence

- No membership-announcement path can bypass local-status handshake admission.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                     | Implementation status | Evidence                                                                                                                               | Gap / divergence |
| ----------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-AUTH-5-BQG9AG`](../../../../../specification/peer-communication/synchronization.md#req-auth-5-bqg9ag) | Covered               | **Here:** join completion has no peer announcement. **Other files:** [P2PManager](../../P2PManager.ts.md) owns local-status admission. | None.            |

## Component test obligations

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [StateManager](../StateManager.ts.md), [P2PManager](../../P2PManager.ts.md).
