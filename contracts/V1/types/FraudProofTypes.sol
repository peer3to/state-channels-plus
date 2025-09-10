pragma solidity ^0.8.8;

import "./DataTypes.sol";

contract FraudProofTypes {
    constructor(
        BlockEmptyProof memory a,
        BlockInvalidStateTransitionProof memory b,
        BlockDoubleSignProof memory c,
        InvalidTimestampProof memory d,
        WrongGenesisProof memory e
    ) {}
}
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

struct InvalidTimestampProof {
    SignedBlock invalidBlock;
    uint256 invalidBlockOnChainTimestamp;
    SignedBlock previousBlock;
    SignedBlock previousBlockCalldata;
    uint256 previousBlockOnChainTimestamp;
    bytes signatureOnPreviousBlock;
    StateSnapshot previousStateSnapshot;
}

struct WrongGenesisProof {
    SignedBlock invalidBlock;
    StateSnapshot genesisSnapshot;
}
