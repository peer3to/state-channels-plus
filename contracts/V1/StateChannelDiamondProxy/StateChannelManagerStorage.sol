pragma solidity ^0.8.8;

import "../DisputeTypes.sol";
import "../DataTypes.sol";
import "../AStateMachine.sol";

contract StateChannelManagerStorage {
    //Config shared across all instances of the state machine
    uint256 public p2pTime;
    uint256 public agreementTime;
    uint256 public chainFallbackTime;
    uint256 public challengeTime;
    uint256 public gasLimit;

    AStateMachine stateMachineImplementation;

    // =================== State on chain storage ==================
    /// @dev Total on-chain processed deposits
    mapping(bytes32 channelId => Balance) totalOnChainProcessedDeposits;
    /// @dev Total on-chain processed withdraws
    mapping(bytes32 channelId => Balance) totalOnChainProcessedWithdrawals;

    /// @dev stateSnapshot Data
    mapping(bytes32 channelId => StateSnapshot) stateSnapshots;

    // =================== Block on chain storage ==================

    /// @notice BlockCalldata Commitment
    /// @dev blockCalldataCommitments[channelId][signerAddress][forkCnt][blockHeight] => hash(off-chain block, on-chain block.timestamp)
    mapping(
        bytes32 channelId
            => mapping(
                address signerAddress
                    => mapping(uint256 forkCnt => mapping(uint256 blockHeight => bytes32 blockCallDataCommitment))
            )
    ) blockCalldataCommitments;

    // ================== Dispute on chain storage ==================

    /// @dev disputeData[channelId] => DisputeData
    mapping(bytes32 channelId => DisputeData) disputeData;

    // ================== Modifiers ==================

    modifier onlySelf() {
        require(address(this) == msg.sender, "Only self (facet) can call this (diamond) function");
        _;
    }
}
