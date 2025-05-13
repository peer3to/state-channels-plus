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

export const DisputeAuditingDataEthersType = `tuple(
    StateSnapshot genesisStateSnapshot,
    StateSnapshot latestStateSnapshot,
    StateSnapshot outputStateSnapshot,
    StateSnapshot[] milestoneSnapshots,
    StateMachineState latestStateStateMachineState,
    JoinChannelBlock[] joinChannelBlocks,
    Dispute previousDispute,
    uint previousDisputeTimestamp
)`;

export const BlockEthersType = `tuple(
        ${TransactionEthersType} transaction,
        bytes32 stateSnapshotHash,
        bytes32 previousStateHash)`;

export const StateSnapshotEthersType = `tuple(
        bytes32 stateMachineStateHash,
        address[] participants,
        uint256 forkCnt,
        bytes32 latestJoinChannelBlockHash,
        bytes32 latestExitChannelBlockHash,
        tuple(uint256 amount, bytes data) totalDeposits, tuple(uint256 amount, bytesß data) totalWithdrawals)`;

export const SignedBlockEthersType = `tuple(
            bytes encodedBlock,
            bytes signature)`;

export const JoinChannelEthersType = `tuple(
              bytes32 channelId,
              address participant,
              uint amount,
              uint deadlineTimestamp,
              bytes data)`;

export const JoinChannelBlockEthersType = `tuple(
              bytes32 previousBlockHash,
              ${JoinChannelEthersType}[] joinChannels)`;

export const ExitChannelEthersType = `tuple(
              address participant,
              bool isPartialExit,
              uint amount,
              bytes data)`;

export const ExitChannelBlockEthersType = `tuple(
              bytes32 previousBlockHash,
              ${ExitChannelEthersType}[] exitChannels)`;

export const SignedJoinChannelEthersType = `tuple(
                bytes encodedJoinChannel,
                bytes signature)`;

export const JoinChannelAgreementEthersType = `tuple(
                  ${SignedJoinChannelEthersType} signedJoinChannel,
                  uint nextTransactionCnt,
                  bytes32 latestStateHash)`;

export const ConfirmedJoinChannelAgreementEthersType = `tuple(
                    bytes encodedJoinChannelAgreement,
                    bytes[] signatures)`;
