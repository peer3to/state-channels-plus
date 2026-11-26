pragma solidity ^0.8.8;

import "../types/DisputeTypes.sol";
import "../types/DataTypes.sol";
import "../AStateMachine.sol";

/// what the chain reads back of an inbound block; the full block is in InboundMessagesProcessed
struct StoredInboundBlock {
    bytes32 previousBlockHash;
    uint128 blockHeight;
    uint128 timestamp;
    Balance totalBalance;
    address[] joiners; // participants of the block's JOIN messages, in message order
}

contract StateChannelManagerStorage {
    struct SelectorRoute {
        address facet;
        bool configured;
    }

    //Config shared across all instances of the state machine
    uint256 internal p2pTime;
    uint256 internal agreementTime;
    uint256 internal chainFallbackTime;
    // Time within more dispute can be submitted during the challenge period
    uint256 internal evidenceTime;
    uint256 internal gasLimit;
    // Upper bound on a channel's participant union, counterpart to the
    // two-participant minimum. Off-chain agreement needs a signature from every
    // participant, so the union size bounds how many confirmation signatures a
    // valid block carries and therefore what a client must retain. The
    // duplicate-participant scan at open is quadratic in the union, so the
    // bound also keeps that loop's gas finite.
    uint256 internal maxChannelParticipants;
    // Upper bound on a dispute upload's encoded dispute, in bytes. A kill carries the dispute next to a final proof
    // in one transaction, so the bound keeps room for that proof under the calldata limit.
    uint256 internal maxDisputeUploadBytes;

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

    /// @dev Inbound message blockchain per channel (hash -> StoredInboundBlock)
    mapping(bytes32 channelId => mapping(bytes32 blockHash => StoredInboundBlock)) inboundMessageBlockMap;

    /// @dev stateSnapshot Data
    mapping(bytes32 channelId => StateSnapshot) stateSnapshots;

    /// @dev Enumerable set of channels whose snapshot currently exists on-chain.
    bytes32[] openChannelIds;
    mapping(bytes32 channelId => uint256 indexPlusOne) openChannelIndexPlusOne;

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

    /// @dev Immutable-at-runtime selector routes installed by the proxy constructor.
    mapping(bytes4 selector => SelectorRoute route) selectorRoutes;

    // ================== Modifiers ==================

    modifier onlySelf() {
        require(address(this) == msg.sender, "Only self (facet) can call this (diamond) function");
        _;
    }
}
