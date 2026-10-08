# StateProofWalk.t.sol

Test file: [test/V1/StateChannelDiamondProxy/StateProofWalk.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateProofWalk.t.sol)

## Overview

Calls the milestone verifier with genesis, same-fork anchors, membership changes and malformed evidence. Cases check threshold finality, skipped history, overlap and returned replay boundaries.

## Tests

- `test_U01_proofCarriesOnlyMilestonesAndItsLastBlockIsTheLatestState`: REQ-SP-1-9YABY1.T2.P1, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P21
- `test_U02_emptyProofAtGenesisRepresentsTheGenesis`: REQ-SP-4-NCSEX4.T2.P1, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P22
- `test_U03_emptyProofWithANonGenesisAnchorStillRepresentsTheGenesis`: REQ-SP-4-NCSEX4.T2.P2, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P23
- `test_U04_anchorBlockAloneRepresentsTheAnchorState`: REQ-SP-1-9YABY1.T2.P2, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P24
- `test_U05_unfinalizedGenesisZeroAloneReplaysFromZero`: REQ-SP-4-NCSEX4.T2.P3, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P25
- `test_U05_unfinalizedGenesisZeroWithLinkedTailReplaysFromZero`: REQ-SP-4-NCSEX4.T2.P4, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P26
- `test_U06_thresholdFinalGenesisZeroReplaysOnlyLaterBlocks`: REQ-SP-4-NCSEX4.T2.P5, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P27
- `test_U07_blockZeroAnchorIsFinalWithoutAThreshold`: REQ-SP-4-NCSEX4.T2.P6, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P28
- `test_U07_blockZeroAnchorIsNotConfusedWithTheGenesis`: REQ-SP-4-NCSEX4.T2.P7, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P29
- `test_U08_anchorAtTheFirstBlockOfTheMilestone`: REQ-SP-1-9YABY1.T2.P3, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P30
- `test_U08_anchorAtAMiddleBlockOfTheMilestone`: REQ-SP-1-9YABY1.T2.P4, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P31
- `test_U08_anchorAtTheLastBlockOfTheMilestone`: REQ-SP-1-9YABY1.T2.P5, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P32
- `test_U09_blockAtTheAnchorHeightCommittingAnotherSnapshotDoesNotMatch`: REQ-SP-7-70EMAT.T2.P1, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P33
- `test_U10_firstMilestoneAboveTheAnchorProvesItsHopWithoutTheAnchorBlock`: REQ-SP-1-9YABY1.T2.P6, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P34
- `test_U11_firstMilestoneAboveTheAnchorWithoutTheThresholdIsInvalid`: REQ-SP-1-9YABY1.T2.P7, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P35
- `test_U11_unfinalizedExtensionMustIncludeTheAnchorBlock`: REQ-SP-1-9YABY1.T2.P8, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P36
- `test_U12_linkedUnfinalizedTailDoesNotBecomeFinal`: REQ-SP-1-9YABY1.T2.P9, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P37
- `test_U13_brokenRetainedLinkAfterTheAnchorIsInvalid`: REQ-SP-7-70EMAT.T2.P2, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P38
- `test_U13_wrongGenesisLinkOfBlockZeroIsInvalid`: REQ-SP-4-NCSEX4.T2.P8, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P39
- `test_U14_milestonesBeforeTheAnchorAreSkippedAndTheCrossingMilestoneIsProcessedFromIt`: REQ-SP-7-70EMAT.T2.P3, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P40
- `test_U14_crossingMilestoneFirstBlockOnAnotherForkBelowTheAnchorIsSkipped`: REQ-SP-7-70EMAT.T2.P4, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P41
- `test_U15_anchorAdvancedToTheProofStartKeepsItValid`: REQ-SP-1-9YABY1.T2.P10, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P42
- `test_U15_anchorAdvancedIntoTheProofInteriorKeepsItValid`: REQ-SP-1-9YABY1.T2.P11, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P43
- `test_U15_anchorAdvancedToTheProofEndpointKeepsItValid`: REQ-SP-1-9YABY1.T2.P12, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P44
- `test_U15_anchorAdvancedBeyondTheProofEndpointLeavesNothingToCheck`: REQ-SP-1-9YABY1.T2.P13, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P45
- `test_U16_additionHopIsFinalWithTheOldAndNewUnion`: REQ-SP-3-SP1JG4.T2.P1, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P46
- `test_U16_removalHopIsFinalWithTheOldAndNewUnion`: REQ-SP-3-SP1JG4.T2.P2, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P47
- `test_U17_successiveChangesAreEachProvenByTheirOwnUnion`: REQ-SP-3-SP1JG4.T2.P3, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P48
- `test_U17_laterChangeWithoutTheEarlierHopNeedsTheAnchorSet`: REQ-SP-3-SP1JG4.T2.P4, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P49
- `test_U18_directSignaturesOnOneBlockEstablishTheHop`: REQ-SP-1-9YABY1.T2.P14, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P50
- `test_U18_indirectVotingOverLinkedBlocksEstablishesTheHop`: REQ-SP-1-9YABY1.T2.P15, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P51
- `test_U18_directAndIndirectEvidenceTogetherEstablishTheHop`: REQ-SP-1-9YABY1.T2.P16, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P52
- `test_U19_evidenceBelowTheThresholdDoesNotEstablishTheHop`: REQ-SP-3-SP1JG4.T2.P5, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P53
- `test_U19_evidenceExactlyAtTheThresholdEstablishesTheHop`: REQ-SP-3-SP1JG4.T2.P6, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P54
- `test_U19_evidenceAboveTheThresholdEstablishesTheHop`: REQ-SP-3-SP1JG4.T2.P7, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P55
- `test_U20_removalHopMissingTheOldSideIsInvalid`: REQ-SP-3-SP1JG4.T2.P8, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P56
- `test_U20_additionHopMissingTheNewSideIsInvalid`: REQ-SP-3-SP1JG4.T2.P9, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P57
- `test_U21_unfinalizedChangesStayInOneReplayTail`: REQ-SP-3-SP1JG4.T2.P10, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P58
- `test_U21_unfinalizedChangesCannotBecomeFinalizedHops`: REQ-SP-3-SP1JG4.T2.P11, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P59
- `test_U78_duplicateSignerCannotReplaceAMissingMember`: REQ-SP-3-SP1JG4.T2.P12, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P60
- `test_U78_outsideSignerCannotReplaceAMissingMember`: REQ-SP-3-SP1JG4.T2.P13, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P61
- `test_U79_blockZeroAdditionIsFinalWithTheOldAndNewUnion`: REQ-SP-3-SP1JG4.T2.P14, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P62
- `test_U79_blockZeroRemovalIsFinalWithTheOldAndNewUnion`: REQ-SP-3-SP1JG4.T2.P15, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P63
- `test_U79_blockZeroRemovalMissingTheOldSideStaysUnfinalized`: REQ-SP-3-SP1JG4.T2.P16, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P64
- `test_U79_blockZeroAdditionMissingTheNewSideStaysUnfinalized`: REQ-SP-3-SP1JG4.T2.P17, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P65
- `test_U80_snapshotTheBlockDoesNotCommitCannotBeItsProvenState`: REQ-SP-7-70EMAT.T2.P5, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P66
- `test_U80_sameHeightSubstitutedSnapshotCannotBeItsProvenState`: REQ-SP-7-70EMAT.T2.P6, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P67
- `test_U86_laterOnChainSlashDoesNotChangeAValidProof`: REQ-SP-3-SP1JG4.T2.P18, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P68
- `test_U110_emptyMilestoneCannotEstablishAValidProof`: REQ-SP-7-70EMAT.T2.P7, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P69
- `test_U110_missingSnapshotEntriesCannotVerifyTheProof`: REQ-SP-7-70EMAT.T2.P8, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P70
- `test_U120_excessSnapshotEntriesAreRejected`: REQ-SP-7-70EMAT.T2.P9, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P71
- `test_U120_exactSnapshotEntriesControl`: REQ-SP-7-70EMAT.T2.P10, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P72
- `test_U123_overlappingMilestonesWithComplementarySignaturesVerifyOnChain`: REQ-SP-1-9YABY1.T2.P17, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P73
- `test_U123_conflictingBlockContentsAreNotTheSameAuthenticatedBlock`: REQ-SP-7-70EMAT.T2.P11, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P74
- `test_D6_atomicJoinAndExitHopWithoutTheJoinersSignatureIsInvalid`: REQ-SP-3-SP1JG4.T2.P19, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P75
- `test_D6_atomicJoinAndExitHopWithTheJoinersSignatureIsValid`: REQ-SP-3-SP1JG4.T2.P20, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P76
