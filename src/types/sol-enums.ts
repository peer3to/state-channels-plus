// Auto-generated from Solidity contracts. Do not edit manually.

export enum FraudProofType {
    BlockDoubleSign = 0,
    BlockInvalidStateTransition = 1,
    WrongGenesis = 2,
    InvalidTimestamp = 3
}

export enum DisputeFraudProofType {
    DisputeNotLatestState = 0,
    DisputeInvalidOutputState = 1,
    DisputeInvalidStateProofWithoutAuditingDataIntegrityVerified = 2,
    DisputeInvalidStateProofWithAuditingDataIntegrityVerified = 3,
    DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidExitChannelBlocks = 4,
    DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerified = 5,
    DisputeInvalidBalanceInvariant = 6,
    DisputeOnChainSlashesNotSubset = 7,
    TimeoutThreshold = 8,
    TimeoutCalldataPosted = 9,
    TimeoutNotLinkedToLatestState = 10,
    TimeoutParticipantNotNext = 11,
    TimeoutTooEarly = 12
}
