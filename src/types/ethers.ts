export enum ProofType {
    // Block related fraud proofs
    BlockDoubleSign = 0,
    BlockEmptyBlock = 1,
    BlockInvalidStateTransition = 2,
    BlockOutOfGas = 3,
    // Timeout related fraud proofs
    TimeoutThreshold = 4,
    TimeoutPriorInvalid = 5,
    TimeoutParticipantNoNext = 6,
    // Dispute fraud proofs
    DisputeNotLatestState = 7,
    DisputeInvalid = 8,
    DisputeInvalidRecursive = 9,
    DisputeOutOfGas = 10,
    DisputeInvalidOutputState = 11,
    DisputeInvalidStateProof = 12,
    DisputeInvalidPreviousRecursive = 13,
    DisputeInvalidExitChannelBlocks = 14
}

export const TransactionEthersType = `tuple(
    tuple(
      bytes32 channelId,
      address participant,
      uint forkCnt,
      uint transactionCnt,
      uint timestamp
    ) header,
    tuple(
      bytes encodedData,
      bytes data
    ) body
)`;

export const SignedBlockEthersType = `tuple(
  bytes encodedBlock,
  bytes signature
)`;

export const StateSnapshotEthersType = `tuple(
    bytes32 stateMachineStateHash,
    address[] participants,
    uint256 forkCnt,
    bytes32 latestJoinChannelBlockHash,
    bytes32 latestExitChannelBlockHash,
    tuple(uint256 amount, bytes data) totalDeposits, tuple(uint256 amount, bytesß data) totalWithdrawals
)`;

export const BlockConfirmationEthersType = `tuple(
    ${SignedBlockEthersType} signedBlock,
    bytes[] signatures
)`;

export const ForkMilestoneProofEthersType = `tuple(
    ${BlockConfirmationEthersType}[] blockConfirmations
)`;

export const ForkProofEthersType = `tuple(
    ${ForkMilestoneProofEthersType}[] forkMilestoneProofs
)`;

export const StateProofEthersType = `tuple(
    ${ForkProofEthersType} forkProof,
    ${SignedBlockEthersType}[] signedBlocks
)`;

export const ProofEthersType = `tuple(
    ${ProofType} proofType,
    bytes encodedProof
)`;

export const BlockEthersType = `tuple(
    ${TransactionEthersType} transaction,
    bytes32 stateSnapshotHash,
    bytes32 previousStateHash
)`;

export const JoinChannelEthersType = `tuple(
    bytes32 channelId,
    address participant,
    uint amount,
    uint deadlineTimestamp,
    bytes data
)`;

export const JoinChannelBlockEthersType = `tuple(
    bytes32 previousBlockHash,
    ${JoinChannelEthersType}[] joinChannels
)`;

export const ExitChannelEthersType = `tuple(
    address participant,
    bool isPartialExit,
    uint amount,
    bytes data
)`;

export const ExitChannelBlockEthersType = `tuple(
    bytes32 previousBlockHash,
    ${ExitChannelEthersType}[] exitChannels
)`;

export const TimeoutEthersType = `tuple(
    address participant,
    uint256 blockHeight,
    uint256 minTimeStamp,
    uint256 forkCnt,
    bool isForced,
    address previousBlockProducer,
    bool previousBlockProducerPostedCalldata
)`;

export const DisputeEthersType = `tuple(
    bytes32 channelId,
    bytes32 genesisStateSnapshotHash,
    bytes32 latestStateSnapshotHash,
    ${StateProofEthersType} stateProof,
    ${ProofEthersType}[] fraudProofs,
    address[] onChainSlashes,
    bytes32 onChainLatestJoinChannelBlockHash,
    bytes32 outputStateSnapshotHash,
    ${ExitChannelBlockEthersType}[] exitChannelBlocks,
    bytes32 disputeAuditingDataHash,
    address disputer,
    uint256 disputeIndex,
    uint256 previousRecursiveDisputeIndex,
    ${TimeoutEthersType} timeout,
    bool selfRemoval
)`;

export const DisputeAuditingDataEthersType = `tuple(
    ${StateSnapshotEthersType} genesisStateSnapshot,
    ${StateSnapshotEthersType} latestStateSnapshot,
    ${StateSnapshotEthersType} outputStateSnapshot,
    ${StateSnapshotEthersType}[] milestoneSnapshots,
    bytes latestStateStateMachineState,
    ${JoinChannelBlockEthersType}[] joinChannelBlocks,
    ${DisputeEthersType} previousDispute,
    uint previousDisputeTimestamp
)`;
