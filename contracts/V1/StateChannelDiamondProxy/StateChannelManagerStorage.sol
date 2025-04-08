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

    AStateMachine stateMachineImplementation;
    //TODO* - think do we need to store previous states
    mapping(bytes32 => mapping(uint => bytes)) encodedStates; // [channelId][forkCnt] -> encodedState
    //TODO* - think do we need to store previous timestamps
    mapping(bytes32 => mapping(uint => uint)) genesisTimestamps; // [channelId][forkCnt] -> encodedState
    mapping(bytes32 => uint) latestFork; // [channelId] -> latestFork
    //TODO* - this can map to a hash, but it also has to store keys[] and timestamp
    mapping(bytes32 => mapping(uint => ForkDataAvailability)) postedBlockCalldata; //[channelId][forkCnt].map[transactionCnt][address] -> BlockCalldata
    
    // ================== Dispute on chain storage ==================

    /// @dev disputes[channelId] => array of dispute commitments
    /// @dev hash(Dspute Struct, timestamp)
    mapping(bytes32 => bytes32[]) disputes;

    /// @dev disputesData[channelId] => array of encoded dispute data
    mapping(bytes32 => bytes32[]) dipsutesData;

    /// @dev invalid committed disputes that onchain execution can be based on slashing participants
    DisputePair[] onChainDisputePairs;

    /// @dev slashed participants
    address[] onChainSlashedParticipants;

    modifier onlySelf() {
        require(
            address(this) == msg.sender,
            "Only self (facet) can call this (diamond) function"
        );
        _;
    }
}
