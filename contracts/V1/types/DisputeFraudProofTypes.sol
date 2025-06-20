pragma solidity ^0.8.8;

import "./DataTypes.sol";

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
