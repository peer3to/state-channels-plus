import { SignedBlockEthersType } from "./ethers";

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
