import { SignedBlockEthersType } from "./DataTypes";

export const FoldRechallengeProofEthersType = `tuple(
    string encodedBlock,
    bytes[] signatures
    )`;

export enum ProofType {
    FoldRechallenge
}

export const getEthersTypeForDisputeProof = (proofType: ProofType) => {
    switch (proofType) {
        case ProofType.FoldRechallenge:
            return FoldRechallengeProofEthersType;
    }
};
