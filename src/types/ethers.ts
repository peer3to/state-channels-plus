export const TransactionEthersType = `tuple(
    tuple(
      bytes32 channelId,
      address participant,
      uint forkCnt,
      uint transactionCnt,
      uint timestamp
    ) header,
    tuple(
      uint8 transactionType,
      bytes encodedData,
      bytes data
    ) body
    )`;

export const BlockEthersType = `tuple(
        ${TransactionEthersType} transaction,
        bytes32 stateHash,
        bytes32 previousStateHash)`;

export const SignedBlockEthersType = `tuple(
            bytes encodedBlock,
            bytes signature)`;

export const JoinChannelEthersType = `tuple(
              bytes32 channelId,
              address participant,
              uint amount,
              uint deadlineTimestamp,
              bytes data)`;

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
