pragma solidity ^0.8.8;

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
        ExitChannel memory j,
        ExitChannelBlock memory k,
        Timeout memory l
       
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
    uint forkCnt;
    uint transactionCnt;
    uint timestamp;
}

// do this polymorphically later with encoded functions and argument data
struct TransactionBody {
    bytes encodedData; //TODO! change this to bytes
    bytes data; //evm transaction data
}
struct JoinChannel {
    bytes32 channelId;
    address participant;
    uint amount;
    uint deadlineTimestamp;
    bytes data; //custom data
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
    uint amount;
    bytes data;
    bool isPartialExit;
}

struct ExitChannelBlock {
    /// @dev no signature requirement for the exitChannel blocks
    ExitChannel[] exitChannels;
    /// @dev Hash of the previous exitChannelBlock
    bytes32 previousBlockHash;
}

struct Timeout {
    /// @dev the participant that is being timed out
    address participant;
    /// @dev the block height at which participant is removed from the channel (fork)
    uint blockHeight;
    /// @dev minimum timestamp where this timeout is valid
    uint minTimeStamp;
    /// @dev the forkCnt at which the participant is timed out
    uint forkCnt;
    // ================== optional ==================
    address previousBlockProducer;
    bool previousBlockProducerPostedCalldata;
}

struct StateSnapshot {
    /// @dev the state root of the channel state
    bytes32 stateMachineStateHash;
    /// @dev the participants of the channel
    address[] participants;
    /// @dev the hash of the lastBlock in the JoinChannel blockchain
    bytes32 latestJoinChannelBlockHash;
    /// @dev the hash of the lastBlock in the ExitChannel blockchain
    bytes32 latestExitChannelBlockHash;
    /// @dev sum of all the amounts in the joinChannel blockchain
    uint totalDeposits;
    /// @dev sum of all the amounts in the exitChannel blockchain
    uint totalWithdrawals;
    uint forkCnt;
}