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
    //TODO* - enough only to store hash (commitiment)
    mapping(bytes32 => Dispute) disputes; // disputes[channelId] => Dispute #only 1 dispute per fork and at a time

    modifier onlySelf() {
        require(
            address(this) == msg.sender,
            "Only self (facet) can call this (diamond) function"
        );
        _;
    }
}
