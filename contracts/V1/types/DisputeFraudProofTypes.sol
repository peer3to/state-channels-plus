pragma solidity ^0.8.8;

import "./DataTypes.sol";

contract DisputeFraudProofTypes {
    constructor(
        DisputeNotLatestState memory a,
        DisputeInvalidOutputState memory b,
        DisputeInvalidStateProofWithoutAuditingDataIntegrityVerified memory c,
        DisputeInvalidStateProofWithAuditingDataIntegrityVerified memory d,
        DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocks memory e,
        DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerified memory f,
        DisputeInvalidBalanceInvariant memory g,
        DisputeOnChainSlashesNotSubset memory h,
        TimeoutThreshold memory i,
        TimeoutCalldataPosted memory j,
        TimeoutNotLinkedToLatestState memory k,
        TimeoutParticipantNotNext memory l,
        TimeoutTooEarly memory m,
        DisputeInvalidBlockInStateProofApplyFraudProof memory n
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
    DisputeAuditingData auditingData;
}

struct DisputeInvalidStateProofWithoutAuditingDataIntegrityVerified {
    DisputeAuditingData auditingData;
}

struct DisputeInvalidStateProofWithAuditingDataIntegrityVerified {
    DisputeAuditingData auditingData;
}

struct DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocks {
    DisputeAuditingData auditingData;
}

struct DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerified {
    DisputeAuditingData auditingData;
}

struct DisputeInvalidBalanceInvariant {
    DisputeAuditingData auditingData;
}

struct DisputeOnChainSlashesNotSubset {
    DisputeAuditingData auditingData;
}

// ========================== Timeout related fraud proofs ==========================

struct TimeoutThreshold {
    BlockConfirmation thresholdBlock; // only N/N on single block - no virtual voting
    DisputeAuditingData auditingData;
}

struct TimeoutNotLinkedToLatestState {
    bool __; // this is not used, the implicit dispute field is enough to deduct
}
// Linked to latestState, but participant is not next block author

struct TimeoutParticipantNotNext {
    DisputeAuditingData auditingData;
}

struct TimeoutTooEarly {
    DisputeAuditingData auditingData; // needed for snapshot.timestamp
    uint256 previousBlockOnChainTimestamp;
}

struct TimeoutCalldataPosted {
    DisputeAuditingData auditingData;
    SignedBlock postedBlock;
    uint256 onChainTimestamp;
    uint256 previousBlockOnChainTimestamp;
    SignedBlock previousBlockcalldata;
}

struct DisputeInvalidBlockInStateProofApplyFraudProof {
    FraudProof fraudProof;
    uint256 blockIndexInUnfinalizedPartOfStateProof;
}
