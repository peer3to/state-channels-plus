# ForceJoinStorage.ts — Source Report

> **Source:** [src/storage/ForceJoinStorage.ts](../../../../../../src/storage/ForceJoinStorage.ts) > **Status:** Authored — engineer verification pending.
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

The force-join marker stores the channel block height at which the node started its join and whether the
corresponding force-join dispute has already started. The pair supports deferred eligibility checks without
duplicate dispute submission.

## Key design decisions

Stored submission height is the active channel block height, not a base-layer block number. The record holds submission height, authorization deadline in chain seconds, counting start after observation grace, first counted height and disputeStarted. clear resets all five. MembershipService owns timers and chain reads. See [ForceJoinStorage.ts](../../../../../../src/storage/ForceJoinStorage.ts#L53).

1. **Set/read/clear with explicit absence.** `undefined` means no pending submission
   ([#L3](../../../../../../src/storage/ForceJoinStorage.ts#L3)); `clear()` returns to it.
2. **Started is separate from eligible.** Deferred checks retain the height with `disputeStarted === false`.
   The membership owner flips the flag immediately before its one dispute call; `clear()` resets all tracked fields.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Submission height and dispute-start transition.                                                                           |
| Outputs      | Height or explicit absence, plus dispute-start state.                                                                     |
| Owned state  | `joinSubmissionBlockHeight`, `joinAuthorizationDeadline`, `countingStartsAt`, `countingFromHeight`, and `disputeStarted`. |
| Side effects | None.                                                                                                                     |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                              | Specification IDs                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ForceJoinStorage.ts](../../../../../../src/storage/ForceJoinStorage.ts) | [`REQ-RMSTORE-2-Y2T1PG`](../../../../specification/storage/progress-markers.md#req-rmstore-2-y2t1pg), [`INV-MEMBERSHIP-PENDING-1-2H1T75`](../../../../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75) |

## Assumptions, dependencies, trust boundaries, and limits

- A lost marker delays non-inclusion detection (recovery consequence bounded by the durability rules).
- In-memory medium for this protocol version: durability across restart is not yet provided; the
  target contract is [durability.md](../../../../specification/storage/durability.md).

## Specification adherence

- Explicit lifecycle with distinct absent state ([`REQ-RMSTORE-2-Y2T1PG` (Explicit intent lifecycle)](../../../../specification/storage/progress-markers.md#req-rmstore-2-y2t1pg)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                                                 | Implementation status | Evidence                                                                                                                                                                                                                                                                   | Gap / divergence |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RMSTORE-2-Y2T1PG`](../../../../specification/storage/progress-markers.md#req-rmstore-2-y2t1pg)                                    | Covered               | **Here:** set/read/clear with `undefined` absence ([#L3](../../../../../../src/storage/ForceJoinStorage.ts#L3)). **Other files:** [ForceExitStorage](./ForceExitStorage.ts.md) covers the exit half; the N+1 trigger — [StateManager](../stateManager/StateManager.ts.md). | None.            |
| [`INV-MEMBERSHIP-PENDING-1-2H1T75`](../../../../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75) | Covered               | **Here:** the submission height survives deferred eligibility and a separate started flag prevents a second dispute attempt; `clear` resets both. **Other files:** [MembershipService](../stateManager/membership/MembershipService.ts.md) owns authoritative eligibility. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                              | Obligation       | Public entry and setup                                              | Oracle and forbidden effects                                                                | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-force-join-storage-1-e2pcwn"></a>`UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN` | Marker lifecycle | Set height, defer eligibility, start dispute, clear, and read again | Exact height survives deferral; started state prevents duplicates; clear resets both fields | <a id="unit-test-force-join-storage-1-e2pcwn.p1"></a>`UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P1` — read before set; <a id="unit-test-force-join-storage-1-e2pcwn.p2"></a>`UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P2` — set/read/clear cycle; <a id="unit-test-force-join-storage-1-e2pcwn.p3"></a>`UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P3` — repeated clear idempotent;<br><a id="unit-test-force-join-storage-1-e2pcwn.p5"></a>`UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P5` — An expired real evidence window preserves the pending submission height and leaves disputeStarted false.<br><a id="unit-test-force-join-storage-1-e2pcwn.p6"></a>`UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P6` — A delayed JOIN preserves tracking before inclusion; the later block bound sets disputeStarted and a repeated check does not submit again.<br><a id="unit-test-force-join-storage-1-e2pcwn.p7"></a>`UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P7` — Normal block seating clears the submission height; an in-flight deadline cannot restore the started flag. |

## Related source reports

- [StateManager](../stateManager/StateManager.ts.md) (force-join trigger consumer).
