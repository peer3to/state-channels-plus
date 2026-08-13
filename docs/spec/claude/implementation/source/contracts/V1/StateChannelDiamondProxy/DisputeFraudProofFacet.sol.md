# DisputeFraudProofFacet.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

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

Dispute fraud-proof application: skip already-killed, kill-period-open gate, dispatch across the
17 content/timeout families, valid → kill + slash disputer, invalid → slash submitter; plus the
timeout-evidence view predicates (calldata-posted validation, last-milestone finality, header
mismatch, inbound-hash validity).

## Key design decisions

1. **Kill is the only commitment-removal path**, pairing with the window bookkeeping's swap-removal — the order perturbation input to [`OQ-4-JGDCNX`](../../../../../verification/open-questions.md#oq-4-jgdcnx) originates here.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                              |
| ------------ | ----------------------------------------------------- |
| Inputs       | Routed calls from the manager (delegatecall context). |
| Outputs      | State mutations/verdicts/events per operation group.  |
| Owned state  | None declared (shared layout via inheritance).        |
| Side effects | Events; escrow via consumer where applicable.         |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                            | Specification IDs                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [DisputeFraudProofFacet.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol) | [`REQ-ENFFP-1-BREACW`](../../../../../specification/enforcement/fraud-slashing.md#req-enffp-1-breacw), [`REQ-ENFFP-2-JXMYNB`](../../../../../specification/enforcement/fraud-slashing.md#req-enffp-2-jxmynb), [`REQ-DIS-3-C4KYSF`](../../../../../specification/disputes/disputes.md#req-dis-3-c4kysf) |

## Assumptions, dependencies, trust boundaries, and limits

- Executes only in the manager's delegatecall context (except UtilityFacet's plain calls).
- Deployment-size budget applies per deployable ([architecture view](../../../../views/architecture/contracts/architecture.md) §3 measurements).

## Specification adherence

- Operation semantics per the owning protocol documents; composition rules per [contracts.md](../../../../../specification/enforcement/contracts.md).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                               | Implementation status | Evidence                                               | Gap / divergence |
| ----------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------ | ---------------- |
| [`REQ-DIS-3-C4KYSF`](../../../../../specification/disputes/disputes.md#req-dis-3-c4kysf)              | Covered               | **Here:** kill-during-open-window with disputer slash. | None.            |
| [`REQ-ENFFP-2-JXMYNB`](../../../../../specification/enforcement/fraud-slashing.md#req-enffp-2-jxmynb) | Covered               | **Here:** family dispatch incl. safe rejection.        | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                            | Obligation       | Public entry and setup                                                                               | Oracle and forbidden effects                                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7` | Kill application | Apply each family against valid/invalid disputes at window edges from eligible/ineligible submitters | Valid kills remove + slash; invalid self-slash; closed windows revert; killed disputes skipped | <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p1"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P1` — DisputeNotLatestState family; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p2"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P2` — kill accepted at open window edge; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p3"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P3` — already-killed skip; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p4"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P4` — self-slash branch; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p5"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P5` — timeout predicate parity with auditor preflight; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p6"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P6` — DisputeInvalidOutputState family; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p7"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P7` — DisputeInvalidStateProof family; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p8"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P8` — DisputeInvalidBalanceInvariant family; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p9"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P9` — DisputeOnChainSlashesNotSubset family; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p10"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P10` — TimeoutThreshold family; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p11"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P11` — TimeoutCalldataPosted family; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p12"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P12` — TimeoutNotLinkedToLatestState family; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p13"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P13` — TimeoutParticipantNotNext family; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p14"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P14` — TimeoutTooEarly family; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p15"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P15` — DisputeInvalidBlockInStateProofApplyFraudProof family; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p16"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P16` — DisputeLastMilestoneNotFinalAndNoAuditingData family; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p17"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P17` — InvalidDisputeReason family; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p18"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P18` — DisputeStateProofHeaderMismatch family; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p19"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P19` — DisputeInboundHashNotInChain family; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p20"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P20` — DisputeInvalidBlockStructure family; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p21"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P21` — DisputeBlockAuthorNotParticipant family; <a id="unit-test-dispute-fraud-proof-facet-1-qk8hq7.p22"></a>`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P22` — kill reverts after window closes |

## Related source reports

- [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md), [StateChannelCommon](./StateChannelCommon.sol.md).
