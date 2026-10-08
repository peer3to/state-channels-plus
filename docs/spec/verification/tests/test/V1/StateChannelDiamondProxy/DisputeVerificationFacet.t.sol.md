# DisputeVerificationFacet.t.sol

Test file: [test/V1/StateChannelDiamondProxy/DisputeVerificationFacet.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/DisputeVerificationFacet.t.sol)
Exercises: [DisputeVerificationFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol.md)

## Overview

A Foundry suite around the reduction engine and its dispute plumbing, driven through the deployed
diamond (`DiamondHarness`) plus three purpose-built harnesses: `DisputeExpiryGuardHarness`
(seeds dispute windows and on-chain slash sets, and exposes window observation, commitment
counts, the reduced-result commit, the author-not-participant handler and the on-chain-slash-subset
handler), `InboundVerificationHarness` (exposes `StateChannelCommon`'s
internal `_verifyInboundMessageBlocks` walk and its inbound-block store), and
`DisputeOutputStateHarness` (wires the MathStateMachine so public `computeDisputeOutputState` hits
`_calculateRemovals`, and exposes the outbound message dispatch). The oracles
assert: `reduce` never OOB-panics and clamps `slashedParticipants` to the union bound; the
removal/exit algebra of `computeDisputeOutputState` (self-removal, timeout, both in order,
slash-suppresses-timeout, sentinel-preserving shrink) with exact `MESSAGE_TYPE_EXIT` messages
and amounts; `reduceOutputToSnapshotData` participant output under slash/timeout/self-removal
mixes; strict timestamp-cutoff prefixes of the on-chain slash log; block-structure predicates
(bad signature, broken link, skipped height); kill-period expiry gating of
`applyDisputeFraudProofs`/`killDispute` incl. atomic batch revert, one case exactly at the
period end and the others strictly past it so the reported end and call timestamps differ; the upload timeout-window
eligibility gate; the timeout-calldata-posted defense with its first-block grace edge; the
author-not-participant proof family with coordinate-bound snapshots; a full wrong-turn
`BlockInvalidStateTransition` slash; the inbound message-block walk's failure reporting
(break index, running hash, reason code) up to the decoded revert payload; the two
`reduceOutputToSnapshotData` snapshot-linkage gates (genesis fork hash, block-to-snapshot
hash) with both compared values in the revert; a kill attempt on a dispute the window
never committed; the two commitment-set gates, where a substituted dispute at equal length and
an extra dispute beyond the committed set are each matched against both commitment hash arrays
hand-computed from the disputes the test built rather than from the helper under test; the
on-chain-slash-subset proof, where a strict subset in a different order is matched against both
address arrays so equal-count ambiguity cannot hide the omitted slash; and a refused inbound
message during dispute output generation, placed after a real join so the reported state hash
can only be the seed the walk started from, with a sibling case whose refusal sits at a non-zero
block index and a different non-zero message index so the two cannot be swapped. The suite also
covers the reduced-result commit guards on `StateChannelCommon` — a window whose kill period is
still running, and a second commit against an already-reduced window reporting three distinct
forks — plus the reduce-challenge deadline on `challengeDisputeReduction`, the outbound EXIT
balance-agreement check, and the repeated inbound-block persist, each asserting its full revert
payload from distinguishable operands. The permutation pool
has since been atomized into single-scenario IDs (per proof family, per gate revert), and every
one this suite reaches in full is assigned below; families and gates the suite does not exercise
stay unassigned.

## Tests

- `test_reduce_oversizedOnChainSlashes_doesNotPanic`: none
- `test_reduce_snapshotAlreadyPastSlashedSigner_stillFoldsOnChainSlash`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P9
- `testFuzz_reduce_slashedParticipantsNeverExceedsMaxSlashCount`: none
- `test_computeDisputeOutputState_noRemoval_keepsAllParticipantsAndNoExits`: UNIT-TEST-SM-DISPUTE-VERIFICATION-2-DKTKDF.P1
- `test_removePresentRecordsOnlySuccessfulExit`: REQ-SM-8-8CHSQ8.T1.P15
- `test_removeAbsentRecordsOnlySuccessfulExit`: REQ-SM-10-JD8TSF.T1.P4
- `test_removeRepeatedRecordsOnlySuccessfulExit`: REQ-SM-10-JD8TSF.T1.P5
- `test_slashPresentRecordsOnlySuccessfulExit`: REQ-SM-8-8CHSQ8.T1.P16
- `test_slashAbsentRecordsOnlySuccessfulExit`: REQ-SM-10-JD8TSF.T1.P6
- `test_slashRepeatedRecordsOnlySuccessfulExit`: REQ-SM-10-JD8TSF.T1.P7
- `test_computeDisputeOutputState_selfRemovalOnly_removesDisputerAndEmitsExit`: UNIT-TEST-SM-DISPUTE-VERIFICATION-2-DKTKDF.P3
- `test_computeDisputeOutputState_timeoutOnly_removesTimedOutParticipantAndEmitsExit`: none
- `test_computeDisputeOutputState_selfRemovalAndTimeout_removesBothInOrderAndEmitsExits`: UNIT-TEST-SM-DISPUTE-VERIFICATION-2-DKTKDF.P4
- `test_computeDisputeOutputState_slashSuppressesTimeout_keepsTimeoutTargetAndExitsSlashOnly`: none
- `test_staleSnapshotRecordsSlashThenAbsentStateApplicationIsNoOp`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P18
- `test_computeDisputeOutputState_absentSlashPreservesStateAndEmitsNoExit`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P10, REQ-SM-10-JD8TSF.T1.P1
- `test_computeDisputeOutputState_absentRemovalPreservesStateAndEmitsNoExit`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P11, REQ-SM-10-JD8TSF.T1.P2
- `test_reduceOutputToSnapshotData_timeoutOnly_removesTimedOutParticipant`: none
- `test_reduceOutputToSnapshotData_slashOnly_removesSlashedParticipant`: none
- `test_reduceOutputToSnapshotData_slashAndTimeout_ignoresTimeout`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P5
- `test_reduceOutputToSnapshotData_slashTimeoutAndSelfRemoval_ignoresTimeout`: none
- `test_getOnChainSlashedParticipantsUpToTimestamp_returnsStrictPrefixByCutoff`: UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P3, INV-ENFFP-1-BGVZN4.T1.P3
- `test_isInvalidBlockStructure_validOneMilestoneChain_returnsFalse`: none
- `test_isInvalidBlockStructure_invalidSignature_returnsTrue`: none
- `test_isInvalidBlockStructure_brokenLink_returnsTrue`: none
- `test_isInvalidBlockStructure_skippedHeight_returnsTrue`: none
- `test_disputeWindowObservation_distinguishesAbsentActiveAndExpired`: none
- `test_applyDisputeFraudProofs_expiredDispute_reverts`: REQ-ENFFP-2-JXMYNB.T1.P3
- `test_applyDisputeFraudProofs_validNonzeroVerdict_killsDisputer`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P2, REQ-DIS-3-C4KYSF.T1.P1
- `test_applyDisputeFraudProofs_zeroTargetOnHonestDispute_doesNotKill`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P203
- `test_applyDisputeFraudProofs_zeroTargetEveryFamily_neverKills`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P204, REQ-DIS-3-C4KYSF.T1.P22
- `test_killDispute_expiredDispute_reverts`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P22, REQ-ENFDIS-1-8CSA6B.T1.P8
- `test_applyDisputeFraudProofs_mixedBatchWithExpiredItem_revertsAtomically`: none
- `test_uploadDispute_timeoutWindowCreatedBeforeEligibility_reverts`: UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P14
- `test_validateTimeoutCalldataPostedProof_validProof_returnsTrueAndPreservesOriginForkId`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P11
- `test_validateTimeoutCalldataPostedProof_wrongOriginForkId_returnsFalse`: none
- `test_validateTimeoutCalldataPostedProof_firstBlockGraceEdge_valid`: none
- `test_validateTimeoutCalldataPostedProof_pastFirstBlockGrace_invalid`: none
- `test_disputeBlockAuthorNotParticipant_validOutsiderBlock_killsDisputer`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P21
- `test_disputeBlockAuthorNotParticipant_forgedResultingSnapshot_rejected`: none
- `test_disputeBlockAuthorNotParticipant_authorInEitherSnapshot_rejected`: none
- `test_disputeBlockAuthorNotParticipant_authorInStaleResultingSnapshot_valid`: none
- `test_disputeBlockAuthorNotParticipant_authorInWrongForkResultingSnapshot_valid`: none
- `test_disputeBlockAuthorNotParticipant_indexOutsideUnfinalTail_rejected`: none
- `test_blockInvalidStateTransition_wrongTurnWithCorrectSnapshot_slashesSigner`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P6, REQ-ENFFP-2-JXMYNB.T1.P4
- `test_verifyInboundMessageBlocks_linkedChainMatchingTarget_isValid`: none
- `test_verifyInboundMessageBlocks_firstBlockNotChainedToSnapshotHead_reportsHashLinkAtZero`: none
- `test_verifyInboundMessageBlocks_midChainLinkBroken_reportsHashLinkAtBreakIndex`: none
- `test_verifyInboundMessageBlocks_skippedHeight_reportsHeightSequenceWithIntactHashLink`: none
- `test_verifyInboundMessageBlocks_allLinkedButWrongTarget_reportsFinalTargetAtBlockCount`: none
- `test_verifyInboundMessageBlocks_noBlocks_comparesSnapshotHeadAgainstTarget`: none
- `test_reduceOutputToSnapshotData_unlinkedInboundBlocks_revertsCarryingComparedHashes`: none
- `test_reduceOutputToSnapshotData_genesisSnapshotDataNotLinkedToFork_revertsCarryingBothForkIds`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P19
- `test_reduceOutputToSnapshotData_latestBlockNotLinkedToSnapshot_revertsCarryingBothSnapshotHashes`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P20
- `test_killDispute_disputeNotInWindowCommitments_revertsCarryingCommitment`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P21
- `test_reduceAndFinalize_uncommittedDisputeRevertsCarryingBothCommitmentSets`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P23
- `test_challengeDisputeReduction_extraSubmittedDisputeRevertsCarryingBothCommitmentSets`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P24
- `test_handleDisputeOnChainSlashesNotSubset_listedSlashesAreSubsetRevertsCarryingBothSlashSets`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P23
- `test_computeDisputeOutputState_unsupportedInboundMessageRevertsCarryingSeedStateHash`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P25
- `test_computeDisputeOutputState_refusedMessageInLaterBlockRevertsCarryingBothIndices`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P26
- `test_processOutboundMessage_exitAmountDisagreesWithMessageRevertsCarryingBothAmounts`: UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P19
- `test_persistInboundMessageBlock_repeatedBlockRevertsNamingChannelAndBlockHash`: UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P20
- `test_commitToDisputeReducedResult_killPeriodStillRunningRevertsCarryingDeadlineAndCurrentTime`: UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P17, REQ-DIS-4-6J6YYG.T1.P3
- `test_commitToDisputeReducedResult_windowAlreadyReducedRevertsCarryingAllThreeForkIds`: UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P18
- `test_challengeDisputeReduction_afterChallengePeriodRevertsCarryingDeadlineAndCurrentTime`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P27
- `test_commitToDisputeReducedResult_noDisputeWindow_revertsNamingTheMissingWindow`: UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P16
