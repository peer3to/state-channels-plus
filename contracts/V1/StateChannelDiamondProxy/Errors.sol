pragma solidity ^0.8.8;

//Channel Open
error ErrorInvalidJoinChannel();
error ErrorAtLeastTwoParticipantsRequired(uint256 participantCount);
error ErrorDuplicateParticipant(address participant);

//Calldata errors
error ErrorBlockCalldataAlreadyPosted(
    bytes32 forkId, uint256 transactionCnt, address participant, bytes32 existingCommitment
);
error ErrorBlockCalldataMsgSenderNotBlockAuthor(address expectedAuthor, address actualSender);

//StateSnapshot errors
error ErrorStateSnapshotNotValid(bytes32 currentForkId, bytes32 targetForkId);
error ErrorInvalidStateProof(bytes32 forkId, uint256 milestoneProofCount, uint256 milestoneSnapshotCount);
error ErrorOutboundMessageBlocksInvalid(
    bytes32 lowerLatestOutboundMessageBlockHash,
    uint256 lowerLatestOutboundMessageBlockHeight,
    uint256 outboundMessageBlockCount
);
error ErrorOutboundMessageBalanceMismatch(address participant, uint256 expectedAmount, uint256 actualAmount);
error ErrorInboundMessageBlockAlreadyPersisted(bytes32 channelId, bytes32 blockHash);
error ErrorSnapshotsNotProvided();
/// A genesis snapshot commits to its own snapshotData at height 0, so
/// `expectedForkId` is `keccak256(snapshotData)` and `actualForkId` what the
/// submitted snapshot claimed.
error ErrorNotGenesisSnapshot(bytes32 expectedForkId, bytes32 actualForkId, uint256 blockHeight);
error ErrorSnapshotGenesisTimestampMismatch(uint256 expectedTimestamp, uint256 actualTimestamp);
error ErrorSnapshotDataForkMismatch(bytes32 expectedForkId, bytes32 actualForkId);
error ErrorInvalidStateSnapshotHash(bytes32 expectedStateSnapshotHash, bytes32 actualStateSnapshotHash);
error ErrorOutboundMessageTypeUnsupported(bytes32 messageType);

//Join channel
error ErrorInvalidChannelId();
error ErrorJoinChannelInvalidSignature(address expectedSigner, address actualSigner);
error ErrorJoinChannelConfirmationNotThresholdSigned(
    address participant, uint256 thresholdParticipantCount, uint256 signatureCount
);
error ErrorJoinChannelInvalidSubmitter(address expectedParticipant, address actualSubmitter);
error ErrorJoinChannelParticipantAlreadyExists(bytes32 channelId, address participant);
error ErrorTopUpBalanceParticipantNotFound(bytes32 channelId, address participant);
error ErrorTopUpBalanceParticipantSlashed(address participant);
error ErrorNoJoinChannelProvided();
error ErrorNoSuccessfulJoinChannel();
error ErrorJoinChannelAtomicFailure(uint256 joinChannelIndex, address participant);

//Inbound message
error ErrorNoInboundMessagesProvided();

//Exit channel
error ErrorWithdrawalFailed(uint256 blockIndex, uint256 messageIndex, address participant);
error CantWithdrawMoreThanDeposits(uint256 totalDepositAmount, uint256 totalWithdrawalAmount);

//Dispute errors
error ErrorDisputerNotMsgSender(address expectedDisputer, address actualSender);
error ErrorDisputeChallengePeriodExpired(uint256 challengePeriodEnd, uint256 currentTimestamp);
error ErrorDisputeAlreadyPosted(bytes32 forkId, address disputer);
error ErrorCantParticipateInDispute(bytes32 channelId, address participant);
error ErrorAuditingDataHashMismatch(bytes32 expectedAuditingDataHash, bytes32 providedAuditingDataHash);
error ErrorDisputePostedAuditingDataMismatch(bool expectedPostedAuditingData, bool actualPostedAuditingData);

//Reduce errors
error ErrorNoDisputesProvided();

//Auditing errors
/// The submitted dispute set does not match the window's commitment list.
error ErrorDisputeCommitmentNotAvailable(
    bytes32 channelId, bytes32 forkId, uint256 submittedDisputeCount, uint256 committedDisputeCount
);
/// One specific dispute commitment is absent from the window.
error ErrorDisputeCommitmentNotFound(bytes32 channelId, bytes32 forkId, bytes32 commitment);
error ErrorDisputeStateMachineInboundProcessingFailed(
    uint256 blockIndex, uint256 messageIndex, address participant, bytes32 messageType
);
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

//Race conditions
error RaceConditionChannelAlreadyOpen(bytes32 channelId);
error RaceConditionBlockCalldataTimestampTooLate(uint256 maxTimestamp, uint256 currentTimestamp);
error RaceConditionSnapshotForkMismatch(bytes32 currentForkId, bytes32 submittedForkId);
error RaceConditionBlockHeightTooOld(uint256 currentBlockHeight, uint256 submittedBlockHeight);
error RaceConditionJoinChannelExpired(uint256 deadlineTimestamp, uint256 currentTimestamp);
error RaceConditionDisputeEvidencePeriodExpired(uint256 evidencePeriodEnd, uint256 currentTimestamp);
error RaceConditionDisputeKillPeriodNotExpired(uint256 killPeriodEnd, uint256 currentTimestamp);
error RaceConditionDisputeKillPeriodExpired(uint256 killPeriodEnd, uint256 currentTimestamp);
error RaceConditionDisputeAlreadyReduced(bytes32 forkId, bytes32 existingReducedForkId, bytes32 submittedReducedForkId);
error RaceConditionReductionExpectationDoesntMatch(bytes32 expectedReducedForkId, bytes32 actualReducedForkId);
error RaceConditionDisputeTimeoutCalldataPosted(
    bytes32 forkId, uint256 blockHeight, address participant, bytes32 blockCalldataCommitment
);
error RaceConditionDisputeTimeoutPreviousBlockProducerPostedCalldataMismatch(
    address previousBlockProducer, uint256 blockHeight, bool expectedPostedCalldata, bool actualPostedCalldata
);
error RaceConditionDisputeTimeoutNotMinTimestamp(uint256 minTimestamp, uint256 currentTimestamp);
error RaceConditionDisputeTimeoutWindowCreatedTooEarly(uint256 windowCreationTimestamp, uint256 minTimestamp);
error RaceConditionUnexpectedBlockCalldataPosted(
    bytes32 forkId, uint256 blockHeight, address participant, bytes32 blockCalldataCommitment
);
error RaceConditionGenesisTimestampNotAvailable(bytes32 channelId, bytes32 originForkId, bytes32 forkId);
error RaceConditionOnChainSlashes(bytes32 channelId, uint256 disputeSlashCount, uint256 onChainSlashCount);
error RaceConditionJoinChannelSnapshotMismatch(bytes32 expectedSnapshotHash, bytes32 actualSnapshotHash);
error RaceConditionPendingInboundNotConsumed(
    bytes32 submittedInboundMessageBlockHash, bytes32 onChainInboundMessageBlockHash
);
error RaceConditionForceInboundJoinForkDisputed(bytes32 channelId, bytes32 forkId);
error ErrorDisputeThrottled(address disputer, uint256 throttleExpiry, uint256 currentTimestamp);
error ErrorDuplicateSelectorRegistration(bytes4 selector);
error ErrorRouteTargetHasNoCode(bytes4 selector, address target);

error RaceConditionDisputeWindowNotOpen(bytes32 channelId, bytes32 forkId);
