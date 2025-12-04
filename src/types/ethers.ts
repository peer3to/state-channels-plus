export const BalanceEthersType = `tuple(
  uint256 amount,
  bytes data
)`;

export const TransactionEthersType = `tuple(
tuple(
  bytes32 channelId,
  address participant,
  bytes32 forkId,
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

export const BlockCommitmentEthersType = `tuple(
${SignedBlockEthersType} signedBlock,
uint timestamp
)`;

export const SnapshotDataEthersType = `tuple(
bytes32 originForkId,
bytes32 stateMachineStateHash,
address[] participants,
bytes32 latestInboundMessageBlockHash,
uint256 latestInboundMessageBlockHeight,
bytes32 latestOutboundMessageBlockHash,
uint256 latestOutboundMessageBlockHeight,
${BalanceEthersType} totalDeposits,
${BalanceEthersType} totalWithdrawals
)`;

export const StateSnapshotEthersType = `tuple(
${SnapshotDataEthersType} snapshotData,
bytes32 forkId,
uint blockHeight,
uint timestamp
)`;

export const BlockConfirmationEthersType = `tuple(
${SignedBlockEthersType} signedBlock,
bytes[] signatures
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

export const OpenChannelEthersType = `tuple(
bytes32 channelId,
address[] participants,
${BalanceEthersType}[] balances,
uint deadlineTimestamp,
bool isAtomic,
bytes data
)`;

export const JoinChannelBlockEthersType = `tuple(
bytes32 previousBlockHash,
${JoinChannelEthersType}[] joinChannels
)`;

export const ExitChannelEthersType = `tuple(
address participant,
${BalanceEthersType} balance,
)`;

export const ExitChannelBlockEthersType = `tuple(
bytes32 previousBlockHash,
${ExitChannelEthersType}[] exitChannels
)`;

export const MessageEthersType = `tuple(
bytes32 messageType,
address participant,
${BalanceEthersType} balance,
bytes data
)`;

export const MessageBlockEthersType = `tuple(
bytes32 previousBlockHash,
uint256 blockHeight,
${MessageEthersType}[] messages,
${BalanceEthersType} totalBalance,
uint256 timestamp
)`;

export const TimeoutEthersType = `tuple(
address participant,
uint256 blockHeight,
uint256 minTimeStamp,
bool isForced,
address previousBlockProducer,
bool previousBlockProducerPostedCalldata,
bytes participantSignatureOnPreviousBlock
)`;

export const DisputeAuditingDataEthersType = `tuple(
${SnapshotDataEthersType} genesisStateSnapshotData,
${StateSnapshotEthersType} latestStateSnapshot,
${StateSnapshotEthersType}[] milestoneSnapshots,
bytes latestStateStateMachineState,
${MessageBlockEthersType}[] inboundMessageBlocks,
${MessageBlockEthersType}[] outboundMessageBlocks
)`;
