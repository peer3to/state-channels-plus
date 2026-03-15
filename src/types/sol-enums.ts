// Auto-generated from Solidity contracts. Do not edit manually.

export enum FraudProofType {
    BlockDoubleSign = 100,
    BlockInvalidStateTransition,
    WrongGenesis,
    InvalidTimestamp,
    ForgedInboundMessageBlock
}

export enum DisputeFraudProofType {
    DisputeNotLatestState = 200,
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
    InvalidDisputeReason
}

export const toSolidityFraudProofType = (value: FraudProofType) => value % 100;

export const toSolidityDisputeFraudProofType = (value: DisputeFraudProofType) => value % 200;
