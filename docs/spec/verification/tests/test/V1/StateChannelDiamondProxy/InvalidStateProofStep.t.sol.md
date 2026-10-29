# InvalidStateProofStep.t.sol

Test file: [test/V1/StateChannelDiamondProxy/InvalidStateProofStep.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/InvalidStateProofStep.t.sol)

## Overview

Challenges individual milestone steps with optional block pointers. Cases distinguish the pointed fault from faults elsewhere and check submitter or challenger slashes and commitment retention.

## Tests

- `test_U99_skippedMilestoneAfterAKeptOneKillsAtThatStep`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P80
- `test_U99_validFirstStepOfAProofWithASkipAfterAKeptMilestoneIsRejected`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P81
- `test_U99_anchorBlockCommittingAnotherSnapshotKillsTheAnchorRunStep`: REQ-FP-7-4DD0D7.T3.P3, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P82
- `test_U99_genesisBlockZeroNotLinkedToTheGenesisKillsItsStep`: REQ-FP-7-4DD0D7.T3.P4, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P83
- `test_U99_missingThresholdKillsThroughTheMilestonePointer`: REQ-FP-7-4DD0D7.T2.P23, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P59
- `test_U99_hopWhoseInboundRunTheChainDoesNotHoldKillsItsStep`: REQ-FP-7-4DD0D7.T2.P24, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P60
- `test_U99_milestoneStartingBelowThePreviousOneKillsItsStep`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P84
- `test_U99_postedSnapshotItsBlockDoesNotCommitKillsThatStep`: REQ-FP-7-4DD0D7.T2.P25, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P61
- `test_U99_postedHonestProofIsNotKilledAtAnyStep`: REQ-FP-7-4DD0D7.T3.P6, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P85
- `test_U99_undecodableBlockKillsThroughTheBlockPointer`: REQ-FP-7-4DD0D7.T2.P26, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P62
- `test_U99_brokenLinkKillsThroughTheBlockPointer`: REQ-FP-7-4DD0D7.T2.P27, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P63
- `test_U99_blockOnAnotherForkKillsThroughTheBlockPointer`: REQ-FP-7-4DD0D7.T2.P28, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P64
- `test_U99_blockOnAnotherChannelKillsThroughTheBlockPointer`: REQ-FP-7-4DD0D7.T2.P29, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P65
- `test_U99_wrongAuthorSignatureKillsThroughTheBlockPointer`: REQ-FP-7-4DD0D7.T2.P30, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P66
- `test_U99_unrecoverableConfirmationSignatureKillsThroughTheBlockPointer`: REQ-FP-7-4DD0D7.T2.P31, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P67
- `test_U99_validBlockOfARunWithABrokenLinkIsRejected`: REQ-FP-7-4DD0D7.T2.P32, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P68
- `test_U99_brokenLinkBelowTheAnchorBlockIsNoFault`: REQ-FP-7-4DD0D7.T2.P33, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P69
- `test_U111_genuinePreviousSnapshotOfTheMiddleHopKills`: REQ-FP-7-4DD0D7.T3.P7, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P86
- `test_U111_substitutedPreviousSnapshotOfTheMiddleHopIsRejected`: REQ-FP-7-4DD0D7.T3.P8, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P87
- `test_U111_joinInsideTheHopsInboundIntervalWithoutTheJoinersSignatureKills`: REQ-FP-7-4DD0D7.T3.P9, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P88
- `test_U111_joinAfterTheHopsInboundIntervalCannotBeClaimedWithASubstitutedSnapshot`: REQ-FP-7-4DD0D7.T3.P10, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P89
- `test_U111_substitutedPreviousSnapshotWideningTheInboundIntervalIsRejected`: REQ-FP-7-4DD0D7.T3.P11, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P90
- `test_U99_stepAfterTheAnchorRunWithTheAnchorMidMilestoneStartsAtTheAnchor`: REQ-FP-7-4DD0D7.T3.P12, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P91
- `test_U99_stepAfterAWhollySkippedMilestoneStartsAtTheAnchor`: REQ-FP-7-4DD0D7.T3.P13, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P92
- `test_U99_blockPointerIntoAWhollySkippedMilestoneIsNoFault`: REQ-FP-7-4DD0D7.T3.P14, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P93
- `test_U99_blockPointerPastTheMilestoneIsNoFault`: REQ-FP-7-4DD0D7.T3.P15, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P94
- `test_U99_blockPointerAtTheSecondMilestoneWithItsGenuinePreviousSnapshotKills`: REQ-FP-7-4DD0D7.T3.P16, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P95
- `test_U99_blockPointerAtTheSecondMilestoneWithASubstitutedPreviousSnapshotIsRejected`: REQ-FP-7-4DD0D7.T3.P17, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P96
- `test_U99_omittedDataDisputeThatMayNotOmitIsKilledByTheInvalidStep`: REQ-FP-7-4DD0D7.T3.P18, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P97, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P202
- `test_U120_postedExcessSnapshotEntriesAreKilledByTheStepCounter`: REQ-FP-7-4DD0D7.T3.P19, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P98
- `test_U102_challengersGenesisDataOfAnotherForkIsRejected`: REQ-FP-7-4DD0D7.T3.P20, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P99
- `test_U102_undatedSuccessorGenesisIsAFaultOfTheFirstStep`: REQ-FP-7-4DD0D7.T3.P21, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P100
- `test_U99_joinHopLeavingTheJoinerOutIsKilledAtThatHop`: REQ-FP-7-4DD0D7.T3.P22, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P101
- `test_U99_lastHopAfterTheJoinHopIsAValidStepAndIsRejected`: REQ-FP-7-4DD0D7.T3.P23, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P102
- `test_U99_listedButUnsignedJoinerIsKilledAtTheJoinHop`: REQ-FP-7-4DD0D7.T3.P24, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P103
- `test_U99_joinerBlockSplicedFromAnotherRunIsKilledThroughTheBlockPointer`: REQ-FP-7-4DD0D7.T3.P25, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P104
- `test_U99_control_linkedJoinerBlockMakesTheJoinHopAValidStep`: REQ-FP-7-4DD0D7.T3.P26, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P105
- `test_U99_pointedStepStaysBoundedAsHopsBeforeItGrow`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P106
- `test_PO1_omittedDataStepDoesNotWalkTheUnrelatedFinalRun`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P201
