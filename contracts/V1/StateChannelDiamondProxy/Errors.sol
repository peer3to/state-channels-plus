pragma solidity ^0.8.8;

//Channel Open
error ErrorInvalidJoinChannel();
error ErrorAtLeastTwoParticipantsRequired();
error ErrorDuplicateParticipant();

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
error ErrorJoinChannelInvalidSubmitter(address expectedParticipant, address actualSubmitter);
error ErrorJoinChannelParticipantAlreadyExists();
error ErrorTopUpBalanceParticipantNotFound();
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

//Reduce errors
error ErrorNoDisputesProvided();

//Auditing errors
error ErrorDisputeCommitmentNotAvailable();
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
error RaceConditionDisputeKillPeriodExpired();
error RaceConditionDisputeAlreadyReduced();
error RaceConditionReductionExpectationDoesntMatch();
error RaceConditionDisputeAuditingRequired();
error RaceConditionDisputeTimeoutCalldataPosted();
error RaceConditionDisputeTimeoutPreviousBlockProducerPostedCalldataMismatch();
error RaceConditionDisputeTimeoutNotMinTimestamp();
error RaceConditionDisputeTimeoutWindowCreatedTooEarly();
error RaceConditionUnexpectedBlockCalldataPosted();
error RaceConditionGenesisTimestampNotAvailable();
error RaceConditionOnChainSlashes();
error RaceConditionJoinChannelSnapshotMismatch();
error RaceConditionPendingInboundNotConsumed();
error RaceConditionForceInboundJoinForkDisputed();
error ErrorDisputeThrottled();
