pragma solidity ^0.8.8;

error ErrorDisputeInProgrees();
error ErrorDisputerNotMsgSender();
error ErrorDisputeForkMismatch();
error ErrorNotParticipant();
error ErrorLatestFinalizedBlock();
error ErrorTimeoutNotLinkedToPreviousBlock();
error ErrorTimeoutParticipantNotNextToWrite();
error ErrorTimeoutInvalid();
error ErrorTimeoutSelf();
error ErrorDisputeInvalid();
error ErrorDisputeDoesntExist();
error ErrorDisputeChallengeMismatch();
// error ErrorDisputeExpired();
error ErrorParticipantAlredySlashed();
error ErrorChallengeNewFinalizedBeforeOldFinalized();
error ErrorJoinChannelFailed();
error ErrorSlashedParticipantCantDispute();
error ErrorChannelIdMismatch();
error ErrorTransactionCountMismatch();
error ErrorSignatureInvalid();

//Can participate in dispute
error ErrorCantParticipateInDispute();

//Auditing errors
error ErrorDisputeWrongCommitment();
error ErrorDisputeWrongAuditingData();
error ErrorDisputeExpired();
error ErrorDisputeGenesisInvalid();
error ErrorDisputeStateProofInvalid();
error ErrorDisptuteFraudProofDidntSlash(uint proofIndex);
error ErrorDisputeStateMachineJoiningFailed();
error ErrorDisputeStateMachineSlashingFailed();
error ErrorDisputeStateMachineRemovingFailed();
error ErrorDisputeOutputStateSnapshotInvalid();
error ErrorDisputeJoinChannelBlocksInvalid();
error ErrorDisputeExitChannelBlocksInvalid();
error ErrorDisputeBalanceInvariantInvalid();

//Race conditions
error ErrorDisputeShouldUseSnapshotAsGenesisState();
error ErrorDisputeOnChainSlashedParticipantsMismatch();
error ErrorDisputeNotExpectedIndex();
error ErrorDisputeTimeoutCalldataPosted();
error ErrorDisputeTimeoutPreviousBlockProducerPostedCalldataMissmatch();
error ErrorDisputeTimeoutNotMinTimestamp();
error ErrorDisputeOnChainLatestJoinChannelBlockHashMismatch();

//Finalized and latest
error ErrorFinalizedAndLatestNotSignedByParticipant();
error ErrorFinalizedAndLatestFirstBlockNotVotingForFinalizedState();
error ErrorFinalizedAndLatestSecondBlocksNotLinked();
error ErrorFinalizedAndLatestLastBlockNotVoringForLatestState();

//Double sign
error ErrorDoubleSignBlocksAreSame();
error ErrorDoubleSignSignersNotTheSame();

//Incorrect data
error ErrorIncorrectDataStateHashNotLinkedToBlock(uint blockNumber);
error ErrorIncorrectDataBlocksNotLinked();

//Newer state
error ErrorNewerStateConfirmationInvalid();

//Timeout prior
error ErrorTimeoutPriorBlockNotInVirtualVotes();
error ErrorTimeoutPriorBlockNotPrior();
error ErrorTimeoutPriorCalldataExists();

//Block to far in the future
error ErrorBlockToFarInTheFutureActuallyNotInTheFuture();

//Join channel
error ErrorJoinChannelNotMyTurn();
error ErrorJoinChannelAlreadyInChannel();
error ErrorJoinChannelExpired();
error ErrorJoinChannelAlreadyAdded();


// ========================== DisputeManagerFacet ==========================

error CreateDisputeInvalidOnChainSlashedParticipants();
error CreateDisputeInvalidSignature();

error AuditMissingDisputeCommitment();
error AuditInvalidStateProof();
error AuditInvalidMilestone();
error AuditInvalidFraudProof();
error AuditInvalidOutputState();

error BlockInvalidConfirmation();
error BlockInvalidSignature();
error BlockInvalidChannelId();
error BlockInvalidTransactionCount();
error BlockInvalidStateSnapsotHash();
error BlockInvalidLink();
error BlockInvalidStateTransition();
error BlockOutOfGas();
error BlockNotLatestState();

error DisputeInvalidRecursive();
error DisputeInvalidPreviousRecursive();
error DisputeInvalidExitChannelBlocks();

//Posting block calldata
error ErrorBlockCalldataTimestampTooLate();
error ErrorBlockCalldataAlreadyPosted();