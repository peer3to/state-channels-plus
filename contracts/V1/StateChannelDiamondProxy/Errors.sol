pragma solidity ^0.8.8;

//Calldata errors
error ErrorBlockCalldataTimestampTooLate();
error ErrorBlockCalldataAlreadyPosted();

//StateSnapshot errors
error ErrorStateSnapshotNotValid();
error ErrorInvalidStateProof();
error ErrorFirstExitChannelBlockInvalid();
error ErrorExitChannelBlocksNotLinked();
error ErrorLastSnapshotInvalid();
error ErrorLastSnapshotDoesNotMatchGenesis();
error ErrorSnapshotsNotProvided();
error ErrorStanpshotForkMismatch();

//Join channel
error ErrorJoinChannelExpired();
error ErrorJoinChannelInvalidSignature();

//Exit channel
error ErrorWithdrawalFailed();
error CantWithdrawMoreThanDeposits();

//Dispute errors
error ErrorDisputerNotMsgSender();
error ErrorTimeoutNotLinkedToPreviousBlock();
error ErrorLinkingPreviousBlock();
error ErrorJoinChannelFailed();
error ErrorDisputeChallengePeriodExpired();
error ErrorDisputeAlreadyPosted();
error ErrorCantParticipateInDispute();

//Reduce errors
error ErrorNoDisputesProvided();
error ErrorDisputeKillPeriodNotExpired();
error ErrorDisputeAlreadyReduced();

//Auditing errors
error ErrorDisputeAuditingRequired();
error ErrorDisputeWrongAuditingData();
error ErrorDisputeCommitmentNotAvailable();
error ErrorDisputeExpired();
error ErrorDisputeGenesisInvalid();
error ErrorDisputeStateProofInvalid();
error ErrorDisputeStateMachineJoiningFailed();
error ErrorDisputeStateMachineSlashingFailed();
error ErrorDisputeStateMachineRemovingFailed();
error ErrorDisputeOutputStateSnapshotInvalid();
error ErrorDisputeJoinChannelBlocksInvalid();
error ErrorDisputeExitChannelBlocksInvalid();
error ErrorDisputeBalanceInvariantInvalid();
error ErrorInvalidLatestState();

//Race conditions
error ErrorDisputeTimeoutCalldataPosted();
error ErrorDisputeTimeoutPreviousBlockProducerPostedCalldataMismatch();
error ErrorDisputeTimeoutNotMinTimestamp();

//FraudProofs
error ErrorInvalidFraudProof();

//Double sign
error ErrorDoubleSignBlocksNotSame();
error ErrorNotEmptyBlockFraud();
error ErrorNotSameChannelId();
error ErrorInvalidStateSnapshot();
error ErrorInvalidBlock();
error ErrorInvalidStateSnapshotHash();
error ErrorValidStateTransition();

//Incorrect data
error ErrorIncorrectLatestStateSnapshot();

// ========================== DisputeManagerFacet ==========================
