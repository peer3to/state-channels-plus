pragma solidity ^0.8.8;

error ErrorDisputeInProgrees();
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
error ErrorDisputeExpired();
error ErrorParticipantAlredySlashed();
error ErrorChallengeNewFinalizedBeforeOldFinalized();
error ErrorJoinChannelFailed();
error ErrorSlashedParticipantCantDispute();
error ErrorChannelIdMismatch();
error ErrorTransactionCountMismatch();
error ErrorSignatureInvalid();

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
