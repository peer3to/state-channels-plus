pragma solidity ^0.8.8;

//Just so typechain generates types for the structs bellow
contract DataTypes {
    constructor(
        Transaction memory a,
        Block memory b,
        SignedBlock memory c,
        JoinChannel memory d,
        SignedJoinChannel memory e,
        JoinChannelAgreement memory f,
        ConfirmedJoinChannelAgreement memory g,
        LeaveChannel memory h,
        LeaveChannelAgreement memory i,
        ConfirmedBlock memory j
    ) {}
}
//TODO? - think should post state - everyone should be able to replicate the state since genesis (fork) and if a block is posted in the future and some are missing - someone will be folded before the posted BLOCK, as for posting too much in the future it can be challenged
struct BlockCalldata {
    SignedBlock signedBlock;
    uint timestamp;
}
//TODO! - need to rename and refactor this
struct ForkDataAvailability {
    mapping(uint => mapping(address => BlockCalldata)) map; //map[transactionCnt][participant] = BlockCalldata
    ForkDataAvailabilityKey[] keys;
}
struct ForkDataAvailabilityKey {
    uint transactionCnt;
    address participant;
}

struct SignedBlock {
    bytes encodedBlock; //TODO! change this to bytes
    bytes signature; //TODO! change this to bytes
}

struct ConfirmedBlock {
    bytes encodedBlock;
    bytes[] signatures; //TODO! change this to bytes
}

struct Block {
    Transaction transaction;
    bytes32 stateHash;
    bytes32 previousStateHash;
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
    TransactionType transactionType;
    bytes encodedData; //TODO! change this to bytes
    bytes data; //evm transaction data
}
enum TransactionType {
    JoinGame,
    KeyExchange,
    Shuffle,
    TimeLock,
    RevealTokens,
    Fold,
    Check,
    Bet,
    Call,
    AllIn
}

struct JoinChannel {
    bytes32 channelId;
    address participant;
    uint amount;
    uint deadlineTimestamp;
    bytes data; //custom data
}
struct SignedJoinChannel {
    bytes encodedJoinChannel;
    bytes signature;
}
struct JoinChannelAgreement {
    SignedJoinChannel signedJoinChannel;
    address submitter; //the state channel participant that submitted the agreement - responsible to initiate joinChannel
    uint forkCnt; //redundant, but usefull for indexing and challenge in dispute
    uint transactionCnt; //redundant, but usefull for indexing and challenge in dispute
    bytes32 previousStateHash;
}

struct ConfirmedJoinChannelAgreement {
    bytes encodedJoinChannelAgreement;
    bytes[] signatures;
}

struct LeaveChannel {
    bytes32 channelId;
    address participant;
    uint forkCnt; //redundant, but usefull for indexing and challenge in dispute
    uint transactionCnt; //redundant, but usefull for indexing and challenge in dispute
    bytes32 previousStateHash;
    uint deadlineTimestamp;
    bytes data; //custom data
}

struct LeaveChannelAgreement {
    bytes encodedLeaveChannel;
    bytes[] signatures;
}

struct ProcessExit {
    address participant;
    uint amount;
    bytes data; //custom data
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
    ExitChannel[] exitChannel;
    /// @dev Hash of the previous exitChannelBlock
    bytes32 previousBlockHash;
}

struct Timeout {
    /// @dev the participant that is being timed out
    address participant;
    /// @dev the block height at which participant is removed from the channel (fork)
    uint blockHeight;
    uint minTimeStamp;
    // ================== optional ==================
    address previousBlockProducer;
}

/// @dev a pair consisting of first index (index of the malicious dispute) and last index (last index in the array)
struct DisputePair {
    uint firstIndex;
    uint lastIndex;
}
