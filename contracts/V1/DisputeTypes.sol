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
        DisputeOutOfGasProof memory h,
        DisputeInvalidOutputStateProof memory i,
        DisputeInvalidStateProof memory j,
        DisputeInvalidPreviousRecursiveProof memory k,
        DisputeInvalidExitChannelBlocksProof memory l,
        MilestoneProof memory m,
        StateProof memory o,
        Proof memory p,
        ProofType q
    ) {}
}

struct Dispute {
    /// @notice Channel ID
    bytes32 channelId;
    /// @notice Hash of genesis state (previous dispute output or latest on-chain state)
    /// @dev Used for state verification and fork creation
    bytes32 genesisSnapshotDataHash;
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
    bytes32 outputSnapshotDataHash;
    /// @notice Stores all exits since genesis
    /// @dev the time range of the exit is from genesis to the challenge deadline (new fork)
    ExitChannelBlock[] exitChannelBlocks;
    /// @notice hash(DisputeAuditingData)
    bytes32 disputeAuditingDataHash;
    /// @notice Address of the disputer, this can be anyone who have a stake in the dispute on chain
    address disputer;
    /// @notice Index of the dispute
    uint256 disputeIndex;
    // ========================== optional ===============================
    /// @notice Previous recursive dispute uint
    uint256 previousRecursiveDisputeIndex; // default value type(uint).max
    /// @notice Timeout for the dispute
    Timeout timeout;
    /// @notice Self removal for the dispute
    bool selfRemoval;
}

struct SignedDispute {
    bytes encodedDispute;
    bytes signature;
}

struct DisputeConfirmation {
    SignedDispute signedDispute;
    bytes[] signatures;
}

struct DisputeWindow {
    bytes32 forkId;
    DisputeWindowEvidence evidence;
    DisputeWindowReducedResult reducedResult;
}

struct DisputeWindowEvidence {
    uint256 creationTimestamp;
    bytes32[] disputeCommitments;
    mapping(address => bool) hasPosted; // inefficient, occupies a whole storage slot for a single bit - idealy we do a bitmask later as a f(participants) -> makes it also easy to delete the entire bitmask later. For now this is ok.
}

struct DisputeWindowReducedResult {
    bytes32 reducedForkId;
    uint256 reductionTimestamp;
    address reducer;
}

struct ReduceOutput {
    Block latestBlock;
    address[] slashedParticipants;
    bytes32 latestJoinChannelBlockHash;
    Timeout timeout;
    address[] selfRemovals;
}

struct OnChainSlash {
    address participant;
    uint256 timestamp;
}

struct MilestoneProof {
    BlockConfirmation[] blockConfirmations;
}

/// @notice Proof of state finality within a fork
struct StateProof {
    /// @dev proves the last finalized block in the fork
    MilestoneProof[] milestones;
    /// @dev a list of signed blocks that cryptographically connect the last milestone in the milestones
    SignedBlock[] signedBlocks;
}

//Fraud Proof Types:

struct Proof {
    ProofType proofType;
    address participant; // The participant that is being slashed - encoded proof returns the same address when run.
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
    uint256 originalDisputeTimestamp;
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
    Dispute invalidRecursiveDispute;
    Dispute originalDispute;
    uint256 originalDisputeTimestamp;
    uint256 invalidRecursiveDisputeTimestamp;
    bytes latestStateSnapshot;
    bytes invalidRecursiveDisputeOutputState;
}

struct DisputeInvalidExitChannelBlocksProof {
    Dispute dispute;
}

// ========================== Timeout related fraud proofs ==========================

struct TimeoutThresholdProof {
    BlockConfirmation thresholdBlock;
    Dispute timedOutDispute;
    uint256 timedOutDisputeTimestamp;
    bytes latestStateSnapshot;
}

struct TimeoutPriorInvalidProof {
    Dispute originalDispute;
    Dispute recursiveDispute;
    uint256 originalDisputeTimestamp;
    uint256 recursiveDisputeTimestamp;
}

/// @dev a pair consisting of first index (index of the malicious dispute) and last index (last index in the array)
struct DisputePair {
    uint256 firstIndex;
    uint256 lastIndex;
}

/// @dev data for dispute auditing
struct DisputeAuditingData {
    StateSnapshot genesisStateSnapshot;
    StateSnapshot latestStateSnapshot;
    StateSnapshot outputStateSnapshot;
    StateSnapshot[] milestoneSnapshots; //for K milestones there will be K-1 snapshots, since the first milestone is the genesisSnapshot
    bytes latestStateStateMachineState;
    JoinChannelBlock[] joinChannelBlocks;
}

struct DisputeData {
    OnChainSlash[] onChainSlashes;
    address[] pendingParticipants;
    bytes32 latestJoinChannelBlockHash;
    mapping(bytes32 forkId => DisputeWindow) disputeWindowMap;
    bytes32[] disputedForks;
}

//Experimental - yet to be determined if needed and what should be the context
struct FraudProofVerificationContext {
    bytes32 channelId;
}

struct DisputeOutputState {
    bytes encodedModifiedState;
    ExitChannelBlock exitBlock;
    Balance totalDeposits;
    Balance totalWithdrawals;
}

struct DisputeProof {
    Dispute dispute;
    StateSnapshot outputStateSnapshot;
    uint256 timestamp;
    bytes[] signatures;
}
