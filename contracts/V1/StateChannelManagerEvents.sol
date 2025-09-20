pragma solidity ^0.8.8;

import "./types/DisputeTypes.sol";
import "./types/DataTypes.sol";

interface StateChannelManagerEvents {
    event BlockCalldataPosted(
        bytes32 indexed channelId,
        bytes32 indexed commitmentHash,
        address sender,
        SignedBlock signedBlock,
        uint256 timestamp
    );
    event SetState(bytes32 indexed channelId, bytes encodedState, bytes32 forkId, uint256 timestamp);
    event DisputeCommitted(
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

    event JoinChannelProcessed(
        bytes32 indexed channelId, JoinChannelBlock joinChannelBlock, uint256 timestamp, Balance totalDeposits
    );

    event OnChainSlashAdded(bytes32 indexed channelId, address participant, uint256 timestamp);
    event WithdrawalsUpdated(bytes32 indexed channelId, Balance totalWithdrawals);
    event ChannelStorageCleared(bytes32 indexed channelId, bytes32 latestJoinChannelBlockHash);
    event DisputeKilled(bytes32 indexed channelId, bytes32 forkId, address disputer);
    event DisputeReducedResultCommitted(
        bytes32 indexed channelId, bytes32 forkId, bytes32 reducedForkId, uint256 reductionTimestamp, address reducer
    );
}
