pragma solidity ^0.8.8;

import "./DataTypes.sol";

//Just so typechain generates types for the structs bellow
contract DisputeTypes {
    constructor(
        Dispute memory a,
        BlockDoubleSignProof memory b,
        BlockEmptyProof memory c,
        BlockInvalidStateTransitionProof memory d,
        TimeoutThresholdProof memory e,
        TimeoutPriorInvalidProof memory f,
        DisputeNotLatestStateProof memory g,
        DisputeInvalidStateProof memory h,
        DisputeInvalidPreviousRecursiveProof memory i,
        DisputeInvalidExitChannelBlocksProof memory j,
        ForkMilestoneProof memory k,
        ForkProof memory l,
        StateProof memory m,
        Proof memory n,
        ProofType o
    ) {}
}

struct Dispute {
    /// @notice Channel ID
    bytes32 channelId;
    /// @notice Hash of genesis state (previous dispute output or latest on-chain state)
    /// @dev Used for state verification and fork creation
    bytes32 genesisStateSnapshotHash;
    /// @notice encoded latest state (latest on-chain state)
    bytes32 latestStateSnapshotHash;
    /// @notice State proof for the dispute
    StateProof stateProof;
    /// @notice Fraud proofs for the dispute
    Proof[] fraudProofs;
    /// @notice participants that were slashed on chain
    address[] onChainSlashes;
    /// @dev Hash of the latest block (head) of the JoinChannel blockchain present on-chain in dispute on-chain storage.
    bytes32 onChainLatestJoinChannelBlockHash;
    /// @notice Hash of output state (latest on-chain state)
    /// @dev created after from dispute resolution
    bytes32 outputStateSnapshotHash;
    /// @notice Stores all exits since genesis
    /// @dev the time range of the exit is from genesis to the challenge deadline (new fork)
    ExitChannelBlock[] exitChannelBlocks;
    /// @notice hash(DisputeAuditingData)
    bytes32 disputeAuditingDataHash;
    /// @notice Address of the disputer, this can be anyone who have a stake in the dispute on chain
    address disputer;
    /// @notice Index of the dispute
    uint disputeIndex;
    // ========================== optional ===============================
    /// @notice Previous recursive dispute uint
    uint previousRecursiveDisputeIndex; // default value type(uint).max
    /// @notice Timeout for the dispute
    Timeout timeout;
    /// @notice Self removal for the dispute
    bool selfRemoval;
}

struct ForkMilestoneProof {
    BlockConfirmation[] blockConfirmations;
}

struct ForkProof {
    ForkMilestoneProof[] forkMilestoneProofs;
}

/// @notice Proof of state finality within a fork
struct StateProof {
    /// @dev proves the last finalized block in the fork
    ForkProof forkProof;
    /// @dev a list of signed blocks that cryptographically connect the last milestone in the forkProof
    SignedBlock[] signedBlocks;
}

//Fraud Proof Types:

struct Proof {
    ProofType proofType;
    bytes encodedProof;
}

enum ProofType {
    // Block releated fraud proofs
    BlockDoubleSign,
    BlockEmptyBlock,
    BlockInvalidStateTransition,
    BlockOutOfGas,
    // Timeout related fraud proofs
    TimeoutThreshold,
    TimeoutPriorInvalid,
    TimeoutParticipantNoNext,
    // Dispute fraud proofs
    DisputeNotLatestState,
    DisputeInvalid,
    DisputeInvalidRecursive,
    DisputeOutOfGas,
    DisputeInvalidOutputState,
    DisputeInvalidStateProof,
    DisputeInvalidPreviousRecursive,
    DisputeInvalidExitChannelBlocks
}

// ========================== Block related fraud proofs ==========================
struct BlockEmptyProof {
    SignedBlock emptyBlock;
    SignedBlock previousBlock;
}

struct BlockInvalidStateTransitionProof {
    SignedBlock invalidBlock;
    SignedBlock previousBlock;
    StateSnapshot previousBlockStateSnapshot;
    bytes previousStateStateMachineState;
}


struct BlockDoubleSignProof {
    SignedBlock block1;
    SignedBlock block2;
}

// ========================== Dispute related fraud proofs ==========================
struct DisputeNotLatestStateProof {
    BlockConfirmation newerBlock;
    Dispute originalDispute;
    uint originalDisputeTimestamp;
}

struct DisputeInvalidStateProof {
    Dispute dispute;
}

struct DisputeInvalidPreviousRecursiveProof {
    Dispute invalidRecursiveDispute;
    Dispute originalDispute;
    uint originalDisputeTimestamp;
    uint invalidRecursiveDisputeTimestamp;
    bytes invalidRecursiveDisputeOutputState;
}

struct DisputeInvalidExitChannelBlocksProof {
    Dispute dispute;
}

// ========================== Timeout related fraud proofs ==========================

struct TimeoutThresholdProof {
    BlockConfirmation thresholdBlock;
    Dispute timedOutDispute;
    uint timedOutDisputeTimestamp;
    bytes latestStateSnapshot;
}

struct TimeoutPriorInvalidProof {
    Dispute originalDispute;
    Dispute recursiveDispute;
    uint originalDisputeTimestamp;
    uint recursiveDisputeTimestamp;
}

/// @dev a pair consisting of first index (index of the malicious dispute) and last index (last index in the array)
struct DisputePair {
    uint firstIndex;
    uint lastIndex;
}

/// @dev data for dispute auditing
struct DisputeAuditingData {
    StateSnapshot genesisStateSnapshot;
    StateSnapshot latestStateSnapshot;
    StateSnapshot outputStateSnapshot;
    StateSnapshot[] milestoneSnapshots; //for K milestones there will be K-1 snapshots, since the first milestone is the genesisSnapshot
    bytes latestStateStateMachineState;
    JoinChannelBlock[] joinChannelBlocks;
    uint timestamp;
    // ========================== optional ===============================
    Dispute previousDispute; // (optional) needed to verify 'this' dispute genesis against the previous dispute outputSnapshot or genesisSnapshot (in the case of a recursive dispute) - if not present, genesis is the latest on-chain Snapshot
    uint previousDisputeTimestamp; // (optional) needed to verify the commitment of the previous dispute
}

struct DisputeData {
    DisputePair[] disputePairs;
    address[] onChainSlashedParticipants;
    address[] pendingParticipants;
    bytes32 latestJoinChannelBlockHash;
    bytes32[] disputeCommitments; //hash(Dispute Struct, block.timestamp)
}

//Experimental - yet to be determined if needed and what should be the context
struct FraudProofVerificationContext {
    bytes32 channelId;
}
