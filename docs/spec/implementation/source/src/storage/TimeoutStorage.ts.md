# TimeoutStorage.ts — Source Report

> **Source:** [src/storage/TimeoutStorage.ts](../../../../../../src/storage/TimeoutStorage.ts) > **Status:** Authored — engineer verification pending.
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

At most one timeout candidate per fork, the newest stored, with an identity-matched drop for a candidate the base layer proved moot and an unconditional removal for a candidate the node passed.

## Key design decisions

1. **Newest candidate wins.** A store always adopts the incoming candidate
   ([#L21](../../../../../../src/storage/TimeoutStorage.ts#L21)). The node stores only at its next height, so a retained lower candidate
   names a height it already passed and must not block the live one. Equal height replaces
   (refreshing evidence context for the same slot). The protocol's lowest-timed-out-height
   precedence is enforced on chain and by dispute construction attaching only the proof's next
   height ([`REQ-TOSTORE-3-H0MH84` (Newest timeout candidate)](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-3-h0mh84)).

2. **A drop matches identity.** `deleteTimeout` removes the retained candidate only when the
   passed candidate has the same height and participant and the retained one is not forced
   ([#L31](../../../../../../src/storage/TimeoutStorage.ts#L31)), so a forced candidate stored
   between submission and refusal survives and no unrelated slot is cleared.

3. **Removal of a passed candidate.** `removeTimeout` removes the retained candidate, forced
   included ([#L26](../../../../../../src/storage/TimeoutStorage.ts#L26)). Its only caller is dispute
   construction in [DisputeManager](../disputeManager/DisputeManager.ts.md), when the candidate's
   height is below the proof's next height
   ([`REQ-DISPUTE-PIPE-13-R2QJZN` (Time out only the next height)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-13-r2qjzn)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                            |
| ------------ | ------------------------------------------------------------------- |
| Inputs       | (fork, timeout struct) for store and for the identity-matched drop. |
| Outputs      | Candidate per fork or explicit absence.                             |
| Owned state  | `timeouts` fork → struct.                                           |
| Side effects | None.                                                               |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                          | Specification IDs                                                                                                                                                                                                    |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [TimeoutStorage.ts](../../../../../../src/storage/TimeoutStorage.ts) | [`REQ-TOSTORE-3-H0MH84`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-3-h0mh84), [`REQ-TOSTORE-2-WX7VMH`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-2-wx7vmh) |

## Assumptions, dependencies, trust boundaries, and limits

- Holds a candidate, not a claim: validity and submission decisions live with dispute processing.
- In-memory medium for this protocol version: durability across restart is not yet provided; the
  target contract is [durability.md](../../../../specification/storage/durability.md).

## Specification adherence

- Newest-candidate store per fork ([`REQ-TOSTORE-3-H0MH84` (Newest timeout candidate)](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-3-h0mh84)).
- Identity-matched drop of a refused candidate ([`REQ-TOSTORE-2-WX7VMH` (Drop a refused candidate by identity)](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-2-wx7vmh)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                   | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                             | Gap / divergence |
| --------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-TOSTORE-3-H0MH84`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-3-h0mh84) | Covered               | **Here:** every store adopts the incoming candidate ([#L21](../../../../../../src/storage/TimeoutStorage.ts#L21)). **Other files:** the only producer stores at the next height under the state mutex — [ParticipantTimeoutService](../stateManager/chainFallback/ParticipantTimeoutService.ts.md); construction attaches only the next-height candidate — [DisputeManager](../disputeManager/DisputeManager.ts.md). | None.            |
| [`REQ-TOSTORE-2-WX7VMH`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-2-wx7vmh) | Covered               | **Here:** identity-matched drop ([#L31](../../../../../../src/storage/TimeoutStorage.ts#L31)). **Other files:** the only caller is the posted-calldata refusal handler in [DisputeManager](../disputeManager/DisputeManager.ts.md).                                                                                                                                                                                  | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                        | Obligation                               | Public entry and setup                                                                                            | Oracle and forbidden effects                                                                        | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-timeout-storage-2-pv6fvd"></a>`UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD` | Newest-candidate store and identity drop | Store candidates per fork at a lower then a higher height, at the same height, and on two forks; drop by identity | The latest store is retained; forks independent; only the identical non-forced candidate is dropped | <a id="unit-test-timeout-storage-2-pv6fvd.p1"></a>`UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P1` — a later store at a higher height replaces the lower one; <a id="unit-test-timeout-storage-2-pv6fvd.p2"></a>`UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P2` — equal-height store refreshes the candidate; <a id="unit-test-timeout-storage-2-pv6fvd.p3"></a>`UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P3` — per-fork isolation; <a id="unit-test-timeout-storage-2-pv6fvd.p4"></a>`UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P4` — a drop naming the stored non-forced candidate removes it; <a id="unit-test-timeout-storage-2-pv6fvd.p5"></a>`UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P5` — a forced candidate stored over the same slot survives the drop; <a id="unit-test-timeout-storage-2-pv6fvd.p6"></a>`UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P6` — a drop naming another height leaves the candidate; <a id="unit-test-timeout-storage-2-pv6fvd.p7"></a>`UNIT-TEST-TIMEOUT-STORAGE-2-PV6FVD.P7` — a drop naming another participant at the same height leaves the candidate |

## Related source reports

- [StateManager](../stateManager/StateManager.ts.md) (producer), [DisputeManager](../disputeManager/DisputeManager.ts.md) (consumer at construction).
