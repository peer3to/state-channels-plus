pragma solidity ^0.8.8;

import "./DisputeTypes.sol";

//Just so typechain generates types for the structs bellow
contract DataTypes {
    constructor(
        Block memory a,
        SignedBlock memory b,
        BlockConfirmation memory c,
        Transaction memory d,
        JoinChannel memory g,
        JoinChannelBlock memory h,
        SignedJoinChannel memory i,
        JoinChannelConfirmation memory j,
        ExitChannel memory k,
        ExitChannelBlock memory l,
        Timeout memory m,
        StateSnapshot memory n
    ) {}
}

struct SignedBlock {
    bytes encodedBlock;
    bytes signature;
}

struct BlockConfirmation {
    SignedBlock signedBlock;
    bytes[] signatures;
}

struct Block {
    Transaction transaction;
    bytes32 stateSnapshotHash;
    bytes32 previousBlockHash;
}

struct Transaction {
    TransactionHeader header;
    TransactionBody body;
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

struct Balance {
    uint256 amount;
    bytes data; //custom data
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
    /// @dev no signature requirement for the exitChannel blocks
    ExitChannel[] exitChannels;
    /// @dev Hash of the previous exitChannelBlock
    bytes32 previousBlockHash;
}

struct StateSnapshot {
    SnapshotData snapshotData;
    /// @dev The fork identifier (count) that the snapshot belongs to
    bytes32 forkId; //hash(genesisSnapshotData)
    uint256 timestamp;
}

struct SnapshotData {
    /// @dev the state root of the channel state
    bytes32 stateMachineStateHash;
    /// @dev the participants of the channel
    address[] participants;
    /// @dev the hash of the lastBlock in the JoinChannel blockchain
    bytes32 latestJoinChannelBlockHash;
    /// @dev the hash of the lastBlock in the ExitChannel blockchain
    bytes32 latestExitChannelBlockHash;
    /// @dev sum of all the amounts in the joinChannel blockchain
    Balance totalDeposits;
    /// @dev sum of all the amounts in the exitChannel blockchain
    Balance totalWithdrawals;
}

struct OnChainJoinChannel {
    bytes32 prebiousJoinChannelBlockHash;
    Balance totalDeposits;
    uint256 timestamp;
}

struct ChannelBalance {
    mapping(bytes32 joinChannelBlockHash => OnChainJoinChannel) onChainJoinChannelMap;
    bytes32 latestJoinChannelBlockHash;
    Balance totalOnChainWithdrawals;
}
