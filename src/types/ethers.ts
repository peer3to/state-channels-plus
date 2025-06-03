import { DisputeEthersType } from "./disputes";

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
