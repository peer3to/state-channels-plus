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
    /// @dev the fork genesis state
    mapping(bytes32 => mapping(uint => bytes)) encodedStates; // [channelId][forkCnt] -> encodedState
    //TODO* - think do we need to store previous timestamps
    mapping(bytes32 => mapping(uint => uint)) genesisTimestamps; // [channelId][forkCnt] -> encodedState
    mapping(bytes32 => uint) latestFork; // [channelId] -> latestFork
   
    // ================== Dispute on chain storage ==================

    /// @dev disputes[channelId] => array of dispute commitments
    /// @dev hash(Dspute Struct, timestamp)
    mapping(bytes32 => bytes32[]) disputes;

    /// @dev invalid committed disputes that onchain execution can be based on slashing participants
    DisputePair[] onChainDisputePairs;

    /// @dev slashed participants
    /// @dev the last index stores the commitment of the addresses, this to make it gas efficient. So the true length is N-1
    address[] onChainSlashedParticipants;

    modifier onlySelf() {
        require(
            address(this) == msg.sender,
            "Only self (facet) can call this (diamond) function"
        );
        _;
    }
}
