// All errors from contracts/V1/StateChannelDiamondProxy/Errors.sol

export enum ContractErrors {
    // Calldata errors
    BLOCK_CALLDATA_TIMESTAMP_TOO_LATE = "ErrorBlockCalldataTimestampTooLate",
    BLOCK_CALLDATA_ALREADY_POSTED = "ErrorBlockCalldataAlreadyPosted",

    // StateSnapshot errors
    STATE_SNAPSHOT_NOT_VALID = "ErrorStateSnapshotNotValid",
    INVALID_STATE_PROOF = "ErrorInvalidStateProof",
    FIRST_EXIT_CHANNEL_BLOCK_INVALID = "ErrorFirstExitChannelBlockInvalid",
    EXIT_CHANNEL_BLOCKS_NOT_LINKED = "ErrorExitChannelBlocksNotLinked",
    LAST_SNAPSHOT_INVALID = "ErrorLastSnapshotInvalid",
    LAST_SNAPSHOT_DOES_NOT_MATCH_GENESIS = "ErrorLastSnapshotDoesNotMatchGenesis",
    SNAPSHOTS_NOT_PROVIDED = "ErrorSnapshotsNotProvided",
    SNAPSHOT_FORK_MISMATCH = "ErrorStanpshotForkMismatch",

    // Join channel errors
    JOIN_CHANNEL_EXPIRED = "ErrorJoinChannelExpired",
    JOIN_CHANNEL_INVALID_SIGNATURE = "ErrorJoinChannelInvalidSignature",

    // Exit channel errors
    WITHDRAWAL_FAILED = "ErrorWithdrawalFailed",
    CANT_WITHDRAW_MORE_THAN_DEPOSITS = "CantWithdrawMoreThanDeposits",

    // Dispute errors
    DISPUTER_NOT_MSG_SENDER = "ErrorDisputerNotMsgSender",
    TIMEOUT_NOT_LINKED_TO_PREVIOUS_BLOCK = "ErrorTimeoutNotLinkedToPreviousBlock",
    LINKING_PREVIOUS_BLOCK = "ErrorLinkingPreviousBlock",
    JOIN_CHANNEL_FAILED = "ErrorJoinChannelFailed",
    DISPUTE_CHALLENGE_PERIOD_EXPIRED = "ErrorDisputeChallengePeriodExpired",
    DISPUTE_ALREADY_POSTED = "ErrorDisputeAlreadyPosted",
    CANT_PARTICIPATE_IN_DISPUTE = "ErrorCantParticipateInDispute",
    AUDITING_DATA_HASH_MISMATCH = "ErrorAuditingDataHashMismatch",

    // Reduce errors
    NO_DISPUTES_PROVIDED = "ErrorNoDisputesProvided",
    DISPUTE_KILL_PERIOD_NOT_EXPIRED = "ErrorDisputeKillPeriodNotExpired",
    DISPUTE_ALREADY_REDUCED = "ErrorDisputeAlreadyReduced",

    // Auditing errors
    DISPUTE_AUDITING_REQUIRED = "ErrorDisputeAuditingRequired",
    DISPUTE_WRONG_AUDITING_DATA = "ErrorDisputeWrongAuditingData",
    DISPUTE_COMMITMENT_NOT_AVAILABLE = "ErrorDisputeCommitmentNotAvailable",
    DISPUTE_EXPIRED = "ErrorDisputeExpired",
    DISPUTE_GENESIS_INVALID = "ErrorDisputeGenesisInvalid",
    DISPUTE_STATE_PROOF_INVALID = "ErrorDisputeStateProofInvalid",
    DISPUTE_STATE_MACHINE_JOINING_FAILED = "ErrorDisputeStateMachineJoiningFailed",
    DISPUTE_STATE_MACHINE_SLASHING_FAILED = "ErrorDisputeStateMachineSlashingFailed",
    DISPUTE_STATE_MACHINE_REMOVING_FAILED = "ErrorDisputeStateMachineRemovingFailed",
    DISPUTE_OUTPUT_STATE_SNAPSHOT_INVALID = "ErrorDisputeOutputStateSnapshotInvalid",
    DISPUTE_JOIN_CHANNEL_BLOCKS_INVALID = "ErrorDisputeJoinChannelBlocksInvalid",
    DISPUTE_EXIT_CHANNEL_BLOCKS_INVALID = "ErrorDisputeExitChannelBlocksInvalid",
    DISPUTE_BALANCE_INVARIANT_INVALID = "ErrorDisputeBalanceInvariantInvalid",
    INVALID_LATEST_STATE = "ErrorInvalidLatestState",

    // Race conditions
    DISPUTE_TIMEOUT_CALLDATA_POSTED = "ErrorDisputeTimeoutCalldataPosted",
    DISPUTE_TIMEOUT_PREVIOUS_BLOCK_PRODUCER_POSTED_CALLDATA_MISMATCH = "ErrorDisputeTimeoutPreviousBlockProducerPostedCalldataMismatch",
    DISPUTE_TIMEOUT_NOT_MIN_TIMESTAMP = "ErrorDisputeTimeoutNotMinTimestamp",

    // FraudProofs
    INVALID_FRAUD_PROOF = "ErrorInvalidFraudProof",

    // Double sign
    DOUBLE_SIGN_BLOCKS_NOT_SAME = "ErrorDoubleSignBlocksNotSame",
    NOT_EMPTY_BLOCK_FRAUD = "ErrorNotEmptyBlockFraud",
    NOT_SAME_CHANNEL_ID = "ErrorNotSameChannelId",
    INVALID_STATE_SNAPSHOT = "ErrorInvalidStateSnapshot",
    INVALID_BLOCK = "ErrorInvalidBlock",
    INVALID_STATE_SNAPSHOT_HASH = "ErrorInvalidStateSnapshotHash",
    VALID_STATE_TRANSITION = "ErrorValidStateTransition",

    // Incorrect data
    INCORRECT_LATEST_STATE_SNAPSHOT = "ErrorIncorrectLatestStateSnapshot"
}

// Convert enum values to ABI format for ethers
export const ERROR_ABI = Object.values(ContractErrors).map((errorName) => ({
    type: "error",
    name: errorName,
    inputs: []
}));
