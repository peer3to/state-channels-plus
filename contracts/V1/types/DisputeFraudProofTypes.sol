pragma solidity ^0.8.8;

import "./DataTypes.sol";

contract DisputeFraudProofTypes {
    constructor(
        DisputeNotLatestStateProof memory a,
        DisputeOutOfGasProof memory b,
        DisputeInvalidOutputStateProof memory c,
        DisputeInvalidStateProof memory d,
        DisputeInvalidPreviousRecursiveProof memory e,
        DisputeInvalidExitChannelBlocksProof memory f,
        TimeoutThresholdProof memory g,
        TimeoutCalldataPostedProof memory h,
        TimeoutParticipantNotNextProof memory i
    ) {}
}

// ========================== Dispute related fraud proofs ==========================
// This is sematically equivalent to SignedBlock, but logically it's any signature not only from the original block author

struct DisputeNotLatestStateProof {
    bytes encodedBlock;
    bytes signature;
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
    BlockConfirmation thresholdBlock; // only N/N on single block - no virtual voting
    StateSnapshot latestStateSnapshot;
}

struct TimeoutCalldataPostedProof {
    Block postedBlock;
}

struct TimeoutParticipantNotNextProof {
    Dispute originalDispute;
    Dispute recursiveDispute;
    uint256 originalDisputeTimestamp;
    uint256 recursiveDisputeTimestamp;
}
