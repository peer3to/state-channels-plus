import { ReduceOutputStruct } from "@typechain-types/contracts/V1/StateChannelManagerInterface";
import {
    BlockConfirmationEthersType,
    SignedBlockEthersType,
    TimeoutEthersType,
    StateSnapshotEthersType
} from "./ethers";
import { ForkId } from "./types";
import {
    JoinChannelBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/StateChannelManagerEvents";
import { BytesLike } from "ethers";

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

export const DisputeInputEthersType = `tuple(
    bytes32 channelId,
    bytes32 forkId,
    bytes32 latestStateSnapshotHash,
    ${StateProofEthersType} stateProof,
    address[] onChainSlashes,
    bytes32 disputeAuditingDataHash,
    address disputer,
    ${TimeoutEthersType} timeout,
    bool selfRemoval
)`;

export const DisputeEthersType = `tuple(
    ${DisputeInputEthersType} input,
    bytes32 outputSnapshotDataHash
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

export const WrongGenesisProofEthersType = `tuple(
    ${SignedBlockEthersType} invalidBlock,
    ${StateSnapshotEthersType} genesisSnapshot
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

export type ReduceData = {
    forkId: ForkId;
    reducedOutput: ReduceOutputStruct;
    latestStateSnapshot: StateSnapshotStruct;
    encodedStateMachineState: BytesLike;
    joinChannelBlocks: JoinChannelBlockStruct[];
};
