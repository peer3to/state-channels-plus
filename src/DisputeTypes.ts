import { SignedBlockEthersType } from "@/DataTypes";

export const FoldRechallengeProofEthersType = `tuple(
    string encodedBlock,
    bytes[] signatures
    )`;
export const DoubleSignEthersType = `tuple(
    ${SignedBlockEthersType} block1,
    ${SignedBlockEthersType} block2
    )`;
export const DoubleSignProofEthersType = `tuple(
    ${SignedBlockEthersType}[] doubleSigns
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

export const getEthersTypeForDisputeProof = (proofType: ProofType) => {
    switch (proofType) {
        case ProofType.FoldRechallenge:
            return FoldRechallengeProofEthersType;
        case ProofType.DoubleSign:
            return DoubleSignProofEthersType;
        case ProofType.IncorrectData:
            return IncorrectDataProofEthersType;
        case ProofType.NewerState:
            return NewerStateProofEthersType;
        case ProofType.FoldPriorBlock:
            return FoldPriorBlockProofEthersType;
        case ProofType.BlockTooFarInFuture:
            return BlockTooFarInFutureProofEthersType;
    }
};
