pragma solidity ^0.8.8;

//Channel Open
error ErrorInvalidJoinChannel();
error ErrorAtLeastTwoParticipantsRequired();
error ErrorTooManyParticipants(uint256 requested, uint256 maximum);
error ErrorDuplicateParticipant();

// Upper bound on a channel's participant union, counterpart to the
// two-participant minimum above. Off-chain agreement needs a signature from
// every participant, so the union size bounds how many confirmation signatures
// a valid block carries and therefore what the client must be able to retain;
// without a maximum on chain that retention bound can only be assumed. The
// duplicate-participant scan at open is quadratic in the union, so a bound also
// keeps that loop's gas finite.
uint256 constant MAX_CHANNEL_PARTICIPANTS = 32;

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
error ErrorTopUpBalanceParticipantSlashed(address participant);
error ErrorNoJoinChannelProvided();
error ErrorNoSuccessfulJoinChannel();
error ErrorJoinChannelAtomicFailure();

//Inbound message
error ErrorNoInboundMessagesProvided();

//Exit channel
error ErrorWithdrawalFailed();
error CantWithdrawMoreThanDeposits();

//Dispute errors
error ErrorDisputerNotMsgSender(address expectedDisputer, address actualSender);
error ErrorLinkingPreviousBlock();
error ErrorDisputeChallengePeriodExpired();
error ErrorDisputeAlreadyPosted(bytes32 forkId, address disputer);
error ErrorCantParticipateInDispute(bytes32 channelId, address participant);
error ErrorAuditingDataHashMismatch(bytes32 expectedAuditingDataHash, bytes32 providedAuditingDataHash);
error ErrorDisputePostedAuditingDataMismatch(bool expectedPostedAuditingData, bool actualPostedAuditingData);

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
error ErrorInvalidLatestState(bytes32 expectedStateMachineStateHash, bytes32 actualStateMachineStateHash);

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
error RaceConditionSnapshotForkMismatch(bytes32 currentForkId, bytes32 submittedForkId);
error RaceConditionBlockHeightTooOld();
error RaceConditionJoinChannelExpired();
error RaceConditionDisputeEvidencePeriodExpired();
error RaceConditionDisputeKillPeriodNotExpired();
error RaceConditionDisputeKillPeriodExpired();
error RaceConditionDisputeAlreadyReduced();
error RaceConditionReductionExpectationDoesntMatch(bytes32 expectedReducedForkId, bytes32 actualReducedForkId);
error RaceConditionDisputeAuditingRequired();
error RaceConditionDisputeTimeoutCalldataPosted(
    bytes32 forkId, uint256 blockHeight, address participant, bytes32 blockCalldataCommitment
);
error RaceConditionDisputeTimeoutPreviousBlockProducerPostedCalldataMismatch(
    address previousBlockProducer, uint256 blockHeight, bool expectedPostedCalldata, bool actualPostedCalldata
);
error RaceConditionDisputeTimeoutNotMinTimestamp(uint256 minTimestamp, uint256 currentTimestamp);
error RaceConditionDisputeTimeoutWindowCreatedTooEarly(uint256 windowCreationTimestamp, uint256 minTimestamp);
error RaceConditionUnexpectedBlockCalldataPosted();
error RaceConditionGenesisTimestampNotAvailable();
error RaceConditionOnChainSlashes();
error RaceConditionJoinChannelSnapshotMismatch();
error RaceConditionPendingInboundNotConsumed(
    bytes32 submittedInboundMessageBlockHash, bytes32 onChainInboundMessageBlockHash
);
error RaceConditionForceInboundJoinForkDisputed();
error ErrorDisputeThrottled(address disputer, uint256 throttleExpiry, uint256 currentTimestamp);
error ErrorDuplicateSelectorRegistration(bytes4 selector);
error ErrorRouteTargetHasNoCode(bytes4 selector, address target);

error RaceConditionDisputeWindowNotOpen(bytes32 channelId, bytes32 forkId);
