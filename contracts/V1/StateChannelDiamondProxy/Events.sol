pragma solidity ^0.8.8;

import "../DisputeTypes.sol";
event DisputeSubmitted(
    bytes encodedDispute,
    bytes signature
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