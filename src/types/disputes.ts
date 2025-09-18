import { BlockDoubleSignProofEthersType } from "./generated-ethers";

export enum FraudProofType {
    // Block related fraud proofs
    BlockDoubleSign = 100,
    BlockInvalidStateTransition,
    WrongGenesis,
    // Timeout related fraud proofs
    InvalidTimestamp
}

export enum DisputeFraudProofType {
    DoubleSign
    // IncorrectData,
    // NewerState,
    // BlockTooFarInFuture
}

const DISPUTE_PROOF_ETHERS_TYPES: Record<DisputeFraudProofType, string> = {
    [DisputeFraudProofType.DoubleSign]: BlockDoubleSignProofEthersType
    // [DisputeFraudProofType.IncorrectData]: IncorrectDataProofEthersType,
    // [DisputeFraudProofType.NewerState]: NewerStateProofEthersType,
    // [DisputeFraudProofType.BlockTooFarInFuture]:
    //     BlockTooFarInFutureProofEthersType
};

export const getEthersTypeForDisputeProof = (
    proofType: DisputeFraudProofType
): string => {
    return DISPUTE_PROOF_ETHERS_TYPES[proofType];
};
