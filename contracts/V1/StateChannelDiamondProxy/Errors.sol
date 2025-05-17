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
error ErrorLinkingPreviousBlock();
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
error ErrorDisputeCommitmentNotAvailable();
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
error ErrorWithinChallengePeriod();
error ErrorInvalidSignedBlocks();
error ErrorInvalidLatestState();
error ErrorInvalidDisputeOutputState();
error ErrorRecursiveDisputeNotExtendingSlashes();
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
error ErrorDoubleSignBlocksNotSame();
error ErrorDoubleSignSignersNotSame();
error ErrorNotEmptyBlockFraud();
error ErrorNotSameChannelId();
error ErrorInvalidBlockStateTransition();
error ErrorValidBlockStateTransition();
error ErrorInvalidBlockState();
error ErrorInvalidStateSnapshot();
error ErrorInvalidBlock();
error ErrorInvalidStateSnapshotHash();
error ErrorValidStateTransition();
//Incorrect data
error ErrorIncorrectDataStateHashNotLinkedToBlock(uint blockNumber);
error ErrorIncorrectDataBlocksNotLinked();
error ErrorIncorrectLatestStateSnapshot();

//Newer state
error ErrorNewerStateConfirmationInvalid();

//Timeout prior
error ErrorTimeoutPriorBlockNotInVirtualVotes();
error ErrorTimeoutPriorBlockNotPrior();
error ErrorTimeoutPriorCalldataExists();
error ErrorInvalidTimeoutParticipant();

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

//StateSnapshot errors
error ErrorDisputeProofRequired();
error ErrorDisputeProofNotValid();
error ErrorDisputeNotFinalized();
error ErrorStateSnapshotNotValid();
error ErrorInvalidStateProof();
error ErrorFirstExitChannelBlockInvalid();
error ErrorExitChannelBlocksNotLinked();
error ErrorLastSnapshotInvalid();
error ErrorLastSnapshotDoesNotMatchGenesis();