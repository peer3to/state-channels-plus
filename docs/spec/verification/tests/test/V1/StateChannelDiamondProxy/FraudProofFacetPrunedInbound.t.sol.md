# FraudProofFacetPrunedInbound.t.sol

Test file: [test/V1/StateChannelDiamondProxy/FraudProofFacetPrunedInbound.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacetPrunedInbound.t.sol)
Exercises: [FraudProofFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md)

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
nested dispute route commits a real dispute whose last milestone is a protected first block followed by one
block carrying the cited inbound block (`blockIndex: 1`): for a pruned genuine block the dispute-fraud proof reverts, the commitment stays,
and nobody is slashed; for a fabricated block above S the disputer is killed and slashed and the
dispute commitment is removed. A last case runs `reduce` over a dispute committed after the
adoption, with no newer inbound, and checks that the output keeps B's hash and S as its inbound
height.

Three further cases read the routed view `isUncommittedInboundMessageBlock` for the pruned block
A, the pruned head B, a stored deposit C one above the head and a fabricated block one above the
head (only the last is true), and run `reduce` on both other walk outcomes: a dispute after a
stored deposit C above the head returns C's hash and S+1, and a deposit that lands after the
window's expiry is stepped over so the output is B's hash and S.

## Tests

- `test_applyFraudProofs_prunedGenuineInboundFromOutsider_revertsAndSlashesNobody`: INV-ENFFP-1-BGVZN4.T1.P14, UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P26
- `test_applyFraudProofs_prunedGenuineInboundFromEligibleSubmitter_revertsAndSlashesNobody`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P27
- `test_applyFraudProofs_snapshotHeadInboundAtHeightS_revertsAndSlashesNobody`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P28
- `test_applyFraudProofs_genuineInboundAtHeightSPlusOne_slashesSubmitterNotAuthor`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P29
- `test_applyFraudProofs_forgedInboundAtHeightSPlusOne_slashesAuthor`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P30
- `testFuzz_applyFraudProofs_fabricatedInboundJudgedOnlyAboveSnapshotHead`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P31
- `testFuzz_applyFraudProofs_prunedGenuineInboundNeverSlashes`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P32
- `test_applyDisputeFraudProofs_prunedGenuineInboundInStateProof_revertsAndKeepsDispute`: INV-ENFFP-1-BGVZN4.T1.P19, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P214
- `test_applyDisputeFraudProofs_forgedInboundAboveSnapshotHeadInStateProof_killsDisputer`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P215
- `test_reduce_afterSameForkPrune_keepsSnapshotInboundHeight`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P31
- `test_isUncommittedInboundMessageBlock_judgesOnlyAbsentBlocksAboveSnapshotHead`: UNIT-TEST-UTILITY-FACET-2-89EC3Q.P10
- `test_reduce_storedInboundAboveSnapshotHead_keepsItsHeight`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P32
- `test_reduce_inboundAfterWindowExpiry_fallsBackToSnapshotHeight`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P33
