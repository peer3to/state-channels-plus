import { ReduceOutputStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import {
    BlockConfirmationEthersType,
    SignedBlockEthersType,
    SnapshotDataEthersType,
    TimeoutEthersType,
    StateSnapshotEthersType,
    DisputeAuditingDataEthersType,
    MessageBlockEthersType
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
    bool postedAuditingData,
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

// ---- Spectate sync payload types ----
// These are ABI tuple definitions used for encoding/decoding spectate sync payloads
// over RPC without relying on JSON serialization (which breaks on bigint).

export const DisputeWindowVerificationEthersType = `tuple(
    ${DisputeConfirmationEthersType}[] disputeConfirmations,
    bytes32 forkId,
    ${StateSnapshotEthersType} latestStateSnapshot,
    bytes latestEncodedStateMachineState,
    ${MessageBlockEthersType}[] inboundMessageBlocksAppliedInReduce,
    bytes32 reducedForkId
)`;

export const SyncPayloadEthersType = `tuple(
    ${DisputeWindowVerificationEthersType}[] disputeWindows,
    ${StateSnapshotEthersType} latestForkGenesisSnapshot,
    bytes latestForkGenesisEncodedState,
    ${StateProofEthersType} stateProof,
    ${StateSnapshotEthersType}[] milestoneSnapshots,
    bytes latestFinalizedEncodedState,
    ${MessageBlockEthersType}[] outboundMessageBlocksUpToLatestGenesis,
    ${MessageBlockEthersType}[] outboundMessageBlocksOfTheLatestFork
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
            ${StateSnapshotEthersType} previousStateSnapshot,
            bytes participantSignatureOnPreviousBlock,
            uint256 previousBlockOnChainTimestamp
            )`;

export const WrongGenesisProofEthersType = `tuple(
    ${SignedBlockEthersType} invalidBlock,
    ${StateSnapshotEthersType} genesisSnapshot
    )`;

export const ForgedInboundMessageBlockProofEthersType = `tuple(
    ${SignedBlockEthersType} invalidBlock,
    ${MessageBlockEthersType} forgedInboundMessageBlock
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
    ${StateSnapshotEthersType} latestStateSnapshot,
    bytes latestStateMachineState,
    ${MessageBlockEthersType}[] inboundMessageBlocks
)`;

export const DisputeInvalidStateProofProofEthersType = `tuple(
    ${DisputeAuditingDataEthersType} auditingData
)`;

export const DisputeInvalidBalanceInvariantProofEthersType = `tuple(
    ${StateSnapshotEthersType} latestStateSnapshot,
    bytes latestStateMachineState
)`;

export const DisputeOnChainSlashesNotSubsetProofEthersType = `tuple(
    bool __
)`;

export const TimeoutThresholdProofEthersType = `tuple(
    ${BlockConfirmationEthersType} thresholdBlock,
    ${StateSnapshotEthersType} latestStateSnapshot,
    ${StateSnapshotEthersType} thresholdStateSnapshot
)`;

export const TimeoutCalldataPostedProofEthersType = `tuple(
    ${SnapshotDataEthersType} genesisStateSnapshotData,
    ${StateSnapshotEthersType} latestStateSnapshot,
    bytes latestStateStateMachineState,
    ${SignedBlockEthersType} postedBlock,
    uint256 onChainTimestamp,
    uint256 previousBlockOnChainTimestamp,
    ${SignedBlockEthersType} previousBlockcalldata
)`;

export const TimeoutNotLinkedToLatestStateProofEthersType = `tuple(
    bool __
)`;

export const DisputeLastMilestoneNotFinalAndNoAuditingDataProofEthersType = `tuple(
    bool __
)`;

export const DisputeStateProofHeaderMismatchProofEthersType = `tuple(
    bool __
)`;

export const DisputeInboundHashNotInChainProofEthersType = `tuple(
    bool __
)`;

export const InvalidDisputeReasonProofEthersType = `tuple(
    ${StateSnapshotEthersType} latestStateSnapshot
)`;

export const TimeoutParticipantNotNextProofEthersType = `tuple(
    ${StateSnapshotEthersType} latestStateSnapshot,
    bytes latestStateStateMachineState
)`;

export const TimeoutTooEarlyProofEthersType = `tuple(
    ${SnapshotDataEthersType} genesisStateSnapshotData,
    uint256 previousBlockOnChainTimestamp
)`;

export const DisputeInvalidBlockInStateProofApplyFraudProofEthersType = `tuple(
    ${FraudProofEthersType} fraudProof,
    uint256 blockIndexInUnfinalizedPartOfStateProof
)`;
