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
import { ReduceOutputStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { MilestoneProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

export const MilestoneProofEthersType = `tuple(
    ${BlockConfirmationEthersType}[] blockConfirmations
)`;

export const StateProofEthersType = `tuple(
    ${MilestoneProofEthersType}[] milestones
)`;

export const StoredProofHopEthersType = `tuple(
    ${MilestoneProofEthersType} milestone,
    ${StateSnapshotEthersType} snapshot
)`;

export const StoredProofEthersType = `tuple(
    ${StateSnapshotEthersType} anchorSnapshot,
    ${StoredProofHopEthersType}[] hops,
    ${StateSnapshotEthersType} finalizedSnapshot,
    bytes encodedFinalizedState
)`;

export const ProofEvidenceEthersType = `tuple(
    bytes32 forkId,
    ${StoredProofEthersType} proof,
    ${StateSnapshotEthersType} latestSnapshot,
    bytes encodedLatestState
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
    bool selfRemoval,
    bool requireExistingDisputeWindow
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
    ${MessageBlockEthersType}[] outboundMessageBlocksOfTheLatestFork,
    uint256 chainBlock
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

/** One hop of a stored proof: its milestone run and the snapshot the run's first block commits to. */
export type StoredProofHop = {
    milestone: MilestoneProofStruct;
    snapshot: StateSnapshotStruct;
};

/**
 * The state proof a node keeps for its active fork: the anchor it starts
 * from, its hops in order, and the final point they prove with the full
 * state there. The tail above the final point is not part of it.
 */
export type StoredProof = {
    /** the same-fork chain anchor, else the fork genesis */
    anchorSnapshot: StateSnapshotStruct;
    hops: StoredProofHop[];
    /** the anchor, or the snapshot of the last proven hop */
    finalizedSnapshot: StateSnapshotStruct;
    /** the state machine state at `finalizedSnapshot` */
    encodedFinalizedState: Bytes;
};

/**
 * A proof kept as evidence (audit or sync), outside the stored proof: the
 * proven run and the latest point seen on `forkId` with its state there.
 */
export type ProofEvidence = {
    forkId: ForkId;
    proof: StoredProof;
    latestSnapshot: StateSnapshotStruct;
    /** the state machine state at `latestSnapshot`; `0x` when not held */
    encodedLatestState: Bytes;
};

// DisputeFraudProofs etheres types

export const DisputeNotLatestStateProofEthersType = SignedBlockEthersType;

export const DisputeInvalidOutputStateProofEthersType = `tuple(
    ${StateSnapshotEthersType} latestStateSnapshot,
    bytes latestStateMachineState,
    ${MessageBlockEthersType}[] inboundMessageBlocks
)`;

export const DisputeInvalidStateProofProofEthersType = `tuple(
    uint256 milestoneIndex,
    bool hasBlockIndex,
    uint256 blockIndex,
    ${DisputeAuditingDataEthersType} auditingData,
    ${StateSnapshotEthersType} previousStateSnapshot,
    ${StateSnapshotEthersType} resultingStateSnapshot
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

export const DisputeInboundAnchorBehindLatestStateProofEthersType = `tuple(
    ${StateSnapshotEthersType} latestStateSnapshot
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
    uint256 blockIndex
)`;

export const DisputeBlockAuthorNotParticipantProofEthersType = `tuple(
    uint256 blockIndex,
    ${SignedBlockEthersType} previousBlock,
    ${StateSnapshotEthersType} previousStateSnapshot,
    ${StateSnapshotEthersType} resultingStateSnapshot
)`;

export const DisputeInvalidBlockStructureProofEthersType = `tuple(
    uint256 blockIndex
)`;

export const DisputeStateProofBelowOnChainAnchorProofEthersType = `tuple(
    bool __
)`;

export const ProofWalkInputEthersType = `tuple(
    bytes32 channelId,
    bytes32 forkId,
    ${StateProofEthersType} stateProof,
    ${SnapshotDataEthersType} genesisStateSnapshotData,
    ${StateSnapshotEthersType}[] milestoneSnapshots
)`;

export const TimeoutSupersededByFinalStateProofEthersType = `tuple(
    ${ProofWalkInputEthersType} finalProof
)`;

export const DisputeConflictsWithFinalStateProofEthersType = `tuple(
    ${ProofWalkInputEthersType} finalProof,
    uint256 milestoneIndex,
    uint256 blockIndex,
    ${StateSnapshotEthersType} latestFinalizedSnapshot
)`;

export const DisputeFinalPointRegressionProofEthersType = `tuple(
    ${ProofWalkInputEthersType} finalProof,
    ${StateSnapshotEthersType} latestFinalizedSnapshot,
    bytes32 joinInboundBlockHash
)`;

export const DisputeInvalidOutboundRunProofEthersType = `tuple(
    ${DisputeAuditingDataEthersType} auditingData
)`;
