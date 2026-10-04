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

The force-join marker stores the base-layer block height at which the node started its join, the deadline
of the join authorization it submitted, and whether a force-join bound already fired (the dispute was
requested, or the chain's expired evidence period refused it). The fired flag supports deferred eligibility
checks without a duplicate or retried dispute; the deadline tells the membership owner whether the join can
still land. It also holds the block trigger's grace state: the joiner `Clock` time from which a block it
commits counts (`countingStartsAt`) and the counting start height, the first counted block (`countingFromHeight`).

## Key design decisions

1. **Set/read/clear with explicit absence.** `undefined` means no pending submission
   ([#L4](../../../../../../src/storage/ForceJoinStorage.ts#L4)); `clear()` returns to it.
2. **Fired is separate from eligible.** Deferred checks retain the height with `boundFired === false`
   ([#L12](../../../../../../src/storage/ForceJoinStorage.ts#L12)). The membership owner sets the flag when it requests the dispute and when the chain refuses it
   ([#L46-L52](../../../../../../src/storage/ForceJoinStorage.ts#L46-L52)); `clear()` resets every field.
3. **Grace state and the authorization deadline are plain storage; the policy lives in the membership
   owner.** `joinAuthorizationDeadline`, `countingStartsAt` and `countingFromHeight` ([#L6](../../../../../../src/storage/ForceJoinStorage.ts#L6), [#L8](../../../../../../src/storage/ForceJoinStorage.ts#L8), [#L10](../../../../../../src/storage/ForceJoinStorage.ts#L10)) are
   absent until set and have plain setters and getters ([#L22-L44](../../../../../../src/storage/ForceJoinStorage.ts#L22-L44)). `MembershipService` records the deadline
   at submission, decides when the grace starts and when a block becomes the counting start height, and
   judges the deadline against chain time. `clear()` resets all of them with the submission height and the
   fired flag ([#L54-L60](../../../../../../src/storage/ForceJoinStorage.ts#L54-L60)), so a later join starts fresh
   ([`REQ-RMSTORE-2-Y2T1PG` (Explicit intent lifecycle)](../../../../specification/storage/progress-markers.md#req-rmstore-2-y2t1pg)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Submission height, join authorization deadline, grace start time and counting start height, and the fired transition. |
| Outputs      | Each value or explicit absence, plus the fired state.                                                                 |
| Owned state  | `joinSubmissionBlockHeight`, `joinAuthorizationDeadline`, `countingStartsAt`, `countingFromHeight` and `boundFired`.  |
| Side effects | None.                                                                                                                 |

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

| Requirement / invariant                                                                                                                 | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Gap / divergence |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RMSTORE-2-Y2T1PG`](../../../../specification/storage/progress-markers.md#req-rmstore-2-y2t1pg)                                    | Covered               | **Here:** set/read/clear with `undefined` absence ([#L4](../../../../../../src/storage/ForceJoinStorage.ts#L4)); the authorization deadline, counting start time and height are absent until set ([#L6](../../../../../../src/storage/ForceJoinStorage.ts#L6), [#L8](../../../../../../src/storage/ForceJoinStorage.ts#L8), [#L10](../../../../../../src/storage/ForceJoinStorage.ts#L10)) and `clear` resets them with the submission height and the fired flag ([#L54-L60](../../../../../../src/storage/ForceJoinStorage.ts#L54-L60)). **Other files:** [ForceExitStorage](./ForceExitStorage.ts.md) covers the exit half; the N+1 trigger and the seating clear — [MembershipService](../stateManager/membership/MembershipService.ts.md). | None.            |
| [`INV-MEMBERSHIP-PENDING-1-2H1T75`](../../../../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75) | Covered               | **Here:** the submission height survives deferred eligibility and a separate fired flag prevents a second or retried dispute ([#L46-L52](../../../../../../src/storage/ForceJoinStorage.ts#L46-L52)); the authorization deadline, grace start time and counting start height are kept for the membership owner ([#L22-L44](../../../../../../src/storage/ForceJoinStorage.ts#L22-L44)); `clear` resets all of them ([#L54-L60](../../../../../../src/storage/ForceJoinStorage.ts#L54-L60)). **Other files:** [MembershipService](../stateManager/membership/MembershipService.ts.md) owns authoritative eligibility, the grace, the counting rule, and the join decision.                                                                      | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                              | Obligation       | Public entry and setup                                                                                  | Oracle and forbidden effects                                                                                                                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-force-join-storage-1-e2pcwn"></a>`UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN` | Marker lifecycle | Set height and authorization deadline, defer eligibility, fire (start or refuse), clear, and read again | Exact height survives deferral; a fired bound prevents duplicates and retries; grace fields and the deadline read absent until set; clear resets every field | <a id="unit-test-force-join-storage-1-e2pcwn.p1"></a>`UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P1` — read before set; <a id="unit-test-force-join-storage-1-e2pcwn.p2"></a>`UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P2` — set/read/clear cycle; <a id="unit-test-force-join-storage-1-e2pcwn.p3"></a>`UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P3` — repeated clear idempotent; <a id="unit-test-force-join-storage-1-e2pcwn.p5"></a>`UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P5` — the counting start height reads absent before it is set and the recorded height after; <a id="unit-test-force-join-storage-1-e2pcwn.p6"></a>`UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P6` — clear resets the counting start time and height; <a id="unit-test-force-join-storage-1-e2pcwn.p7"></a>`UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P7` — a deferred check retains the height with the bound unfired; a fired bound blocks a duplicate dispute; <a id="unit-test-force-join-storage-1-e2pcwn.p8"></a>`UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P8` — a refused start sets the fired flag and keeps the height, so no later check starts a dispute; <a id="unit-test-force-join-storage-1-e2pcwn.p9"></a>`UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P9` — the authorization deadline reads back as recorded at submission, and clear resets it with the height and the grace fields |

## Related source reports

- [MembershipService](../stateManager/membership/MembershipService.ts.md) (force-join trigger and grace owner), [StateManager](../stateManager/StateManager.ts.md) (composition).
