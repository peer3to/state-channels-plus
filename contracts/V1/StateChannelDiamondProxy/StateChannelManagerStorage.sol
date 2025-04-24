pragma solidity ^0.8.8;

import "../DisputeTypes.sol";
import "../DataTypes.sol";
import "../AStateMachine.sol";

contract StateChannelManagerStorage {
    //Config shared across all instances of the state machine
    uint public p2pTime;
    uint public agreementTime;
    uint public chainFallbackTime;
    uint public challengeTime;
    uint256 public gasLimit;


    AStateMachine stateMachineImplementation;

    // =================== State on chain storage ==================

    /// @dev stateSnapshot Data
    mapping(bytes32 => StateSnapshot) stateSnapshots;
    /// @dev the fork genesis state. encodedState[channelId][forkCnt]
    mapping(bytes32 => mapping(uint => bytes)) encodedStates;
    
   
    // =================== Block on chain storage ==================


    /// @notice BlockCallData Commitment
    /// @dev blockCallDataCommitments[channelId][forkCnt][signerAddress] => blockCallDataCommitment
    mapping(bytes32 channelId => mapping(uint forkCnt => mapping(address signerAddress => bytes32 blockCallDataCommitment))) blockCallDataCommitments;


    // ================== Dispute on chain storage ==================


    /// @dev disputes[channelId] => array of dispute commitments
    /// @dev hash(Dspute Struct, timestamp)
    mapping(bytes32 => bytes32[]) disputes;

    /// @dev invalid committed disputes that onchain execution can be based on slashing participants
    DisputePair[] onChainDisputePairs;

    /// @dev slashed participants
    address[] onChainSlashedParticipants;

    /// @dev Participants that joined the state channel
    mapping(bytes32 => address[]) participants;

    /// @dev the hash of the latest block in the JoinChannel blockchain
    mapping(bytes32 => bytes32) latestJoinChannelBlockHash;


    // ================== Modifiers ==================

    modifier onlySelf() {
        require(
            address(this) == msg.sender,
            "Only self (facet) can call this (diamond) function"
        );
        _;
    }
}
