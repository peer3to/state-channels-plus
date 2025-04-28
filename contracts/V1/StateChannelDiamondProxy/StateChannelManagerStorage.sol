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
   
    // =================== Block on chain storage ==================

    /// @notice BlockCalldata Commitment
    /// @dev blockCalldataCommitments[channelId][signerAddress][forkCnt][blockHeight] => hash(off-chain block, on-chain block.timestamp)
    mapping(bytes32 channelId => mapping(address signerAddress => mapping(uint forkCnt => mapping(uint blockHeight => bytes32 blockCallDataCommitment)))) blockCalldataCommitments;


    // ================== Dispute on chain storage ==================

    /// @dev disputeData[channelId] => DisputeData
    mapping(bytes32 channelId => DisputeData) disputeData;


    // ================== Modifiers ==================

    modifier onlySelf() {
        require(
            address(this) == msg.sender,
            "Only self (facet) can call this (diamond) function"
        );
        _;
    }
}
