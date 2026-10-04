# DisputeUtils.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../../views/architecture/contracts/manager-and-facets.md)

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

Free functions for dispute/window accessors, the latest block of a state proof
(`_getLatestBlock`/`_getLatestSignedBlock`), period predicates, `_hasDisputeReason`, the dispute-commitment hash owner `_disputeCommitmentHash`/`_disputeCommitmentHashes`,
and the positional committed-set matching `areDisputesCommitted`.

## Key design decisions

1. **Positional set matching** is where the post-kill order sensitivity ([`OQ-4-JGDCNX` (Dispute-reduction order-independence)](../../../../../../verification/open-questions.md#oq-4-jgdcnx) input) is anchored.
2. **Every period predicate returns its deadline alongside the verdict:**
   `_isEvidencePeriodExpired`, `_isKillPeriodExpired` and `_isReduceChallengePeriodExpired` all
   return `(bool, uint256 periodEnd)`. The caller that reverts on the verdict needs the deadline
   it compared `block.timestamp` against, and recomputing it at the call site would duplicate the
   `+ evidenceTime` arithmetic in every guard. Callers that only need the verdict discard the
   second value.
3. **One owner for the dispute-commitment preimage.**
   [`_disputeCommitmentHash`](../../../../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol#L77)
   is the single definition of `keccak256(abi.encode(dispute))`; everything that pushes a
   commitment, searches the window for one, or reports one in a revert calls it, and
   [`_disputeCommitmentHashes`](../../../../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol#L81)
   maps it over a submitted set. `areDisputesCommitted` compares with the same function, so the
   hashes a commitment-mismatch revert reports are by construction the hashes the comparison
   tested — a second inline copy of the preimage could drift from the committed one and make the
   payload describe a comparison that never happened.

4. **A state proof is milestones only.** `_getLatestSignedBlock` ([#L31](../../../../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol#L31)) returns the last
   block of the last milestone, and no block for an empty proof or an empty last milestone
   ([#L34](../../../../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol#L34)–[#L39](../../../../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol#L39)); it never reverts. An empty proof is the fork genesis, so
   callers rebuild the genesis instead ([StateProofFacet](../StateProofFacet.sol.md)).
   The header-mismatch check is not here any more: it lives in
   [DisputeFraudProofFacet](../DisputeFraudProofFacet.sol.md) (`_hasStateProofHeaderMismatch`), which
   decodes through the utility facet and skips an undecodable block. The former helpers for a trailing signed-block list, the first block of each
   milestone, and the "unfinalized part" of a proof are deleted: the block-pointing fraud proofs
   address a `blockIndex` of the last milestone, bounded to its unfinal tail by
   `isBlockChallengeEligible` ([StateProofFacet](../StateProofFacet.sol.md),
   [DisputeFraudProofFacet](../DisputeFraudProofFacet.sol.md)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents              |
| ------------ | --------------------- |
| Inputs       | Per role above.       |
| Outputs      | Types/helpers/events. |
| Owned state  | None.                 |
| Side effects | None.                 |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                              | Specification IDs                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [DisputeUtils.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol) | [`REQ-ENFDIS-1-8CSA6B`](../../../../../../specification/enforcement/dispute-window.md#req-enfdis-1-8csa6b), [`REQ-DISPUTE-PIPE-9-TDWQPV`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv) |

Contribution in this file: [`REQ-DISPUTE-PIPE-9-TDWQPV` (Existing-window state contributions)](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv). The conformance rows below name this owner and the other required owners.

## Assumptions, dependencies, trust boundaries, and limits

- Declarative/support code; behavior owned by consumers.

## Specification adherence

- Consistent with the owning documents' type/behavior contracts.

## Specification contradictions

None demonstrated.

## Missing behavior

Order-sensitivity of the positional match feeds [`OQ-4-JGDCNX` (Dispute-reduction order-independence)](../../../../../../verification/open-questions.md#oq-4-jgdcnx) — documented, engineer decision pending.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                                 | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Gap / divergence |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-DISPUTE-PIPE-9-TDWQPV`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv) | Covered               | **Here:** [source](../../../../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol#L120) accepts the committed true flag as an additional reason without consulting surviving commitments; false contributes no reason. **Other files:** [DisputeManager.ts](../../../../src/disputeManager/DisputeManager.ts.md) (dispute admission, rollback and construction), [EventSyncService.ts](../../../../src/stateManager/eventSync/EventSyncService.ts.md) (authoritative timestamped slash recovery), [DisputeManagerFacet.sol](../DisputeManagerFacet.sol.md) (conditional admission before mutation), [DisputeValidationService.ts](../../../../src/stateManager/dispute/DisputeValidationService.ts.md) (all remaining audit checks). | —                |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                    | Obligation                                | Public entry and setup                                                                                                                                                           | Oracle and forbidden effects                                                                                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-dispute-utils-1-30fxam"></a>`UNIT-TEST-DISPUTE-UTILS-1-30FXAM` | Canonical dispute reason and latest block | Call the pure shared reason validator with each reason and participant eligibility, and `_getLatestSignedBlock` with an empty proof and with last milestones of n confirmations. | Only the accepted-window flag or an independently valid reason permits the claim; the latest block is the last block of the last milestone or none, without a revert. | <a id="unit-test-dispute-utils-1-30fxam.p1"></a>`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P1` — false alone is no reason; <a id="unit-test-dispute-utils-1-30fxam.p2"></a>`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P2` — true alone supplies reason without self-removal; <a id="unit-test-dispute-utils-1-30fxam.p3"></a>`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P3` — false preserves timeout; <a id="unit-test-dispute-utils-1-30fxam.p4"></a>`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P4` — false preserves self-removal; <a id="unit-test-dispute-utils-1-30fxam.p5"></a>`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P5` — false preserves forced-inbound evidence; <a id="unit-test-dispute-utils-1-30fxam.p6"></a>`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P6` — false requires every slash entry to be eligible; <a id="unit-test-dispute-utils-1-30fxam.p7"></a>`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P7` — `_getLatestSignedBlock` of an empty proof reports no block; <a id="unit-test-dispute-utils-1-30fxam.p8"></a>`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P8` — `_getLatestSignedBlock` never reverts: for a last milestone with n confirmations it returns its last block, and no block when n is 0 |

## Related source reports

- Consumers per the manager and state-machine-base views.
