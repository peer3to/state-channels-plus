pragma solidity ^0.8.8;

import "./DataTypes.sol";

contract DisputeFraudProofTypes {
    constructor(
        DisputeNotLatestState memory a,
        DisputeInvalidOutputState memory b,
        DisputeInvalidStateProofWithoutAuditingDataIntegrityVerifed memory c,
        DisputeInvalidStateProofWithAuditingDataIntegrityVerifed memory d,
        DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidExitChannelBlocks memory e,
        DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifed memory f,
        DisputeInvalidBalanceInvariant memory g,
        TimeoutThreshold memory h,
        TimeoutCalldataPosted memory i,
        TimeoutNotLinkedToLatestState memory j,
        TimeoutParticipantNotNext memory k,
        TimeoutTooEarly memory l
    ) {}
}

// ========================== Dispute related fraud proofs ==========================
// Every Dispute Fraud Proof has an implicit argument/field `Dispute dispute`

// This is sematically equivalent to SignedBlock, but logically it's any signature not only from the original block author
struct DisputeNotLatestState {
    bytes encodedBlock;
    bytes signature;
}

struct DisputeInvalidOutputState {
    DisputeAuditingData auditingData;
}

struct DisputeInvalidStateProofWithoutAuditingDataIntegrityVerifed {
    DisputeAuditingData auditingData;
}

struct DisputeInvalidStateProofWithAuditingDataIntegrityVerifed {
    DisputeAuditingData auditingData;
}

struct DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidExitChannelBlocks {
    DisputeAuditingData auditingData;
}

struct DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifed {
    DisputeAuditingData auditingData;
}

struct DisputeInvalidBalanceInvariant {
    DisputeAuditingData auditingData;
}

struct DisputeOnChainSlashesNotSubset {
    bool __; // this is not used, the implicit dispute field is enough to deduct
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
    Block postedBlock;
}

struct TimeoutCalldataPosted {
    Block postedBlock;
}
