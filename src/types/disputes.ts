import {
    BlockConfirmationEthersType,
    ExitChannelBlockEthersType,
    SignedBlockEthersType,
    TimeoutEthersType
} from "./ethers";

export const ForkMilestoneProofEthersType = `tuple(
    ${BlockConfirmationEthersType}[] blockConfirmations
)`;

export const ForkProofEthersType = `tuple(
    ${ForkMilestoneProofEthersType}[] forkMilestoneProofs
)`;

export const StateProofEthersType = `tuple(
    ${ForkProofEthersType} forkProof,
    ${SignedBlockEthersType}[] signedBlocks
)`;

export const ProofEthersType = `tuple(
    uint8 proofType,
    bytes encodedProof
)`;

export const DisputeEthersType = `tuple(
    bytes32 channelId,
    bytes32 genesisStateSnapshotHash,
    bytes32 latestStateSnapshotHash,
    ${StateProofEthersType} stateProof,
    ${ProofEthersType}[] fraudProofs,
    address[] onChainSlashes,
    bytes32 onChainLatestJoinChannelBlockHash,
    bytes32 outputStateSnapshotHash,
    ${ExitChannelBlockEthersType}[] exitChannelBlocks,
    bytes32 disputeAuditingDataHash,
    address disputer,
    uint256 disputeIndex,
    uint256 previousRecursiveDisputeIndex,
    ${TimeoutEthersType} timeout,
    bool selfRemoval
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

export enum ProofType {
    FoldRechallenge,
    DoubleSign,
    IncorrectData,
    NewerState,
    FoldPriorBlock,
    BlockTooFarInFuture
}

const DISPUTE_PROOF_ETHERS_TYPES: Record<ProofType, string> = {
    [ProofType.FoldRechallenge]: FoldRechallengeProofEthersType,
    [ProofType.DoubleSign]: DoubleSignProofEthersType,
    [ProofType.IncorrectData]: IncorrectDataProofEthersType,
    [ProofType.NewerState]: NewerStateProofEthersType,
    [ProofType.FoldPriorBlock]: FoldPriorBlockProofEthersType,
    [ProofType.BlockTooFarInFuture]: BlockTooFarInFutureProofEthersType
};

export const getEthersTypeForDisputeProof = (proofType: ProofType): string => {
    return DISPUTE_PROOF_ETHERS_TYPES[proofType];
};
