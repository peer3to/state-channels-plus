pragma solidity ^0.8.8;

import "./types/DisputeTypes.sol";
import "./types/DataTypes.sol";

interface StateChannelManagerEvents {
    event BlockCalldataPosted(bytes32 indexed channelId, address sender, SignedBlock signedBlock, uint256 timestamp);
    event SetState(bytes32 indexed channelId, bytes encodedState, bytes32 forkId, uint256 timestamp);
    event DisputeCommited(
        bytes32 indexed channelId,
        Dispute dispute,
        uint256 disputeCreationTimestamp,
        bool isFinal,
        uint256 windowCreationTimestamp
    );
    event DisputeAuditingDataPosted(
        bytes32 indexed channelId, bytes32 disputeHash, DisputeAuditingData disputeAuditingData
    );

    event StateSnapshotUpdated(bytes32 indexed channelId, StateSnapshot stateSnapshot, uint256 timestamp);

    event OutputStateSnapshotVerified(
        bytes32 indexed channelId, StateSnapshot stateSnapshot, bytes32 disputeCommitment
    );

    event JoinChannelProcessed(bytes32 indexed channelId, JoinChannelBlock joinChannelBlock, uint256 timestamp);
}
