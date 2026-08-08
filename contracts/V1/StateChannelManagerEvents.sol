pragma solidity ^0.8.8;

import "./types/DisputeTypes.sol";
import "./types/DataTypes.sol";

interface StateChannelManagerEvents {
    event ChannelOpened(bytes32 indexed channelId, StateSnapshot stateSnapshot, bytes encodedState);

    event StateSnapshotUpdated(bytes32 indexed channelId, StateSnapshot stateSnapshot);

    event BlockCalldataPosted(
        bytes32 indexed channelId,
        bytes32 indexed commitmentHash,
        address sender,
        SignedBlock signedBlock,
        uint256 timestamp
    );

    event DisputeCommitted(
        bytes32 indexed channelId,
        DisputeConfirmation disputeConfirmation,
        uint256 disputeCreationTimestamp,
        bool isFinal,
        uint256 windowCreationTimestamp
    );

    event DisputeCommittedWithAuditingData(
        bytes32 indexed channelId,
        DisputeConfirmation disputeConfirmation,
        uint256 disputeCreationTimestamp,
        bool isFinal,
        uint256 windowCreationTimestamp,
        DisputeAuditingData disputeAuditingData
    );

    event ChainSlashed(bytes32 indexed channelId, address participant, uint256 timestamp);

    event DisputeReducedResultCommitted(
        bytes32 indexed channelId, bytes32 forkId, bytes32 reducedForkId, uint256 reductionTimestamp, address reducer
    );

    event WithdrawalsUpdated(bytes32 indexed channelId, Balance totalWithdrawals);

    event ChannelStorageCleared(bytes32 indexed channelId, bytes32 latestInboundMessageBlockHash);

    event DisputeKilled(bytes32 indexed channelId, bytes32 forkId, address disputer, bytes32 disputeHash);

    event InboundMessagesProcessed(bytes32 indexed channelId, MessageBlock messageBlock);
}
