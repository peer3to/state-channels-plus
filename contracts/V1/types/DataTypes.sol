pragma solidity ^0.8.8;

import "./DisputeTypes.sol";

//Just so typechain generates types for the structs bellow
contract DataTypes {
    constructor(
        Block memory a,
        SignedBlock memory b,
        BlockConfirmation memory c,
        TransactionHeader memory d,
        TransactionBody memory e,
        Transaction memory f,
        Balance memory g,
        JoinChannel memory h,
        JoinChannelBlock memory i,
        SignedJoinChannel memory j,
        JoinChannelConfirmation memory k,
        ExitChannel memory l,
        ExitChannelBlock memory m,
        StateSnapshot memory n,
        SnapshotData memory o,
        OpenChannel memory p,
        OpenChannelConfirmation memory q,
        Message memory r,
        MessageBlock memory s
    ) {}
}

struct Block {
    Transaction transaction;
    bytes32 stateSnapshotHash;
    bytes32 previousBlockHash;
    MessageBlock[] messageBlocks;
}

struct SignedBlock {
    bytes encodedBlock;
    bytes signature;
}

struct BlockConfirmation {
    SignedBlock signedBlock;
    bytes[] signatures;
}

struct TransactionHeader {
    bytes32 channelId;
    address participant;
    bytes32 forkId;
    uint256 transactionCnt;
    uint256 timestamp;
}

// do this polymorphically later with encoded functions and argument data
struct TransactionBody {
    bytes encodedData;
    bytes data; //evm transaction data
}

struct Transaction {
    TransactionHeader header;
    TransactionBody body;
}

struct Balance {
    uint256 amount;
    bytes data; //custom data
}

struct OpenChannel {
    bytes32 channelId; // could be computed on-chain, but if known in advance, easy to index
    address[] participants;
    Balance[] balances; // parallel array to participants
    uint256 deadlineTimestamp;
    bool isAtomic; // (all or nothing) or allow deposits to fail and only open with successful deposits
    bytes data; // custom data
}

struct OpenChannelConfirmation {
    bytes encodedOpenChannel;
    bytes[] signatures;
}

struct Message {
    bytes32 messageType;
    address participant;
    Balance balance;
    bytes data;
}

struct MessageBlock {
    bytes32 previousBlockHash;
    uint256 blockHeight; // only relevant for reduce() for inbound blocks
    Message[] messages;
    Balance totalBalance;
    uint256 timestamp;
}

struct JoinChannel {
    bytes32 channelId;
    address participant;
    uint256 deadlineTimestamp;
    Balance balance;
}

struct JoinChannelBlock {
    bytes32 previousBlockHash;
    JoinChannel[] joinChannels;
}

struct SignedJoinChannel {
    bytes encodedJoinChannel;
    bytes signature;
}

struct JoinChannelConfirmation {
    SignedJoinChannel signedJoinChannel;
    bytes[] signatures;
}

/// @dev It is produced as a byproduct of state transition or enforced onchain through dispute
struct ExitChannel {
    address participant;
    Balance balance;
}

struct ExitChannelBlock {
    ExitChannel[] exitChannels;
    bytes32 previousBlockHash;
}

struct StateSnapshot {
    SnapshotData snapshotData;
    /// @dev The fork identifier (count) that the snapshot belongs to
    bytes32 forkId; //hash(genesisSnapshotData)
    /// @dev The block height that committed to this snapshot
    uint256 blockHeight;
    uint256 timestamp;
}

struct SnapshotData {
    /// @dev The forkId of the previous(originating) fork
    bytes32 originForkId;
    /// @dev the state root of the channel state
    bytes32 stateMachineStateHash;
    /// @dev the participants of the channel
    address[] participants;
    /// @dev the head of the inbound (L1 -> L2) message blockchain
    bytes32 latestInboundMessageBlockHash;
    /// @dev height of the latest inbound message block
    uint256 latestInboundMessageBlockHeight;
    /// @dev the head of the outbound (L2 -> L1) message blockchain
    bytes32 latestOutboundMessageBlockHash;
    /// @dev height of the latest outbound message block
    uint256 latestOutboundMessageBlockHeight;
    /// @dev sum of all inbound message balances processed on-chain
    Balance totalDeposits;
    /// @dev sum of all outbound message balances processed on-chain
    Balance totalWithdrawals;
}

struct ChannelBalance {
    bytes32 latestInboundMessageBlockHash;
    uint256 latestInboundMessageBlockHeight;
    uint256 latestOutboundMessageBlockHeight;
    Balance totalDeposits;
    Balance totalWithdrawals;
}
