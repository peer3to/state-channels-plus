import { ReduceOutputStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import {
    BlockConfirmationEthersType,
    SignedBlockEthersType,
    TimeoutEthersType,
    StateSnapshotEthersType,
    DisputeAuditingDataEthersType
} from "./ethers";
import { Bytes, ForkId } from "./types";

import {
    MessageBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

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
    bytes32 latestInboundMessageBlockHash,
    uint256 lastInboundMessageBlockHeight,
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
    encodedStateMachineState: Bytes;
    inboundMessageBlocks: MessageBlockStruct[];
};

// DisputeFraudProofs etheres types

export const DisputeNotLatestStateProofEthersType = SignedBlockEthersType;

export const DisputeInvalidOutputStateProofEthersType = `tuple(
    ${DisputeAuditingDataEthersType} auditingData
)`;

export const DisputeInvalidStateProofWithoutAuditingDataIntegrityVerifiedProofEthersType = `tuple(
    ${DisputeAuditingDataEthersType} auditingData
)`;

export const DisputeInvalidStateProofWithAuditingDataIntegrityVerifiedProofEthersType = `tuple(
    ${DisputeAuditingDataEthersType} auditingData
)`;

export const DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocksProofEthersType = `tuple(
    ${DisputeAuditingDataEthersType} auditingData
)`;

export const DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifiedProofEthersType = `tuple(
    ${DisputeAuditingDataEthersType} auditingData
)`;

export const DisputeInvalidBalanceInvariantProofEthersType = `tuple(
    ${DisputeAuditingDataEthersType} auditingData
)`;

export const DisputeOnChainSlashesNotSubsetProofEthersType = `tuple(
    ${DisputeAuditingDataEthersType} auditingData
)`;

export const TimeoutThresholdProofEthersType = `tuple(
    ${BlockConfirmationEthersType} thresholdBlock,
    ${DisputeAuditingDataEthersType} auditingData
)`;

export const TimeoutCalldataPostedProofEthersType = `tuple(
    ${DisputeAuditingDataEthersType} auditingData,
    ${SignedBlockEthersType} postedBlock,
    uint256 onChainTimestamp,
    uint256 previousBlockOnChainTimestamp,
    ${SignedBlockEthersType} previousBlockcalldata
)`;

export const TimeoutNotLinkedToLatestStateProofEthersType = `tuple(
    bool __
)`;

export const TimeoutParticipantNotNextProofEthersType = `tuple(
    ${DisputeAuditingDataEthersType} auditingData
)`;

export const TimeoutTooEarlyProofEthersType = `tuple(
    ${DisputeAuditingDataEthersType} auditingData,
    uint256 previousBlockOnChainTimestamp
)`;

export const DisputeInvalidBlockInStateProofApplyFraudProofEthersType = `tuple(
    ${FraudProofEthersType} fraudProof,
    uint256 blockIndexInUnfinalizedPartOfStateProof
)`;
