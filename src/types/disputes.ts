import {
    DisputeEthersType,
    SignedBlockEthersType,
    StateSnapshotEthersType
} from "./ethers";

export const BlockEmptyProofEthersType = `tuple(
    ${SignedBlockEthersType} emptyBlock,
    ${SignedBlockEthersType} previousBlock,
)`;

export const BlockInvalidStateTransitionProofEthersType = `tuple(
    ${SignedBlockEthersType} invalidBlock,
    ${SignedBlockEthersType} previousBlock,
    ${StateSnapshotEthersType} previousBlockStateSnapshot,
    bytes previousStateStateMachineState
)`;

export const BlockDoubleSignProofEthersType = `tuple(
    ${SignedBlockEthersType} block1,
    ${SignedBlockEthersType} block2
)`;

export const BlockInvalidPreviousLinkProofEthersType = `tuple(
    ${SignedBlockEthersType} invalidBlock,
    ${SignedBlockEthersType} previousBlock,
    bytes previousStateMachineState
)`;

export const TimeoutPriorInvalidProofEthersType = `tuple(
    ${DisputeEthersType} originalDispute,
    ${DisputeEthersType} recursiveDispute,
    uint256 originalDisputeTimestamp,
    uint256 recursiveDisputeTimestamp
)`;

export const TimeoutThresholdProofEthersType = `tuple(
    ${DisputeEthersType} originalDispute,
    ${DisputeEthersType} recursiveDispute,
    uint256 originalDisputeTimestamp,
    uint256 recursiveDisputeTimestamp
)`;

export const DisputeInvalidPreviousRecursiveProofEthersType = `tuple(
    ${DisputeEthersType} invalidRecursiveDispute,
    ${DisputeEthersType} originalDispute,
    uint256 originalDisputeTimestamp,
    uint256 invalidRecursiveDisputeTimestamp,
    bytes invalidRecursiveDisputeOutputState
)`;

export enum ProofType {
    BlockEmpty,
    BlockDoubleSign,
    BlockInvalidStateTransition,
    BlockInvalidPreviousLink,
    TimeoutThreshold,
    TimeoutPriorInvalid,
    DisputeInvalidPreviousRecursive
}

const DISPUTE_PROOF_ETHERS_TYPES: Record<ProofType, string> = {
    [ProofType.BlockEmpty]: BlockEmptyProofEthersType,
    [ProofType.BlockDoubleSign]: BlockDoubleSignProofEthersType,
    [ProofType.BlockInvalidStateTransition]:
        BlockInvalidStateTransitionProofEthersType,
    [ProofType.BlockInvalidPreviousLink]:
        BlockInvalidPreviousLinkProofEthersType,
    [ProofType.TimeoutThreshold]: TimeoutThresholdProofEthersType,
    [ProofType.TimeoutPriorInvalid]: TimeoutPriorInvalidProofEthersType,
    [ProofType.DisputeInvalidPreviousRecursive]:
        DisputeInvalidPreviousRecursiveProofEthersType
};

export const getEthersTypeForDisputeProof = (proofType: ProofType): string => {
    return DISPUTE_PROOF_ETHERS_TYPES[proofType];
};
