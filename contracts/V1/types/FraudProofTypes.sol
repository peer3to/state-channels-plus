pragma solidity ^0.8.8;

import "./DataTypes.sol";

contract FraudProofTypes {
    constructor(
        BlockEmptyProof memory a,
        BlockInvalidStateTransitionProof memory b,
        BlockDoubleSignProof memory c,
        InvalidTimestampProof memory d,
        WrongGenesisProof memory e,
        ForgedInboundMessageBlockProof memory f
    ) {}
}
// ========================== Block related fraud proofs ==========================

struct BlockEmptyProof {
    // TODO - remove this and make sure that a valid stateTranistion actually tansitions the state
    SignedBlock emptyBlock;
    SignedBlock previousBlock;
}

struct BlockInvalidStateTransitionProof {
    SignedBlock invalidBlock;
    SignedBlock previousBlock;
    StateSnapshot previousBlockStateSnapshot;
    bytes previousStateStateMachineState;
}

struct BlockDoubleSignProof {
    SignedBlock block1;
    SignedBlock block2;
}

struct InvalidTimestampProof {
    SignedBlock invalidBlock;
    SignedBlock previousBlock;
    StateSnapshot previousStateSnapshot;
}

struct WrongGenesisProof {
    SignedBlock invalidBlock;
    StateSnapshot genesisSnapshot;
}

struct ForgedInboundMessageBlockProof {
    SignedBlock invalidBlock;
    MessageBlock forgedInboundMessageBlock;
}
