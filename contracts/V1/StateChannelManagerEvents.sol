pragma solidity ^0.8.8;

import "./DisputeTypes.sol";
import "./DataTypes.sol";

interface StateChannelManagerEvents {
    event BlockCalldataPosted(
        bytes32 indexed channelId,
        address sender,
        SignedBlock signedBlock,
        uint timestamp
    );
    event SetState(
        bytes32 indexed channelId,
        bytes encodedState,
        uint forkCnt,
        uint timestamp
    );
    event DisputeUpdated(bytes32 indexed channelId, Dispute dispute);

    event DisputeCommited(
    bytes encodedDispute,
    uint timestamp
    );

    event DisputeChallengeResultWithDisputePair(
    bytes32 channelId,
    DisputePair disputePair,
    bool isSuccess,
    address[] slashParticipants
    );

    event DisputeChallengeResultWithError(
    bytes32 channelId,
    bool isSuccess,
    address[] slashParticipants,
    bytes fraudProofErrorResult
    );
}
