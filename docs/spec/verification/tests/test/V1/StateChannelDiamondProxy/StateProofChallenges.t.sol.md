# StateProofChallenges.t.sol

Test file: [test/V1/StateChannelDiamondProxy/StateProofChallenges.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateProofChallenges.t.sol)

## Overview

Exercises proof-related dispute challenges and omission decisions through the contract boundary. Cases check accepted counters, rejected challengers, protected targets and participant-union evidence.

## Tests

- `test_U45_strictlyHigherSameForkAnchorCountersTheDispute`: REQ-FP-7-4DD0D7.T3.P27, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P107
- `test_U45_equalHeightSameForkAnchorDoesNotCounter`: REQ-FP-7-4DD0D7.T3.P28, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P108
- `test_U45_lowerSameForkAnchorDoesNotCounter`: REQ-FP-7-4DD0D7.T3.P29, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P109
- `test_U46_higherAnchorOnAnotherForkDoesNotCounter`: REQ-FP-7-4DD0D7.T3.P30, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P110
- `test_U47_genesisAnchorGivesNoCounterToTheEmptyGenesisClaim`: REQ-FP-7-4DD0D7.T3.P31, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P111
- `test_U47_blockZeroAnchorCountersTheEmptyGenesisClaimAtEqualHeightZero`: REQ-FP-7-4DD0D7.T3.P32, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P112
- `test_U47_laterSameForkAnchorCountersTheEmptyGenesisClaim`: REQ-FP-7-4DD0D7.T3.P33, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P113
- `test_U48_anchorAloneCountersADisputerThatNeverSignedIt`: REQ-FP-7-4DD0D7.T3.P34, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P114
- `test_U49_milestoneStartBeforeTheAnchorIsIneligible`: REQ-FP-7-4DD0D7.T3.P35, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P12
- `test_U49_anchorBlockIsIneligible`: REQ-FP-7-4DD0D7.T3.P36, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P13
- `test_U49_firstBlockAfterTheAnchorIsEligible`: REQ-FP-7-4DD0D7.T3.P37, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P14
- `test_U49_laterTailBlockIsEligible`: REQ-FP-7-4DD0D7.T3.P38, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P15
- `test_U49_positionPastTheLastMilestoneIsIneligible`: REQ-FP-7-4DD0D7.T3.P39, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P16
- `test_U49_faultAtTheAnchorBoundaryIsNotChallengeable`: REQ-FP-7-4DD0D7.T3.P40, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P115
- `test_U49_positionAfterTheBoundaryNamesTheSameBlockWithTheAnchorMidMilestone`: REQ-FP-7-4DD0D7.T3.P41, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P116
- `test_U49_positionAfterTheBoundaryNamesTheSameBlockWithTheAnchorAtTheMilestoneStart`: REQ-FP-7-4DD0D7.T3.P42, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P117
- `test_U50_unfinalizedZeroWithAGenesisAnchorIsEligible`: REQ-FP-7-4DD0D7.T3.P43, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P17
- `test_U50_thresholdFinalZeroWithAGenesisAnchorIsEligible`: REQ-FP-7-4DD0D7.T3.P44, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P18
- `test_U50_unfinalizedZeroWithAGenesisAnchorIsKilledByABlockChallenge`: REQ-FP-7-4DD0D7.T3.P45, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P118
- `test_U50_blockZeroResultingSnapshotAnchorProtectsZero`: REQ-FP-7-4DD0D7.T3.P46, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P19
- `test_U51_earlierMilestoneBlockCannotBeNamedByABlockChallenge`: REQ-FP-7-4DD0D7.T3.P47, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P119
- `test_U52_anchorOnlyLastMilestoneHasNoCandidate`: REQ-FP-7-4DD0D7.T3.P48, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P20
- `test_U52_singleThresholdFinalLastMilestoneHasNoCandidate`: REQ-FP-7-4DD0D7.T3.P49, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P21
- `test_U53_anchorAdvancingAcrossTheTargetMakesItIneligible`: REQ-FP-7-4DD0D7.T3.P50, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P120
- `test_U92_structureAtAnchorFinalZeroIsNotChallengeable`: REQ-FP-7-4DD0D7.T3.P51, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P121
- `test_U92_structureAtThresholdFinalZeroIsChallengeable`: REQ-FP-7-4DD0D7.T3.P52, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P122
- `test_U92_structureAtALaterFinalPointIsNotChallengeable`: REQ-FP-7-4DD0D7.T3.P53, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P123
- `test_U92_structureInTheUnfinalizedTailIsChallengeable`: REQ-FP-7-4DD0D7.T3.P54, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P124
- `test_U92_outsiderAuthorAtAnchorFinalZeroIsNotChallengeable`: REQ-FP-7-4DD0D7.T3.P55, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P125
- `test_U92_outsiderAuthorAtThresholdFinalZeroIsChallengeable`: REQ-FP-7-4DD0D7.T3.P56, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P126
- `test_U92_outsiderAuthorAtALaterFinalPointIsNotChallengeable`: REQ-FP-7-4DD0D7.T3.P57, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P127
- `test_U92_outsiderAuthorInTheUnfinalizedTailIsChallengeable`: REQ-FP-7-4DD0D7.T3.P58, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P128
- `test_U92_wrappedFraudAtAnchorFinalZeroIsNotChallengeable`: REQ-FP-7-4DD0D7.T3.P59, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P129
- `test_U92_wrappedFraudAtThresholdFinalZeroIsChallengeable`: REQ-FP-7-4DD0D7.T3.P60, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P130
- `test_U92_wrappedFraudAtALaterFinalPointIsNotChallengeable`: REQ-FP-7-4DD0D7.T3.P61, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P131
- `test_U92_wrappedFraudInTheUnfinalizedTailIsChallengeable`: REQ-FP-7-4DD0D7.T3.P62, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P132
- `test_U92_headerMismatchAtALaterFinalPointIsNotChallengeable`: REQ-FP-7-4DD0D7.T3.P63, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P133
- `test_U92_headerMismatchInTheUnfinalizedTailIsChallengeable`: REQ-FP-7-4DD0D7.T3.P64, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P134
- `test_U92_headerMismatchAtAnchorFinalZeroIsNotChallengeable`: REQ-FP-7-4DD0D7.T3.P65, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P135
- `test_U92_headerMismatchAtThresholdFinalZeroIsChallengeable`: REQ-FP-7-4DD0D7.T3.P66, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P136
- `test_U106_structureDefectBelowTheAnchorIsNotChallengeable`: REQ-FP-7-4DD0D7.T3.P67, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P137
- `test_U106_structureDefectInTheRetainedTailIsChallengeable`: REQ-FP-7-4DD0D7.T3.P68, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P138
- `test_U106_headerDefectBelowTheAnchorIsNotChallengeable`: REQ-FP-7-4DD0D7.T3.P69, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P139
- `test_U106_structureDefectInTheRetainedTailAfterAWhollySkippedMilestoneIsChallengeable`: REQ-FP-7-4DD0D7.T3.P70, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P140
- `test_U106_headerDefectInTheRetainedTailIsChallengeable`: REQ-FP-7-4DD0D7.T3.P71, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P141
- `test_U108_extraFinalityEvidenceDoesNotRemoveEligibility`: REQ-FP-7-4DD0D7.T3.P72, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P142
- `test_U108_eligibleCorrectBlockEstablishesNoOffense`: REQ-FP-7-4DD0D7.T3.P73, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P143
- `test_U34_anchorAtTheFirstPositionOfTheLastMilestonePermitsOmission`: REQ-FP-7-4DD0D7.T2.P34, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P70
- `test_U34_anchorAtAMiddlePositionOfTheLastMilestonePermitsOmission`: REQ-FP-7-4DD0D7.T2.P35, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P71
- `test_U34_anchorAtTheLastPositionOfTheLastMilestonePermitsOmission`: REQ-FP-7-4DD0D7.T2.P36, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P72
- `test_U35_everyoneFinalWithoutPendingParticipantsPermitsOmission`: REQ-FP-7-4DD0D7.T2.P37, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P73
- `test_U35_everyoneFinalIncludingAPendingParticipantPermitsOmission`: REQ-FP-7-4DD0D7.T2.P38, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P74
- `test_U36_missingParticipantSignatureRequiresPostedData`: REQ-FP-7-4DD0D7.T3.P74, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P144
- `test_U36_missingPendingParticipantSignatureRequiresPostedData`: REQ-FP-7-4DD0D7.T3.P75, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P145
- `test_U36_missingPendingParticipantSignatureWithOmittedDataIsKilled`: REQ-FP-7-4DD0D7.T2.P39, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P75
- `test_U37_anchorInAnEarlierMilestoneAloneDoesNotPermitOmission`: REQ-FP-7-4DD0D7.T2.P40, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P76
- `test_U38_omittedDataWithoutTheRuleIsKilledByTheAvailabilityCounter`: REQ-FP-7-4DD0D7.T2.P41, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P77
- `test_U38_postedDataIsNotCounteredByTheAvailabilityCounter`: REQ-FP-7-4DD0D7.T2.P42, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P78
- `test_U95_slashCommittedInTheDisputeIsSubtracted`: REQ-FP-7-4DD0D7.T3.P76, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P146
- `test_U95_slashLandingAfterTheDisputeDoesNotChangeTheVerdict`: REQ-FP-7-4DD0D7.T2.P43, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P79
- `test_U95_slashOmittedFromTheCommittedListKeepsTheRequirement`: REQ-FP-7-4DD0D7.T3.P77, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P147
- `test_U95_falselyClaimedSlashIsCounteredIndependently`: REQ-FP-7-4DD0D7.T3.P78, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P148
- `test_U112_foreignForkAnchorDoesNotPermitOmission`: REQ-FP-7-4DD0D7.T3.P79, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P149
- `test_U112_requiredEveryoneFinalityRemainsTheAlternative`: REQ-FP-7-4DD0D7.T3.P80, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P150
- `test_U107_omittedDataBrokenRetainedLinkIsCountered`: REQ-FP-7-4DD0D7.T3.P81, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P151
- `test_U107_omittedDataWrongLatestStateCommitmentIsCountered`: REQ-FP-7-4DD0D7.T3.P82, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P152
- `test_U107_omittedDataValidProofIsNotCountered`: REQ-FP-7-4DD0D7.T3.P83, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P153
- `test_U107_omittedDataInsufficientHopSignaturesAreCountered`: REQ-FP-7-4DD0D7.T3.P84, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P154
- `test_U107_forgedChallengerSnapshotDoesNotInvalidateAnHonestProof`: REQ-FP-7-4DD0D7.T3.P85, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P155
- `test_U111_substitutedSnapshotForAnInvalidHopDoesNotEstablishIt`: REQ-FP-7-4DD0D7.T3.P86, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P156
- `test_U120_stepPointerPastTheLastMilestoneIsRejected`: REQ-FP-7-4DD0D7.T3.P87, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P157
- `test_U100_departureAfterAConsumedJoinIsNotAnOmission`: REQ-FP-7-4DD0D7.T3.P88, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P158
- `test_U100_consumedJoinSignedByTheJoinerIsNotAnOmission`: REQ-FP-7-4DD0D7.T3.P89, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P159
- `test_U100_rejoinSignedByTheJoinerIsNotAnOmission`: REQ-FP-7-4DD0D7.T3.P90, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P160
- `test_U43_omittedDataValidLatestBalanceIsNotCountered`: REQ-FP-7-4DD0D7.T3.P91, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P161
- `test_U43_omittedDataInvalidLatestBalanceIsCountered`: REQ-FP-7-4DD0D7.T3.P92, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P162
- `test_U43_postedDataValidLatestBalanceIsNotCountered`: REQ-FP-7-4DD0D7.T3.P93, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P163
- `test_U43_postedDataInvalidLatestBalanceIsCountered`: REQ-FP-7-4DD0D7.T3.P94, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P164
- `test_U44_finalizedPassesLatestFailsIsCountered`: REQ-FP-7-4DD0D7.T3.P95, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P165
- `test_U44_finalizedFailsLatestPassesIsNotCountered`: REQ-FP-7-4DD0D7.T3.P96, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P166
- `test_U44_failingFinalizedStateIsNotTheLatestStateAndIsNotCountered`: REQ-FP-7-4DD0D7.T3.P97, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P167
