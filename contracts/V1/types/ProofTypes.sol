pragma solidity ^0.8.8;

import "./DataTypes.sol";
import "./DisputeTypes.sol";

contract ProofTypes {
    constructor(MilestoneProof memory a, StateProof memory b, FraudProof memory c, DisputeFraudProof memory d) {}
}

/// @notice A linked run of blocks. Its first block is proven final by the union threshold of the previous final
/// point, or the run holds the anchor block (final without a threshold), or it is a genesis-linked block-0 run.
/// Blocks after the proven point are the unfinalized tail.
struct MilestoneProof {
    BlockConfirmation[] blockConfirmations;
}

/// @notice FraudProof of state finality within a fork
struct StateProof {
    /// @dev milestones only; the latest state is the last block of the last milestone; empty = the fork genesis
    MilestoneProof[] milestones;
}

/// @notice The input of one state-proof walk; the start (anchor) is read from storage or supplied locally.
struct ProofWalkInput {
    bytes32 channelId;
    bytes32 forkId;
    StateProof stateProof;
    /// @dev read when the walk starts from the fork genesis
    SnapshotData genesisStateSnapshotData;
    /// @dev one entry per milestone; read only for milestones that prove a threshold hop
    StateSnapshot[] milestoneSnapshots;
}

/// @notice The result of one state-proof walk. When `valid` is false, only `snapshotMismatch` and the failure fields
/// are usable.
struct ProofWalkResult {
    bool valid;
    /// @dev the walk failed because a supplied milestone snapshot is not the one its first block commits to
    bool snapshotMismatch;
    /// @dev the actual same-fork non-genesis start selected by this walk
    bool usedNonGenesisStart;
    StateSnapshot startSnapshot;
    /// @dev the start snapshot, or the last threshold-proven snapshot
    StateSnapshot finalizedSnapshot;
    /// @dev the last milestone's unfinalized tail starts at this index; its length means no tail
    uint256 replayBlockIndex;
    /// @dev when `valid` is false: the milestone whose walk step failed
    uint256 failedMilestoneIndex;
    /// @dev when `valid` is false: the step failed on a per-block rule (decoding, fork or channel, link, signature)
    bool isBlockFault;
    /// @dev with `isBlockFault`: the block of that milestone
    uint256 failedBlockIndex;
}

//Fraud FraudProof Types:

struct FraudProof {
    FraudProofType proofType;
    address participant; // The participant that is being slashed - encoded proof returns the same address when run.
    bytes encodedProof;
}

enum FraudProofType {
    // Block related fraud proofs
    BlockDoubleSign,
    BlockInvalidStateTransition,
    WrongGenesis,
    InvalidTimestamp,
    ForgedInboundMessageBlock
}

struct DisputeFraudProof {
    DisputeFraudProofType proofType;
    address participant; // The participant that is being slashed - encoded proof returns the same address when run.
    Dispute dispute;
    bytes encodedProof;
}

enum DisputeFraudProofType {
    DisputeNotLatestState,
    DisputeInvalidOutputState,
    DisputeInvalidStateProof,
    DisputeInvalidBalanceInvariant,
    DisputeOnChainSlashesNotSubset,
    TimeoutThreshold,
    TimeoutCalldataPosted,
    TimeoutNotLinkedToLatestState,
    TimeoutParticipantNotNext,
    TimeoutTooEarly,
    DisputeInvalidBlockInStateProofApplyFraudProof,
    DisputeLastMilestoneNotFinalAndNoAuditingData,
    InvalidDisputeReason,
    DisputeStateProofHeaderMismatch,
    DisputeInboundHashNotInChain,
    DisputeInvalidBlockStructure,
    DisputeBlockAuthorNotParticipant,
    DisputeInboundAnchorBehindLatestState,
    DisputeStateProofBelowOnChainAnchor,
    TimeoutSupersededByFinalState,
    DisputeConflictsWithFinalState
}
