import {
    BlockConfirmationEthersType,
    ExitChannelBlockEthersType,
    SignedBlockEthersType,
    TimeoutEthersType,
    StateSnapshotEthersType
} from "./ethers";

export enum FraudProofType {
    // Block related fraud proofs
    BlockDoubleSign = 100,
    BlockInvalidStateTransition,
    // Timeout related fraud proofs
    InvalidTimestamp
}

export enum DisputeFraudProofType {
    DoubleSign,
    IncorrectData,
    NewerState,
    BlockTooFarInFuture
}

export const MilestoneProofEthersType = `tuple(
    ${BlockConfirmationEthersType}[] blockConfirmations
)`;

export const StateProofEthersType = `tuple(
    ${MilestoneProofEthersType}[] milestones,
    ${SignedBlockEthersType}[] signedBlocks
)`;

export const FraudProofEthersType = `tuple(
    uint8 proofType,
    address participant,
    bytes encodedProof
)`;

export const DisputeEthersType = `tuple(
    bytes32 channelId,
    bytes32 genesisSnapshotDataHash,
    bytes32 latestStateSnapshotHash,
    ${StateProofEthersType} stateProof,
    ${FraudProofEthersType}[] fraudProofs,
    address[] onChainSlashes,
    bytes32 onChainLatestJoinChannelBlockHash,
    bytes32 outputSnapshotDataHash,
    bytes32 disputeAuditingDataHash,
    address disputer,
    ${TimeoutEthersType} timeout,
    bool selfRemoval
)`;

export const SignedDisputeEthersType = `tuple(
    bytes encodedDispute,
    bytes signature
)`;

export const DisputeConfirmationEthersType = `tuple(
        ${SignedDisputeEthersType} signedDispute,
        bytes[] signatures
)`;

export const BlockDoubleSignProofEthersType = `tuple(
    ${SignedBlockEthersType} block1,
    ${SignedBlockEthersType} block2
    )`;

export const BlockInvalidStateTransitionProofEthersType = `tuple(
            ${SignedBlockEthersType} invalidBlock,
            ${SignedBlockEthersType} previousBlock,
            ${StateSnapshotEthersType} previousBlockStateSnapshot,
            bytes previousStateStateMachineState
            )`;

export const InvalidTimestampProofEthersType = `tuple(
            ${SignedBlockEthersType} invalidBlock,
            ${SignedBlockEthersType} previousBlock,
            ${StateSnapshotEthersType} previousStateSnapshot
            )`;

export const IncorrectDataProofEthersType = `tuple(
    ${SignedBlockEthersType} block1,
    ${SignedBlockEthersType} block2,
    string encodedState
    )`;

export const NewerStateProofEthersType = `tuple(
    string encodedBlock,
    string confirmationSignature
    )`;

export const BlockTooFarInFutureProofEthersType = `tuple(
    ${SignedBlockEthersType} block1
    )`;

const DISPUTE_PROOF_ETHERS_TYPES: Record<DisputeFraudProofType, string> = {
    [DisputeFraudProofType.DoubleSign]: BlockDoubleSignProofEthersType,
    [DisputeFraudProofType.IncorrectData]: IncorrectDataProofEthersType,
    [DisputeFraudProofType.NewerState]: NewerStateProofEthersType,
    [DisputeFraudProofType.BlockTooFarInFuture]:
        BlockTooFarInFutureProofEthersType
};

export const getEthersTypeForDisputeProof = (
    proofType: DisputeFraudProofType
): string => {
    return DISPUTE_PROOF_ETHERS_TYPES[proofType];
};
