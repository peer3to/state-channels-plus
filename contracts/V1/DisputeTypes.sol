pragma solidity ^0.8.8;

import "./DataTypes.sol";

//Just so typechain generates types for the structs bellow
contract DisputeTypes {
    constructor(
        Dispute memory a,
        Proof memory b,
        FoldRechallengeProof memory c,
        DoubleSignProof memory d,
        IncorrectDataProof memory e,
        NewerStateProof memory f,
        FoldPriorBlockProof memory g,
        BlockTooFarInFutureProof memory h
    ) {}
}

struct Dispute {
    /// @notice Channel ID
    bytes32 channelId;
    /// @notice Hash of genesis state (previous dispute output or latest on-chain state)
    /// @dev Used for state verification and fork creation
    bytes32 genesisStateHash;
    /// @notice encoded latest state (latest on-chain state)
    bytes32 latestState;
    /// @notice State proofs for the dispute
    StateProof[] stateProofs;
    /// @notice Fraud proofs for the dispute
    Proof[] fraudProofs;
    /// @notice participants that were slashed on chain
    address[] onchainSlashes;
    /// @notice Hash of output state (latest on-chain state)
    /// @dev created after from dispute resolution
    bytes32 outputStateHash;
    /// @notice Address of the disputer, this can be anyone who have a stake in the dispute on chain
    address disputer;
    /// @notice Index of the dispute
    uint disputeIndex;
    /// @notice Deadline for the challenge
    uint256 challengeDeadline;
    /// @notice Stores all exits since genesis
    /// @dev the time range of the exit is from genesis to the challenge deadline (new fork)
    ExitChannelBlock[] exitChannelBlocks;
    // ========================== optional ===============================
    /// @notice Previous recursive dispute hash
    bytes32 previousRecursiveDisputeHash;
    /// @notice Timeout for the dispute
    Timeout timeout;
    /// @notice Self removal for the dispute
    bool selfRemoval;
}

struct BlockConfirmation {
    bytes encodedBlock;
    bytes[] signatures;
}

struct ForkMilestoneProof {
    BlockConfirmation[] blockConfirmations;
}

struct ForkProof {
    ForkMilestoneProof[] forkMilestoneProofs;
}

/// @notice Proof of state finality within a fork
struct StateProof {
    /// @dev proves the last finalized block in the fork
    ForkProof forkProof;
    /// @dev a list of signed blocks that cryptographically connect the last milestone in the forkProof 
    SignedBlock[] signedBlocks;
}

//Fraud Proof Types:

struct Proof {
    ProofType proofType;
    bytes encodedProof;
}

enum ProofType {
    // Block releated fraud proofs
    BlockDoubleSign,
    BlockEmptyBlock,
    BlockInvalidStateTransition,
    BlockOutOfGas,

    // Timeout related fraud proofs
    TimeoutThreshold,
    TimeoutPriorInvalid,
    TimeoutParticipantNoNext,

    // Dispute fraud proofs
    DisputeNotLatestState,
    DisputeInvalid,
    DisputeInvalidRecursive,
    DisputeOutOfGas,
    DisputeInvalidOutputState,
    DisputeInvalidStateProof,
    DisputeInvalidPreeviousRecursive,
    DisputeInvalidExitChannelBlocks
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
