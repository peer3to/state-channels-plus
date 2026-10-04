pragma solidity ^0.8.8;

import "./DataTypes.sol";
import "./DisputeTypes.sol";

contract ProofTypes {
    constructor(MilestoneProof memory a, StateProof memory b, FraudProof memory c, DisputeFraudProof memory d) {}
}

/// @notice A linked evidence run whose proven point is a normal snapshot anchor or its threshold-proven first block;
/// a single last genesis-linked run may remain unfinal. Linkage alone does not finalize block 0 or the whole run.
struct MilestoneProof {
    BlockConfirmation[] blockConfirmations;
}

/// @notice FraudProof of state finality within a fork
struct StateProof {
    /// @dev milestones only; the latest state is the last block of the last milestone; empty = the fork genesis
    MilestoneProof[] milestones;
}

/// @notice The input of one state-proof walk; the start is read from storage (or supplied by LocalDiamond).
struct ProofWalkInput {
    bytes32 channelId;
    bytes32 forkId;
    StateProof stateProof;
    /// @dev read by a genesis start and by an empty proof, unless the on-chain snapshot is that genesis
    SnapshotData genesisStateSnapshotData;
    /// @dev one entry per milestone, read only when finality is checked
    StateSnapshot[] milestoneSnapshots;
}

/// @notice The result of one state-proof walk. When `valid` is false, no other field is usable.
struct ProofWalkResult {
    bool valid;
    /// @dev the start snapshot, the last threshold-proven snapshot, or the fork genesis for an empty proof
    StateSnapshot finalizedSnapshot;
    /// @dev the last milestone's unfinal tail starts here; its length means no tail
    uint256 replayBlockIndex;
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
    DisputeStateProofBelowOnChainAnchor
}
