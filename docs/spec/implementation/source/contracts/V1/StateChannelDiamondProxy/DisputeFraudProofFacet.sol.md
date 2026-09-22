# DisputeFraudProofFacet.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

## Requirements

- [`REQ-ENFFP-1-BREACW` (Symmetric stake on submission)](../../../../../specification/enforcement/fraud-slashing.md#req-enffp-1-breacw)
- [`REQ-ENFFP-2-JXMYNB` (Proof-type completeness at the boundary)](../../../../../specification/enforcement/fraud-slashing.md#req-enffp-2-jxmynb)
- [`REQ-DIS-3-C4KYSF` (An uploaded dispute records its commitment immediately)](../../../../../specification/disputes/disputes.md#req-dis-3-c4kysf)
- [`REQ-DIS-1-XAJ1VA` (A dispute MUST state at least one of the five valid inputs)](../../../../../specification/disputes/disputes.md#req-dis-1-xaj1va)
- [`REQ-DIS-10-SAHJBN` (Timeout claims MUST satisfy the deadline, linkage, schedule, and existence…)](../../../../../specification/disputes/disputes.md#req-dis-10-sahjbn)
- [`REQ-FP-5-ZXW0J5` (A dispute may list any subset of recorded slashes)](../../../../../specification/disputes/fraud-proofs.md#req-fp-5-zxw0j5)
- [`REQ-FP-6-TS1QAV` (An invalid fraud-proof submission slashes its submitter when the submitter is…)](../../../../../specification/disputes/fraud-proofs.md#req-fp-6-ts1qav)
- [`REQ-FP-7-4DD0D7` (A valid dispute fraud proof applied within the kill period kills the committed…)](../../../../../specification/disputes/fraud-proofs.md#req-fp-7-4dd0d7)
- [`REQ-DA-2-KYZ70M` (The specification of any timing-sensitive rule MUST state which of these…)](../../../../../specification/security/data-availability.md#req-da-2-kyz70m)
- [`INV-TRUST-1-6TYWDH` (Every safety-relevant disagreement MUST be resolvable by the chain from…)](../../../../../specification/security/trust-model.md#inv-trust-1-6tywdh)
- [`REQ-TRUST-1-K5PS99` (Version one uses only objective, deterministic, mathematically verifiable)](../../../../../specification/security/trust-model.md#req-trust-1-k5ps99)

## UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7

Kill application

- Setup: Apply each family against valid/invalid disputes at window edges from eligible/ineligible submitters
- Oracle: Valid kills remove + slash; invalid self-slash; closed windows revert; killed disputes skipped

- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P1` — DisputeNotLatestState family
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P2` — kill accepted at open window edge
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P3` — already-killed skip
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P4` — self-slash branch
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P5` — timeout predicate parity with auditor preflight
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P6` — DisputeInvalidOutputState family
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P7` — DisputeInvalidStateProof family
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P8` — DisputeInvalidBalanceInvariant family
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P9` — DisputeOnChainSlashesNotSubset family
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P10` — TimeoutThreshold family
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P11` — TimeoutCalldataPosted family
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P12` — TimeoutNotLinkedToLatestState family
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P13` — TimeoutParticipantNotNext family
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P14` — TimeoutTooEarly family
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P15` — DisputeInvalidBlockInStateProofApplyFraudProof family
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P16` — DisputeLastMilestoneNotFinalAndNoAuditingData family
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P17` — InvalidDisputeReason family
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P18` — DisputeStateProofHeaderMismatch family
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P19` — DisputeInboundHashNotInChain family
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P20` — DisputeInvalidBlockStructure family
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P21` — DisputeBlockAuthorNotParticipant family
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P22` — kill reverts after window closes
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P23` — a DisputeOnChainSlashesNotSubset proof whose listed slashes are all recorded on chain reverts `RaceConditionOnChainSlashes` naming both address arrays, not their sizes
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P24` — a TimeoutTooEarly proof on a genesis fork the chain cannot date reverts `RaceConditionGenesisTimestampNotAvailable` naming channel, origin fork and target fork
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P25` — a TimeoutTooEarly proof that denies an on-chain timestamp for a previous block whose calldata is posted reverts `RaceConditionUnexpectedBlockCalldataPosted` naming that block's fork, height, author and stored commitment
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P26` — the same undatable genesis reached through `validateTimeoutCalldataPostedProof` reverts `RaceConditionGenesisTimestampNotAvailable` naming channel, origin fork and target fork
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P27` — `validateTimeoutCalldataPostedProof` with a posted previous block and no claimed timestamp for it reverts `RaceConditionUnexpectedBlockCalldataPosted` naming the previous block's fork, height, author and stored commitment rather than the timed-out block's
