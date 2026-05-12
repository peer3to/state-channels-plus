pragma solidity ^0.8.8;

//Channel Open
error ErrorInvalidJoinChannel();
error ErrorAtLeastTwoParticipantsRequired();

//Calldata errors
error ErrorBlockCalldataAlreadyPosted();
error ErrorBlockCalldataMsgSenderNotBlockAuthor();

//StateSnapshot errors
error ErrorStateSnapshotNotValid();
error ErrorInvalidStateProof();
error ErrorOutboundMessageBlocksInvalid();
error ErrorOutboundMessageBalanceMismatch();
error ErrorInboundMessageBlockAlreadyPersisted();
error ErrorSnapshotsNotProvided();
error ErrorIncorrectSnapshotProvided();
error ErrorNotGenesisSnapshot();
error ErrorOutboundMessageTypeUnsupported(bytes32 messageType);

//Join channel
error ErrorInvalidChannelId();
error ErrorJoinChannelInvalidSignature();
error ErrorNoJoinChannelProvided();
error ErrorNoSuccessfulJoinChannel();
error ErrorJoinChannelAtomicFailure();

//Inbound message
error ErrorNoInboundMessagesProvided();

//Exit channel
error ErrorWithdrawalFailed();
error CantWithdrawMoreThanDeposits();

//Dispute errors
error ErrorDisputerNotMsgSender();
error ErrorLinkingPreviousBlock();
error ErrorDisputeChallengePeriodExpired();
error ErrorDisputeAlreadyPosted();
error ErrorCantParticipateInDispute();
error ErrorAuditingDataHashMismatch();
error ErrorDisputePostedAuditingDataMismatch();
error ErrorDisputeStateProofHeaderChannelMismatch();

//Reduce errors
error ErrorNoDisputesProvided();

//Auditing errors
error ErrorDisputeCommitmentNotAvailable();
error ErrorDisputeExpired();
error ErrorDisputeGenesisInvalid();
error ErrorDisputeStateMachineJoiningFailed();
error ErrorDisputeStateMachineSlashingFailed();
error ErrorDisputeStateMachineRemovingFailed();
error ErrorDisputeStateMachineInboundProcessingFailed();
error ErrorDisputeInboundMessageBlocksInvalid();
error ErrorInvalidLatestState();

//FraudProofs
error ErrorInvalidFraudProof(address slashedParticipant, address expectedParticipant);
error ErrorInvalidFraudProofType();

//Double sign
error ErrorDoubleSignBlocksNotSame();
error ErrorNotSameChannelId();
error ErrorInvalidStateSnapshot();
error ErrorInvalidStateSnapshotHash();

//Race conditions
error RaceConditionChannelAlreadyOpen();
error RaceConditionBlockCalldataTimestampTooLate();
error RaceConditionSnapshotForkMismatch();
error RaceConditionBlockHeightTooOld();
error RaceConditionJoinChannelExpired();
error RaceConditionDisputeEvidencePeriodExpired();
error RaceConditionDisputeKillPeriodNotExpired();
error RaceConditionDisputeAlreadyReduced();
error RaceConditionReductionExpectationDoesntMatch();
error RaceConditionDisputeAuditingRequired();
error RaceConditionDisputeTimeoutCalldataPosted();
error RaceConditionDisputeTimeoutPreviousBlockProducerPostedCalldataMismatch();
error RaceConditionDisputeTimeoutNotMinTimestamp();
error RaceConditionUnexpectedBlockCalldataPosted();
error RaceConditionGenesisTimestampNotAvailable();
error RaceConditionOnChainSlashes();
error RaceConditionJoinChannelStaleSnapshot();
error RaceConditionPendingInboundNotConsumed();
error RaceConditionJoinChannelForkDisputed();
error RaceConditionForceInboundJoinForkDisputed();
error ErrorDisputeThrottled();
