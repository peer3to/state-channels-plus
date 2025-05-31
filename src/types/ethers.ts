export enum ProofType {
    // Block related fraud proofs
    BlockDoubleSign = 0,
    BlockEmptyBlock = 1,
    BlockInvalidStateTransition = 2,
    BlockOutOfGas = 3,
    BlockInvalidPreviousLink = 4,
    // Timeout related fraud proofs
    TimeoutThreshold = 5,
    TimeoutPriorInvalid = 6,
    TimeoutParticipantNoNext = 7,
    // Dispute fraud proofs
    DisputeNotLatestState = 8,
    DisputeInvalid = 9,
    DisputeInvalidRecursive = 10,
    DisputeOutOfGas = 11,
    DisputeInvalidOutputState = 12,
    DisputeInvalidStateProof = 13,
    DisputeInvalidPreviousRecursive = 14,
    DisputeInvalidExitChannelBlocks = 15
}

export const BalanceEthersType = `tuple(
  uint256 amount,
  bytes data
)`;

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
${BalanceEthersType} totalDeposits,
${BalanceEthersType} totalWithdrawals
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
  bytes32 previousBlockHash
)`;

export const JoinChannelEthersType = `tuple(
bytes32 channelId,
address participant,
uint deadlineTimestamp,
${BalanceEthersType} balance
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
