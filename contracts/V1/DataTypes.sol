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
        ExitChannel memory j,
        ExitChannelBlock memory k,
        Timeout memory l,
        StateSnapshot memory m,
        DisputeProof memory n,
        SignedDispute memory o
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

struct SignedDispute {
    bytes encodedDispute;
    bytes signature;
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
    bytes encodedData;
    bytes data; //evm transaction data
}

struct Balance {
    uint amount;
    bytes data; //custom data
}
struct JoinChannel {
    bytes32 channelId;
    address participant;
    uint deadlineTimestamp;
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
    /// @dev True if timeout checks should ignore race condition checks on-chain - usefull when the participant being tiemdout committed to a wrong block (is not linked to the latestState), but we can't prove deviation - explained more in the docs
    bool isForced;
    // ================== optional ==================
    address previousBlockProducer;
    bool previousBlockProducerPostedCalldata;
}

struct StateSnapshot {
    /// @dev the state root of the channel state
    bytes32 stateMachineStateHash;
    /// @dev the participants of the channel
    address[] participants;
    /// @dev The fork identifier (count) that the snapshot belongs to
    uint forkCnt;
    /// @dev the hash of the lastBlock in the JoinChannel blockchain
    bytes32 latestJoinChannelBlockHash;
    /// @dev the hash of the lastBlock in the ExitChannel blockchain
    bytes32 latestExitChannelBlockHash;
    /// @dev sum of all the amounts in the joinChannel blockchain
    Balance totalDeposits;
    /// @dev sum of all the amounts in the exitChannel blockchain
    Balance totalWithdrawals;
}

struct DisputeProof {
    Dispute dispute;
    StateSnapshot outputStateSnapshot;
    uint timestamp;
    bytes[] signatures;
}
