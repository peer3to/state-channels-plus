pragma solidity ^0.8.8;

import "./DataTypes.sol";
import "./DisputeTypes.sol";

contract ProofTypes {
    constructor(MilestoneProof memory a, StateProof memory b, FraudProof memory c, DisputeFraudProof memory d) {}
}

struct MilestoneProof {
    BlockConfirmation[] blockConfirmations;
}

/// @notice FraudProof of state finality within a fork
struct StateProof {
    /// @dev proves the last finalized block in the fork
    MilestoneProof[] milestones;
    /// @dev a list of signed blocks that cryptographically connect the last milestone in the milestones
    SignedBlock[] signedBlocks;
}

//Fraud FraudProof Types:

struct FraudProof {
    FraudProofType proofType;
    address participant; // The participant that is being slashed - encoded proof returns the same address when run.
    bytes encodedProof;
}

enum FraudProofType {
    // Block releated fraud proofs
    BlockDoubleSign,
    BlockEmptyBlock,
    BlockInvalidStateTransition,
    BlockOutOfGas,
    InvalidTimestamp,
    WrongGenesis
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
    DisputeInvalidStateProofWithoutAuditingDataIntegrityVerifed,
    DisputeInvalidStateProofWithAuditingDataIntegrityVerifed,
    DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidExitChannelBlocks,
    DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifed,
    DisputeInvalidBalanceInvariant,
    DisputeOnChainSlashesNotSubset,
    TimeoutThreshold,
    TimeoutCalldataPosted,
    TimeoutNotLinkedToLatestState,
    TimeoutParticipantNotNext,
    TimeoutTooEarly
}
