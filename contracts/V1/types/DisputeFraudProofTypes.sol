pragma solidity ^0.8.8;

import "./DataTypes.sol";

contract DisputeFraudProofTypes {
    constructor(
        DisputeNotLatestState memory a,
        DisputeInvalidOutputState memory b,
        DisputeInvalidStateProof memory c,
        DisputeInvalidBalanceInvariant memory g,
        DisputeOnChainSlashesNotSubset memory h,
        TimeoutThreshold memory i,
        TimeoutCalldataPosted memory j,
        TimeoutNotLinkedToLatestState memory k,
        TimeoutParticipantNotNext memory l,
        TimeoutTooEarly memory m,
        DisputeInvalidBlockInStateProofApplyFraudProof memory n,
        DisputeLastMilestoneNotFinalAndNoAuditingData memory o,
        InvalidDisputeReason memory p,
        DisputeStateProofHeaderMismatch memory q,
        DisputeInboundHashNotInChain memory r,
        DisputeInvalidBlockStructure memory s,
        DisputeBlockAuthorNotParticipant memory t,
        DisputeInboundAnchorBehindLatestState memory u,
        DisputeStateProofBelowOnChainAnchor memory v
    ) {}
}

// ========================== Dispute related fraud proofs ==========================
// Every Dispute Fraud Proof has an implicit argument/field `Dispute dispute`

// This is semantically equivalent to SignedBlock, but logically it's any signature not only from the original block author
struct DisputeNotLatestState {
    bytes encodedBlock;
    bytes signature;
}

struct DisputeInvalidOutputState {
    StateSnapshot latestStateSnapshot;
    bytes latestStateMachineState;
    MessageBlock[] inboundMessageBlocks;
}

struct DisputeInvalidStateProof {
    DisputeAuditingData auditingData;
}

/// @dev `latestStateSnapshot` must be the dispute's latest state
struct DisputeInvalidBalanceInvariant {
    StateSnapshot latestStateSnapshot;
    bytes latestStateMachineState;
}

struct DisputeOnChainSlashesNotSubset {
    bool __;
}

// ========================== Timeout related fraud proofs ==========================

struct TimeoutThreshold {
    BlockConfirmation thresholdBlock; // only N/N on single block - no virtual voting
    StateSnapshot latestStateSnapshot;
    StateSnapshot thresholdStateSnapshot;
}

struct TimeoutNotLinkedToLatestState {
    bool __; // this is not used, the implicit dispute field is enough to deduct
}
// Linked to latestState, but participant is not next block author

struct TimeoutParticipantNotNext {
    StateSnapshot latestStateSnapshot;
    bytes latestStateStateMachineState;
}

struct TimeoutTooEarly {
    SnapshotData genesisStateSnapshotData;
    uint256 previousBlockOnChainTimestamp;
}

struct TimeoutCalldataPosted {
    SnapshotData genesisStateSnapshotData;
    StateSnapshot latestStateSnapshot;
    bytes latestStateStateMachineState;
    SignedBlock postedBlock;
    uint256 onChainTimestamp;
    uint256 previousBlockOnChainTimestamp;
    SignedBlock previousBlockcalldata;
}

// The block-pointing wrappers locate the challenged block at `blockIndex` of the last milestone; only that milestone
// is challengeable (see `StateProofFacet.isBlockChallengeEligible`).
struct DisputeInvalidBlockInStateProofApplyFraudProof {
    FraudProof fraudProof;
    uint256 blockIndex;
}

struct DisputeLastMilestoneNotFinalAndNoAuditingData {
    bool __;
}

struct InvalidDisputeReason {
    StateSnapshot latestStateSnapshot;
}

struct DisputeStateProofHeaderMismatch {
    bool __;
}

struct DisputeInboundHashNotInChain {
    bool __;
}

// dispute.input.lastInboundMessageBlockHeight is not ahead of
// latestStateSnapshot.snapshotData.latestInboundMessageBlockHeight
struct DisputeInboundAnchorBehindLatestState {
    StateSnapshot latestStateSnapshot;
}

struct DisputeInvalidBlockStructure {
    uint256 blockIndex;
}

struct DisputeBlockAuthorNotParticipant {
    uint256 blockIndex;
    SignedBlock previousBlock;
    StateSnapshot previousStateSnapshot;
    StateSnapshot resultingStateSnapshot;
}

// The dispute's latest claimed block is below the same-fork non-genesis on-chain snapshot, which the chain reads itself.
struct DisputeStateProofBelowOnChainAnchor {
    bool __;
}
