// Auto-generated from Solidity contracts. Do not edit manually.

export enum FraudProofType {
    BlockDoubleSign = 100,
    BlockInvalidStateTransition,
    WrongGenesis,
    InvalidTimestamp
}

export enum DisputeFraudProofType {
    DisputeNotLatestState = 200,
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
    TimeoutTooEarly,
    DisputeInvalidBlockInStateProofApplyFraudProof
}

export const toSolidityFraudProofType = (value: FraudProofType) => value % 100;

export const toSolidityDisputeFraudProofType = (value: DisputeFraudProofType) =>
    value % 200;
