pragma solidity ^0.8.8;

import "./DisputeTypes.sol";
import "./DataTypes.sol";

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

    event DisputeChallengeResultWithDisputePair(
        bytes32 indexed channelId, DisputePair disputePair, bool isSuccess, address[] slashParticipants
    );

    event DisputeChallengeResult(bytes32 indexed channelId, bool isSuccess, address[] slashParticipants);

    event DisputeChallengeResultWithError(
        bytes32 indexed channelId, bool isSuccess, address[] slashParticipants, bytes fraudProofErrorResult
    );

    event StateSnapshotUpdated(bytes32 indexed channelId, StateSnapshot stateSnapshot, uint256 timestamp);

    event OutputStateSnapshotVerified(
        bytes32 indexed channelId, StateSnapshot stateSnapshot, bytes32 disputeCommitment
    );
}
