pragma solidity ^0.8.8;

import "./DataTypes.sol";

//Just so typechain generates types for the structs bellow
contract DisputeTypes {
    constructor(
        Dispute memory a,
        Proof memory b,
        FoldRechallengeProof memory c
    ) {}
}

struct Dispute {
    bytes32 channelId;
    uint forkCnt;
    uint challengeCnt; //challenges target a specific state of dispute (race condition)
    bytes encodedLatestFinalizedState; //maps to latestFinalizedBlock
    bytes encodedLatestCorrectState; //maps to virtualVotingBlocks[last]
    ConfirmedBlock[] virtualVotingBlocks; // If len > 0 -> [0] is finalized BLOCK;
    address timedoutParticipant;
    uint foldedTransactionCnt;
    address timeoutDisputer;
    address postedStateDisputer;
    JoinChannel[] joinChannelParticipants;
    address[] leaveChannelParticipants;
    address[] slashedParticipants;
    address[] participants;
    ProcessExit[] processExits; //Channel removals that will be processed once the dispute is finalized
    uint creationTimestamp;
    uint deadlineTimestamp;
}

//Fraud Proof Types:

struct Proof {
    ProofType proofType;
    bytes encodedProof;
}

enum ProofType {
    FoldRechallenge,
    DoubleSign,
    IncorrectData,
    NewerState,
    FoldPriorBlock,
    BlockTooFarInFuture,
    JoinChannel,
    LeaveChannelForce
}

struct FoldRechallengeProof {
    bytes encodedBlock;
    bytes[] signatures; // N-1 confirmations on challanged BLOCK
}

struct DoubleSignProof {
    DoubleSign[] doubleSigns; // N-1 confirmations on challanged BLOCK
}

struct DoubleSign {
    SignedBlock block1;
    SignedBlock block2;
}

struct IncorrectDataProof {
    //These blocks don't have to be in virtual votes
    //Block2 is first block after fork - if encoded state is genesis than block1 is ignored
    //Otherwise block2 builds on block1
    SignedBlock block1;
    SignedBlock block2;
    bytes encodedState; //The state post Block1 (the last valid block) and pre Block2 to prove ivalid
}

struct NewerStateProof {
    bytes encodedBlock;
    bytes confirmationSignature;
}

struct FoldPriorBlockProof {
    uint transactionCnt; //fold that participant - if something is not correct in state use a different proof to cancel the fold
}

struct BlockTooFarInFutureProof {
    SignedBlock block1;
}

struct JoinChannelProof {
    bytes encodedSignedJoinChannel;
    bytes[] signatures; //all N current participants + participant signature
}

//This is when there is no agreement and the participant needs to exit through dipute (challenge period)
//For the happy case (with agreement) the participant can just leave through the StateChannelManager by proving agreement
