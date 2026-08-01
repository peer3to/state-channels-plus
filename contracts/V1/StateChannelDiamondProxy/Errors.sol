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
// Why the inbound walk rejected the chain. Plain `uint8` constants rather than
// an enum on purpose: `scripts/generate-enums.ts` numbers the generated TS
// enums by discovery order, so adding an enum here would silently renumber
// FraudProofType and DisputeFraudProofType.
uint8 constant INBOUND_FAILURE_HASH_LINK = 0;
uint8 constant INBOUND_FAILURE_HEIGHT_SEQUENCE = 1;
uint8 constant INBOUND_FAILURE_FINAL_TARGET = 2;

/// `submittedSnapshotInboundHash` is where the submitted snapshot said the
/// inbound chain starts, `expectedTargetInboundHash` where reduce() said it
/// ends, and `runningInboundHash` how far the walk actually got. `breakIndex`
/// is the block that failed, or `submittedBlockCount` for a final-target
/// mismatch. `failureReason` is one of the INBOUND_FAILURE_* constants — a
/// hash link and a height sequence both break at a block index, and without it
/// the two are indistinguishable.
error ErrorDisputeInboundMessageBlocksInvalid(
    bytes32 submittedSnapshotInboundHash,
    bytes32 expectedTargetInboundHash,
    bytes32 runningInboundHash,
    uint256 breakIndex,
    uint256 submittedBlockCount,
    uint8 failureReason
);
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
