pragma solidity ^0.8.8;

import "./DataTypes.sol";
import "./ProofTypes.sol";

//Just so typechain generates types for the structs below
contract DisputeTypes {
    constructor(
        Dispute memory a,
        SignedDispute memory b,
        DisputeConfirmation memory c,
        Timeout memory d,
        DisputeWindowReducedResult memory e,
        ReduceOutput memory f,
        OnChainSlash memory g,
        DisputeAuditingData memory h,
        FraudProofVerificationContext memory i,
        DisputeOutputState memory j
    ) {}
}

struct Dispute {
    // @notice Dispute input data
    DisputeInput input;
    /// @notice True if dispute was posted with auditing data calldata
    bool postedAuditingData;
    /// @notice Hash of output state (latest on-chain state)
    /// @dev created after from dispute resolution
    bytes32 outputSnapshotDataHash;
}

struct DisputeInput {
    /// @notice Channel ID
    bytes32 channelId;
    /// @notice Hash of genesis state (previous dispute output or latest on-chain state)
    /// @dev Used for state verification and fork creation
    bytes32 forkId;
    /// @notice encoded latest state (latest on-chain state)
    bytes32 latestStateSnapshotHash;
    /// @notice latest inbound message block hash committed on-chain
    bytes32 latestInboundMessageBlockHash;
    /// @notice block height for the latest inbound message block hash
    uint256 lastInboundMessageBlockHeight;
    /// @notice State proof for the dispute
    StateProof stateProof;
    /// @notice participants that were slashed on chain
    address[] onChainSlashes;
    /// @notice hash(DisputeAuditingData)
    bytes32 disputeAuditingDataHash;
    /// @notice Address of the disputer, this can be anyone who have a stake in the dispute on chain
    address disputer;
    // ========================== optional ===============================
    /// @notice Timeout for the dispute
    Timeout timeout;
    /// @notice Self removal for the dispute
    bool selfRemoval;
    /// @notice Admission requires an existing open window; acceptance supplies a dispute reason.
    bool requireExistingDisputeWindow;
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
    /// @dev True if timeout checks should ignore race condition checks on-chain - useful when the participant being timed out committed to a wrong block (is not linked to the latestState), but we can't prove deviation - explained more in the docs
    bool isForced;
    // ================== optional ==================
    address previousBlockProducer;
    bool previousBlockProducerPostedCalldata;
    bytes participantSignatureOnPreviousBlock;
}

struct DisputeWindow {
    bytes32 forkId;
    DisputeWindowEvidence evidence;
    DisputeWindowReducedResult reducedResult;
}

struct DisputeWindowEvidence {
    uint256 creationTimestamp;
    uint256 lastEvidenceSubmissionTimestamp;
    bytes32[] disputeCommitments;
    address[] hasPosted; // inefficient, occupies a whole storage slot for a single bit - ideally we do a bitmask later as a f(participants) -> makes it also easy to delete the entire bitmask later. For now this is ok.
}

struct DisputeWindowReducedResult {
    /// @dev reduced forkId
    bytes32 forkId;
    /// @dev reduction timestamp
    uint256 timestamp;
    address reducer;
}

struct ReduceOutput {
    Block latestBlock;
    address[] slashedParticipants;
    bytes32 latestInboundMessageBlockHash;
    uint256 latestInboundMessageBlockHeight;
    Timeout timeout;
    address[] selfRemovals;
}

struct OnChainSlash {
    address participant;
    uint256 timestamp;
}

/// @dev data for dispute auditing

struct DisputeAuditingData {
    SnapshotData genesisStateSnapshotData;
    StateSnapshot latestStateSnapshot;
    StateSnapshot[] milestoneSnapshots; //for K milestones there will be K-1 snapshots, since the first milestone is the genesisSnapshot
    bytes latestFinalizedStateStateMachineState;
    MessageBlock[] inboundMessageBlocks;
    /// @notice Stores all outbound message blocks since genesis
    /// @dev Covers the outbound message chain segment proven up to the challenge deadline (new fork)
    MessageBlock[] outboundMessageBlocks;
}

struct DisputeData {
    OnChainSlash[] onChainSlashes;
    mapping(bytes32 forkId => DisputeWindow) disputeWindowMap;
    bytes32[] disputedForks;
}

//Experimental - yet to be determined if needed and what should be the context
struct FraudProofVerificationContext {
    bytes32 channelId;
}

struct DisputeOutputState {
    bytes encodedModifiedState;
    MessageBlock outboundMessageBlock;
    Balance totalDeposits;
    Balance totalWithdrawals;
}
