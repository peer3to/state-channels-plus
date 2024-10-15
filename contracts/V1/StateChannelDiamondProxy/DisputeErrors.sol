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
error ErrorSlashedParticipantCantDispute();
error ErrorChannelIdMismatch();
error ErrorTransactionCountMismatch();
error ErrorSignatureInvalid();

//Finalized and latest
error ErrorFinalizedAndLatestNotSignedByParticipant();
error ErrorFinalizedAndLatestFirstBlockNotVotingForFinalizedState();
error ErrorFinalizedAndLatestSecondBlocksNotLinked();
error ErrorFinalizedAndLatestLastBlockNotVoringForLatestState();
