import {
    BlockConfirmationEthersType,
    ExitChannelBlockEthersType,
    SignedBlockEthersType,
    TimeoutEthersType
} from "./ethers";

export enum FraudProofType {
    // Block related fraud proofs
    BlockDoubleSign = 0,
    BlockEmptyBlock = 1,
    BlockInvalidStateTransition = 2,
    BlockOutOfGas = 3,
    BlockInvalidPreviousLink = 4,
    // Timeout related fraud proofs
    TimeoutThreshold = 5,
    TimeoutPriorInvalid = 6,
    TimeoutParticipantNotNext = 7,
    // Dispute fraud proofs
    DisputeNotLatestState = 8,
    DisputeInvalid = 9,
    DisputeInvalidRecursive = 10,
    DisputeOutOfGas = 11,
    DisputeInvalidOutputState = 12,
    DisputeInvalidStateProof = 13,
    DisputeInvalidPreviousRecursive = 14,
    DisputeInvalidExitChannelBlocks = 15
}

export const MilestoneProofEthersType = `tuple(
    ${BlockConfirmationEthersType}[] blockConfirmations
)`;

export const StateProofEthersType = `tuple(
    ${MilestoneProofEthersType}[] milestones,
    ${SignedBlockEthersType}[] signedBlocks
)`;

export const ProofEthersType = `tuple(
    uint8 proofType,
    address participant,
    bytes encodedProof
)`;

export const DisputeEthersType = `tuple(
    bytes32 channelId,
    bytes32 genesisSnapshotDataHash,
    bytes32 latestStateSnapshotHash,
    ${StateProofEthersType} stateProof,
    ${ProofEthersType}[] fraudProofs,
    address[] onChainSlashes,
    bytes32 onChainLatestJoinChannelBlockHash,
    bytes32 outputSnapshotDataHash,
    ${ExitChannelBlockEthersType}[] exitChannelBlocks,
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

export const FoldRechallengeProofEthersType = `tuple(
    string encodedBlock,
    bytes[] signatures
)`;

export const DoubleSignProofEthersType = `tuple(
        tuple(${SignedBlockEthersType} block1, ${SignedBlockEthersType} block2)[] doubleSigns
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
export const FoldPriorBlockProofEthersType = `tuple(
    uint moveCnt
    )`;
export const BlockTooFarInFutureProofEthersType = `tuple(
    ${SignedBlockEthersType} block1
    )`;

export enum FraudProofType {
    FoldRechallenge,
    DoubleSign,
    IncorrectData,
    NewerState,
    FoldPriorBlock,
    BlockTooFarInFuture
}

const DISPUTE_PROOF_ETHERS_TYPES: Record<FraudProofType, string> = {
    [FraudProofType.FoldRechallenge]: FoldRechallengeProofEthersType,
    [FraudProofType.DoubleSign]: DoubleSignProofEthersType,
    [FraudProofType.IncorrectData]: IncorrectDataProofEthersType,
    [FraudProofType.NewerState]: NewerStateProofEthersType,
    [FraudProofType.FoldPriorBlock]: FoldPriorBlockProofEthersType,
    [FraudProofType.BlockTooFarInFuture]: BlockTooFarInFutureProofEthersType
};

export const getEthersTypeForDisputeProof = (
    proofType: FraudProofType
): string => {
    return DISPUTE_PROOF_ETHERS_TYPES[proofType];
};
