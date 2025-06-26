pragma solidity ^0.8.8;

import "./DataTypes.sol";
import "./ProofTypes.sol";

//Just so typechain generates types for the structs bellow
contract DisputeTypes {
    constructor(Dispute memory a, MilestoneProof memory b, StateProof memory c, FraudProof memory d, FraudProofType e) {}
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
    FraudProof[] fraudProofs;
    /// @notice participants that were slashed on chain
    address[] onChainSlashes;
    /// @dev Hash of the latest block (head) of the JoinChannel blockchain present on-chain in dispute on-chain storage.
    bytes32 onChainLatestJoinChannelBlockHash;
    /// @notice Hash of output state (latest on-chain state)
    /// @dev created after from dispute resolution
    bytes32 outputSnapshotDataHash;
    /// @notice hash(DisputeAuditingData)
    bytes32 disputeAuditingDataHash;
    /// @notice Address of the disputer, this can be anyone who have a stake in the dispute on chain
    address disputer;
    // ========================== optional ===============================
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

struct Timeout {
    /// @dev the participant that is being timed out
    address participant;
    /// @dev the block height at which participant is removed from the channel (fork)
    uint256 blockHeight;
    /// @dev minimum timestamp where this timeout is valid
    uint256 minTimeStamp;
    /// @dev the forkId at which the participant is timed out
    bytes32 forkId;
    /// @dev True if timeout checks should ignore race condition checks on-chain - usefull when the participant being tiemdout committed to a wrong block (is not linked to the latestState), but we can't prove deviation - explained more in the docs
    bool isForced;
    // ================== optional ==================
    address previousBlockProducer;
    bool previousBlockProducerPostedCalldata;
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
    /// @dev reduced forkId
    bytes32 forkId;
    uint256 forkGenesisTimestamp;
    /// @dev reduction timestamp
    uint256 timestamp;
    address reducer;
}

struct ReduceOutput {
    Block latestBlock;
    address[] slashedParticipants;
    bytes32 latestJoinChannelBlockHash;
    Timeout timeout;
    address[] selfRemovals;
    uint256 forkGenesisTimestamp;
}

struct OnChainSlash {
    address participant;
    uint256 timestamp;
}

struct OnChainJoinChannel {
    bytes32 joinChannelBlockHash;
    uint256 timestamp;
}
/// @dev data for dispute auditing

struct DisputeAuditingData {
    StateSnapshot genesisStateSnapshot;
    StateSnapshot latestStateSnapshot;
    StateSnapshot outputStateSnapshot;
    StateSnapshot[] milestoneSnapshots; //for K milestones there will be K-1 snapshots, since the first milestone is the genesisSnapshot
    bytes latestStateStateMachineState;
    JoinChannelBlock[] joinChannelBlocks;
    /// @notice Stores all exits since genesis
    /// @dev the time range of the exit is from genesis to the challenge deadline (new fork)
    ExitChannelBlock[] exitChannelBlocks;
}

struct DisputeData {
    OnChainSlash[] onChainSlashes;
    OnChainJoinChannel[] onChainJoinChannels;
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
