import { SignedBlockEthersType } from "./ethers";

export const BlockEmptyProofEthersType = `tuple(
    
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
    BlockEmpty,
    BlockDoubleSign,
    BlockInvalidStateTransition,
    BlockOutOfGas,
    TimeoutThreshold,
    TimeoutPriorInvalid
}

const DISPUTE_PROOF_ETHERS_TYPES: Record<ProofType, string> = {
    [ProofType.BlockEmpty]: BlockEmptyProofEthersType,
    [ProofType.BlockDoubleSign]: BlockDoubleSignProofEthersType,
    [ProofType.BlockInvalidStateTransition]:
        BlockInvalidStateTransitionProofEthersType,
    [ProofType.BlockOutOfGas]: BlockOutOfGasProofEthersType,
    [ProofType.TimeoutThreshold]: TimeoutThresholdProofEthersType,
    [ProofType.TimeoutPriorInvalid]: TimeoutPriorInvalidProofEthersType
};

export const getEthersTypeForDisputeProof = (proofType: ProofType): string => {
    return DISPUTE_PROOF_ETHERS_TYPES[proofType];
};
