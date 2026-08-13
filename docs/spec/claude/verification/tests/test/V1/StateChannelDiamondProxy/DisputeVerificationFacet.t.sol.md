# test/V1/StateChannelDiamondProxy/DisputeVerificationFacet.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/DisputeVerificationFacet.t.sol](../../../../../../../../test/V1/StateChannelDiamondProxy/DisputeVerificationFacet.t.sol) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                       | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ------------------------------------------------------------------------------------------------------ | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `test_reduce_oversizedOnChainSlashes_doesNotPanic` (line 107)                                          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `testFuzz_reduce_slashedParticipantsNeverExceedsMaxSlashCount` (line 125)                              | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_computeDisputeOutputState_noRemoval_keepsAllParticipantsAndNoExits` (line 150)                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_computeDisputeOutputState_selfRemovalOnly_removesDisputerAndEmitsExit` (line 168)                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_computeDisputeOutputState_timeoutOnly_removesTimedOutParticipantAndEmitsExit` (line 185)         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_computeDisputeOutputState_selfRemovalAndTimeout_removesBothInOrderAndEmitsExits` (line 202)      | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_computeDisputeOutputState_slashSuppressesTimeout_keepsTimeoutTargetAndExitsSlashOnly` (line 226) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_reduceOutputToSnapshotData_timeoutOnly_removesTimedOutParticipant` (line 247)                    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_reduceOutputToSnapshotData_slashOnly_removesSlashedParticipant` (line 259)                       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_reduceOutputToSnapshotData_slashAndTimeout_ignoresTimeout` (line 272)                            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_reduceOutputToSnapshotData_slashTimeoutAndSelfRemoval_ignoresTimeout` (line 286)                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_getOnChainSlashedParticipantsUpToTimestamp_returnsStrictPrefixByCutoff` (line 303)               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_isInvalidBlockStructure_validSignedOnlyChain_returnsFalse` (line 342)                            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_isInvalidBlockStructure_invalidSignature_returnsTrue` (line 348)                                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_isInvalidBlockStructure_brokenLink_returnsTrue` (line 354)                                       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_isInvalidBlockStructure_skippedHeight_returnsTrue` (line 360)                                    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_disputeWindowObservation_distinguishesAbsentActiveAndExpired` (line 367)                         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_applyDisputeFraudProofs_expiredDispute_reverts` (line 386)                                       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_killDispute_expiredDispute_reverts` (line 399)                                                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_applyDisputeFraudProofs_mixedBatchWithExpiredItem_revertsAtomically` (line 410)                  | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_uploadDispute_timeoutWindowCreatedBeforeEligibility_reverts` (line 428)                          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_validateTimeoutCalldataPostedProof_validProof_returnsTrueAndPreservesOriginForkId` (line 456)    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_validateTimeoutCalldataPostedProof_wrongOriginForkId_returnsFalse` (line 463)                    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_validateTimeoutCalldataPostedProof_firstBlockGraceEdge_valid` (line 479)                         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_validateTimeoutCalldataPostedProof_pastFirstBlockGrace_invalid` (line 486)                       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_disputeBlockAuthorNotParticipant_validOutsiderBlock_killsDisputer` (line 495)                    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_disputeBlockAuthorNotParticipant_forgedResultingSnapshot_rejected` (line 506)                    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_disputeBlockAuthorNotParticipant_authorInEitherSnapshot_rejected` (line 514)                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_disputeBlockAuthorNotParticipant_authorInStaleResultingSnapshot_valid` (line 534)                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_disputeBlockAuthorNotParticipant_authorInWrongForkResultingSnapshot_valid` (line 555)            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_blockInvalidStateTransition_wrongTurnWithCorrectSnapshot_slashesSigner` (line 577)               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_verifyInboundMessageBlocks_linkedChainMatchingTarget_isValid` (line 866)                         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_verifyInboundMessageBlocks_firstBlockNotChainedToSnapshotHead_reportsHashLinkAtZero` (line 875)  | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_verifyInboundMessageBlocks_midChainLinkBroken_reportsHashLinkAtBreakIndex` (line 888)            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_verifyInboundMessageBlocks_skippedHeight_reportsHeightSequenceWithIntactHashLink` (line 905)     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_verifyInboundMessageBlocks_allLinkedButWrongTarget_reportsFinalTargetAtBlockCount` (line 922)    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_verifyInboundMessageBlocks_noBlocks_comparesSnapshotHeadAgainstTarget` (line 935)                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `test_reduceOutputToSnapshotData_unlinkedInboundBlocks_revertsCarryingComparedHashes` (line 952)       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
