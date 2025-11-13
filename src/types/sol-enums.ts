// Auto-generated from Solidity contracts. Do not edit manually.

export enum FraudProofType {
    BlockDoubleSign,
    BlockInvalidStateTransition,
    WrongGenesis,
    InvalidTimestamp
}

export enum DisputeFraudProofType {
    DisputeNotLatestState,
    DisputeInvalidOutputState,
    DisputeInvalidStateProofWithoutAuditingDataIntegrityVerified,
    DisputeInvalidStateProofWithAuditingDataIntegrityVerified,
    DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidExitChannelBlocks,
    DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerified,
    DisputeInvalidBalanceInvariant,
    DisputeOnChainSlashesNotSubset,
    TimeoutThreshold,
    TimeoutCalldataPosted,
    TimeoutNotLinkedToLatestState,
    TimeoutParticipantNotNext,
    TimeoutTooEarly
}
