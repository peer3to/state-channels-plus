pragma solidity ^0.8.8;

import "./DataTypes.sol";

//Just so typechain generates types for the structs bellow
contract DisputeTypes {
    constructor(
        Dispute memory a,
        BlockDoubleSignProof memory b,
        BlockEmptyProof memory c,
        BlockInvalidStateTransitionProof memory d,
        BlockOutOfGasProof memory e,
        TimeoutThresholdProof memory f,
        TimeoutPriorInvalidProof memory g,
        DisputeNotLatestStateProof memory h,
        DisputeOutOfGasProof memory i,
        DisputeInvalidOutputStateProof memory j,
        DisputeInvalidStateProof memory k,
        DisputeInvalidPreviousRecursiveProof memory l,
        DisputeInvalidExitChannelBlocksProof memory m,
        ForkMilestoneProof memory n,
        ForkProof memory o,
        StateProof memory p,
        Proof memory q,
        ProofType r
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
    /// @dev the blocknumber/height of the latest state
    uint latestStateHeight;
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
    /// @notice Address of the disputer, this can be anyone who have a stake in the dispute on chain
    address disputer;
    /// @notice Index of the dispute
    uint disputeIndex;
    /// @notice Stores all exits since genesis
    /// @dev the time range of the exit is from genesis to the challenge deadline (new fork)
    ExitChannelBlock[] exitChannelBlocks;
    // ========================== optional ===============================
    /// @notice Previous recursive dispute hash
    bytes32 previousRecursiveDisputeHash;
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
    DisputeInvalidPreeviousRecursive,
    DisputeInvalidExitChannelBlocks
}

// ========================== Block related fraud proofs ==========================
struct BlockEmptyProof {
    SignedBlock emptyBlock;
}

struct BlockInvalidStateTransitionProof {
    BlockConfirmation fraudBlockConfirmation;
    bytes encodedState;
}

struct BlockOutOfGasProof {
    BlockConfirmation fraudBlockConfirmation;
    bytes encodedState;
}

struct BlockDoubleSignProof {
    SignedBlock block1;
    SignedBlock block2;
}

// ========================== Dispute related fraud proofs ==========================
struct DisputeNotLatestStateProof {
    BlockConfirmation newerBlock;
    Dispute originalDispute;
}

struct DisputeOutOfGasProof {
    Dispute dispute;
}

struct DisputeInvalidOutputStateProof {

    Dispute dispute;
}

struct DisputeInvalidStateProof {
    Dispute dispute;
}

struct DisputeInvalidPreviousRecursiveProof {
    Dispute dispute;
}

struct DisputeInvalidExitChannelBlocksProof {
    Dispute dispute;
}

// ========================== Timeout related fraud proofs ==========================

struct TimeoutThresholdProof {
    BlockConfirmation thresholdBlock;
    Dispute timedOutDispute;
}

struct TimeoutPriorInvalidProof {
    Dispute originalDispute;
}

/// @dev a pair consisting of first index (index of the malicious dispute) and last index (last index in the array)
struct DisputePair {
    uint firstIndex;
    uint lastIndex;
}

/// @dev data for dispute auditing
struct DisputeAuditingData {
    bytes genesisStateSnapshot;
    bytes latestStateSnapshot;
    bytes latestStateStateMachineState;
    uint disputeTimestamp;
    JoinChannelBlock[] joinChannelBlocks;
}