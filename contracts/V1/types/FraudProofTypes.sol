pragma solidity ^0.8.8;

import "./DataTypes.sol";

// ========================== Block related fraud proofs ==========================
struct BlockEmptyProof {
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
