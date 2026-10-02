# test/V1/StateChannelDiamondProxy/FraudProofFacetPrunedInbound.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/FraudProofFacetPrunedInbound.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacetPrunedInbound.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [FraudProofFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A Foundry suite on the deployed, routed diamond (`DiamondHarness.deployDiamond()`). `setUp` opens a
two-participant channel, lands two genuine deposits A then B through `depositAssetsComposable`,
and adopts B through `updateStateSnapshotSameFork`, expecting the `ChannelStorageCleared` event for
B's hash, so A, B and every ancestor are pruned from the inbound map. It then asserts the snapshot's
inbound head is B and that A sits one below it. Each case submits a forged-inbound proof built from
an author-signed block that carries the cited inbound block, and checks the slash set through
`isParticipantSlashedOnChain` for the author, the eligible participant and an outsider.

Pruned genuine blocks, from an outsider or an eligible submitter, and the snapshot head itself at
height S revert `RaceConditionBlockHeightTooOld(S, height)` with the exact payload, and nobody is
slashed. Above S, a genuine stored block one above the head slashes the eligible false prover and
not the author, and a fabricated block one above the head slashes the author. One fuzz case spans
the full `uint256` height range of a fabricated block with either submitter: refused at or below S,
the author slashed above it. Another fuzzes which pruned genuine block and which submitter. The
nested dispute route commits a real dispute whose state proof is one block carrying the cited
inbound block: for a pruned genuine block the dispute-fraud proof reverts, the commitment stays,
and nobody is slashed; for a fabricated block above S the disputer is killed and slashed and the
dispute commitment is removed. A last case runs `reduce` over a dispute committed after the
adoption, with no newer inbound, and checks that the output keeps B's hash and S as its inbound
height.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                    | Covers                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`test_applyFraudProofs_prunedGenuineInboundFromOutsider_revertsAndSlashesNobody`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacetPrunedInbound.t.sol#L60) (line 60)          | [`INV-ENFFP-1-BGVZN4.T1.P14`](../../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p14), [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P17`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p17)                        |
| [`test_applyFraudProofs_prunedGenuineInboundFromEligibleSubmitter_revertsAndSlashesNobody`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacetPrunedInbound.t.sol#L67) (line 67) | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P18`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p18)                                                                                                                                             |
| [`test_applyFraudProofs_snapshotHeadInboundAtHeightS_revertsAndSlashesNobody`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacetPrunedInbound.t.sol#L74) (line 74)              | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P19`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p19)                                                                                                                                             |
| [`test_applyFraudProofs_genuineInboundAtHeightSPlusOne_slashesSubmitterNotAuthor`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacetPrunedInbound.t.sol#L81) (line 81)          | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P20`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p20)                                                                                                                                             |
| [`test_applyFraudProofs_forgedInboundAtHeightSPlusOne_slashesAuthor`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacetPrunedInbound.t.sol#L91) (line 91)                       | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P21`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p21)                                                                                                                                             |
| [`testFuzz_applyFraudProofs_fabricatedInboundJudgedOnlyAboveSnapshotHead`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacetPrunedInbound.t.sol#L101) (line 101)                | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P22`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p22)                                                                                                                                             |
| [`testFuzz_applyFraudProofs_prunedGenuineInboundNeverSlashes`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacetPrunedInbound.t.sol#L123) (line 123)                            | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P23`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p23)                                                                                                                                             |
| [`test_applyDisputeFraudProofs_prunedGenuineInboundInStateProof_revertsAndKeepsDispute`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacetPrunedInbound.t.sol#L132) (line 132)  | [`INV-ENFFP-1-BGVZN4.T1.P17`](../../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p17), [`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P38`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md#unit-test-dispute-fraud-proof-facet-1-qk8hq7.p38) |
| [`test_applyDisputeFraudProofs_forgedInboundAboveSnapshotHeadInStateProof_killsDisputer`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacetPrunedInbound.t.sol#L142) (line 142) | [`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P39`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md#unit-test-dispute-fraud-proof-facet-1-qk8hq7.p39)                                                                                                                      |
| [`test_reduce_afterSameForkPrune_keepsSnapshotInboundHeight`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacetPrunedInbound.t.sol#L154) (line 154)                             | [`UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P28`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol.md#unit-test-dispute-verification-facet-1-pvckn3.p28)                                                                                                                  |
