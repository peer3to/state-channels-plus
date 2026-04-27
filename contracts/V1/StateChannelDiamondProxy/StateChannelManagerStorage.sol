pragma solidity ^0.8.8;

import "../types/DisputeTypes.sol";
import "../types/DataTypes.sol";
import "../AStateMachine.sol";

contract StateChannelManagerStorage {
    //Config shared across all instances of the state machine
    uint256 public p2pTime;
    uint256 public agreementTime;
    uint256 public chainFallbackTime;
    // Time within more dispute can be submitted during the challenge period
    uint256 public evidenceTime;
    uint256 public gasLimit;

    AStateMachine stateMachineImplementation;

    // Facets
    address disputeManagerFacetAddress;
    address disputeVerificationFacetAddress;
    address fraudProofFacetAddress;
    address disputeFraudProofFacetAddress;
    address stateSnapshotFacetAddress;
    address joinChannelFacetAddress;
    address stateProofFacetAddress;
    address consumerFacetAddress;
    address utilityFacetAddress;

    // =================== State on chain storage ==================
    /// @dev Channel balance tracker
    mapping(bytes32 channelId => ChannelBalance) channelBalances;

    /// @dev Inbound message blockchain per channel (hash -> MessageBlock)
    mapping(bytes32 channelId => mapping(bytes32 blockHash => MessageBlock)) inboundMessageBlockMap;

    /// @dev stateSnapshot Data
    mapping(bytes32 channelId => StateSnapshot) stateSnapshots;

    // =================== Block on chain storage ==================

    /// @notice BlockCalldata Commitment
    /// @dev blockCalldataCommitments[channelId][signerAddress][forkId][blockHeight] => hash(off-chain block, on-chain block.timestamp)
    mapping(
        bytes32 channelId
            => mapping(
                address signerAddress
                    => mapping(bytes32 forkId => mapping(uint256 blockHeight => bytes32 blockCallDataCommitment))
            )
    ) blockCalldataCommitments;

    // ================== Dispute on chain storage ==================

    /// @dev disputeData[channelId] => DisputeData
    mapping(bytes32 channelId => DisputeData) disputeData;

    /// @dev Per-channel per-address throttle: address may not open a new dispute window until block.timestamp >= this value (0 = never submitted)
    mapping(bytes32 channelId => mapping(address disputer => uint256 throttleExpiry)) disputerThrottle;

    // ================== Modifiers ==================

    modifier onlySelf() {
        require(address(this) == msg.sender, "Only self (facet) can call this (diamond) function");
        _;
    }
}
