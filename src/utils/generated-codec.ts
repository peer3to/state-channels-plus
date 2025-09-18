import {
    BlockEthersType,
    TransactionEthersType,
    TransactionHeaderEthersType,
    TransactionBodyEthersType,
    SignedBlockEthersType,
    BlockConfirmationEthersType,
    BalanceEthersType,
    JoinChannelEthersType,
    JoinChannelBlockEthersType,
    SignedJoinChannelEthersType,
    JoinChannelConfirmationEthersType,
    ExitChannelEthersType,
    ExitChannelBlockEthersType,
    StateSnapshotEthersType,
    SnapshotDataEthersType,
    OnChainJoinChannelEthersType,
    BlockCommitmentEthersType,
    DisputeNotLatestStateProofEthersType,
    DisputeOutOfGasProofEthersType,
    DisputeEthersType,
    StateProofEthersType,
    MilestoneProofEthersType,
    FraudProofEthersType,
    TimeoutEthersType,
    DisputeInvalidOutputStateProofEthersType,
    DisputeInvalidStateProofEthersType,
    DisputeInvalidPreviousRecursiveProofEthersType,
    DisputeInvalidExitChannelBlocksProofEthersType,
    TimeoutThresholdProofEthersType,
    TimeoutCalldataPostedProofEthersType,
    TimeoutParticipantNotNextProofEthersType,
    SignedDisputeEthersType,
    DisputeConfirmationEthersType,
    DisputeWindowReducedResultEthersType,
    ReduceOutputEthersType,
    OnChainSlashEthersType,
    DisputeAuditingDataEthersType,
    FraudProofVerificationContextEthersType,
    DisputeOutputStateEthersType,
    BlockEmptyProofEthersType,
    BlockInvalidStateTransitionProofEthersType,
    BlockDoubleSignProofEthersType,
    InvalidTimestampProofEthersType,
    WrongGenesisProofEthersType,
    DisputeFraudProofEthersType
} from "../types/generated-ethers";
import { FraudProofType } from "../types/disputes";

export { FraudProofType } from "../types/disputes";

export enum Type {
    Block,
    Transaction,
    TransactionHeader,
    TransactionBody,
    SignedBlock,
    BlockConfirmation,
    Balance,
    JoinChannel,
    JoinChannelBlock,
    SignedJoinChannel,
    JoinChannelConfirmation,
    ExitChannel,
    ExitChannelBlock,
    StateSnapshot,
    SnapshotData,
    OnChainJoinChannel,
    BlockCommitment,
    DisputeNotLatestStateProof,
    DisputeOutOfGasProof,
    Dispute,
    StateProof,
    MilestoneProof,
    FraudProof,
    Timeout,
    DisputeInvalidOutputStateProof,
    DisputeInvalidStateProof,
    DisputeInvalidPreviousRecursiveProof,
    DisputeInvalidExitChannelBlocksProof,
    TimeoutThresholdProof,
    TimeoutCalldataPostedProof,
    TimeoutParticipantNotNextProof,
    SignedDispute,
    DisputeConfirmation,
    DisputeWindowReducedResult,
    ReduceOutput,
    OnChainSlash,
    DisputeAuditingData,
    FraudProofVerificationContext,
    DisputeOutputState,
    BlockEmptyProof,
    BlockInvalidStateTransitionProof,
    BlockDoubleSignProof,
    InvalidTimestampProof,
    WrongGenesisProof,
    DisputeFraudProof
}

export const TYPE_TO_ETHERS_TYPE_MAP = new Map<Type | FraudProofType, string>([
    [Type.Block, BlockEthersType],
    [Type.Transaction, TransactionEthersType],
    [Type.TransactionHeader, TransactionHeaderEthersType],
    [Type.TransactionBody, TransactionBodyEthersType],
    [Type.SignedBlock, SignedBlockEthersType],
    [Type.BlockConfirmation, BlockConfirmationEthersType],
    [Type.Balance, BalanceEthersType],
    [Type.JoinChannel, JoinChannelEthersType],
    [Type.JoinChannelBlock, JoinChannelBlockEthersType],
    [Type.SignedJoinChannel, SignedJoinChannelEthersType],
    [Type.JoinChannelConfirmation, JoinChannelConfirmationEthersType],
    [Type.ExitChannel, ExitChannelEthersType],
    [Type.ExitChannelBlock, ExitChannelBlockEthersType],
    [Type.StateSnapshot, StateSnapshotEthersType],
    [Type.SnapshotData, SnapshotDataEthersType],
    [Type.OnChainJoinChannel, OnChainJoinChannelEthersType],
    [Type.BlockCommitment, BlockCommitmentEthersType],
    [Type.DisputeNotLatestStateProof, DisputeNotLatestStateProofEthersType],
    [Type.DisputeOutOfGasProof, DisputeOutOfGasProofEthersType],
    [Type.Dispute, DisputeEthersType],
    [Type.StateProof, StateProofEthersType],
    [Type.MilestoneProof, MilestoneProofEthersType],
    [Type.FraudProof, FraudProofEthersType],
    [Type.Timeout, TimeoutEthersType],
    [
        Type.DisputeInvalidOutputStateProof,
        DisputeInvalidOutputStateProofEthersType
    ],
    [Type.DisputeInvalidStateProof, DisputeInvalidStateProofEthersType],
    [
        Type.DisputeInvalidPreviousRecursiveProof,
        DisputeInvalidPreviousRecursiveProofEthersType
    ],
    [
        Type.DisputeInvalidExitChannelBlocksProof,
        DisputeInvalidExitChannelBlocksProofEthersType
    ],
    [Type.TimeoutThresholdProof, TimeoutThresholdProofEthersType],
    [Type.TimeoutCalldataPostedProof, TimeoutCalldataPostedProofEthersType],
    [
        Type.TimeoutParticipantNotNextProof,
        TimeoutParticipantNotNextProofEthersType
    ],
    [Type.SignedDispute, SignedDisputeEthersType],
    [Type.DisputeConfirmation, DisputeConfirmationEthersType],
    [Type.DisputeWindowReducedResult, DisputeWindowReducedResultEthersType],
    [Type.ReduceOutput, ReduceOutputEthersType],
    [Type.OnChainSlash, OnChainSlashEthersType],
    [Type.DisputeAuditingData, DisputeAuditingDataEthersType],
    [
        Type.FraudProofVerificationContext,
        FraudProofVerificationContextEthersType
    ],
    [Type.DisputeOutputState, DisputeOutputStateEthersType],
    [Type.BlockEmptyProof, BlockEmptyProofEthersType],
    [
        Type.BlockInvalidStateTransitionProof,
        BlockInvalidStateTransitionProofEthersType
    ],
    [Type.BlockDoubleSignProof, BlockDoubleSignProofEthersType],
    [Type.InvalidTimestampProof, InvalidTimestampProofEthersType],
    [Type.WrongGenesisProof, WrongGenesisProofEthersType],
    [Type.DisputeFraudProof, DisputeFraudProofEthersType],
    [FraudProofType.BlockDoubleSign, BlockDoubleSignProofEthersType],
    [
        FraudProofType.BlockInvalidStateTransition,
        BlockInvalidStateTransitionProofEthersType
    ],
    [FraudProofType.InvalidTimestamp, InvalidTimestampProofEthersType],
    [FraudProofType.WrongGenesis, WrongGenesisProofEthersType]
]);

export function getEthersType(type: Type | FraudProofType): string {
    const ethersType = TYPE_TO_ETHERS_TYPE_MAP.get(type);
    if (!ethersType) {
        throw new Error(`No ethers type mapping found for ${type}`);
    }
    return ethersType;
}
