pragma solidity ^0.8.8;

import "./types/DisputeTypes.sol";
import "./types/DataTypes.sol";

interface StateChannelManagerEvents {
    event BlockCalldataPosted(bytes32 indexed channelId, address sender, SignedBlock signedBlock, uint256 timestamp);
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

    // Domain-level event for snapshot writes
    event ChannelSnapshotSet(bytes32 indexed channelId, StateSnapshot stateSnapshot);

    // ======= Config / init =======
    event P2pTimeSet(uint256 p2pTime);
    event AgreementTimeSet(uint256 agreementTime);
    event ChainFallbackTimeSet(uint256 chainFallbackTime);
    event EvidenceTimeSet(uint256 evidenceTime);
    event KillTimeSet(uint256 killTime);
    event GasLimitSet(uint256 gasLimit);
    event StateMachineImplementationSet(address implementation);

    // ======= Block calldata commitments =======
    event BlockCalldataCommitmentSet(
        bytes32 indexed channelId,
        address indexed participant,
        bytes32 indexed forkId,
        uint256 blockHeight,
        bytes32 commitment
    );

    // ======= Channel balances / joins / withdrawals =======
    event OnChainJoinChannelSet(bytes32 indexed channelId, bytes32 indexed blockHash, OnChainJoinChannel value);
    event OnChainJoinChannelDeleted(bytes32 indexed channelId, bytes32 indexed blockHash);
    event LatestJoinChannelBlockHashSet(bytes32 indexed channelId, bytes32 blockHash);
    event TotalOnChainWithdrawalsSet(bytes32 indexed channelId, Balance totalOnChainWithdrawals);

    // ======= Dispute data =======
    event OnChainSlashedAdded(bytes32 indexed channelId, address participant, uint256 timestamp);
    event PendingParticipantAdded(bytes32 indexed channelId, address participant);

    event DisputeWindowCreated(bytes32 indexed channelId, bytes32 indexed forkId, uint256 creationTimestamp);
    event DisputeWindowCreationTimestampSet(
        bytes32 indexed channelId, bytes32 indexed forkId, uint256 creationTimestamp
    );
    event DisputeCommitmentsCleared(bytes32 indexed channelId, bytes32 indexed forkId);
    event DisputeCommitmentPushed(bytes32 indexed channelId, bytes32 indexed forkId, bytes32 commitment);
    event DisputeCommitmentRemoved(bytes32 indexed channelId, bytes32 indexed forkId, uint256 index);
    event HasPostedSet(bytes32 indexed channelId, bytes32 indexed forkId, address indexed participant, bool hasPosted);
    event DisputeWindowDeleted(bytes32 indexed channelId, bytes32 indexed forkId);

    event ReducedResultCommitted(
        bytes32 indexed channelId,
        bytes32 indexed disputedForkId,
        bytes32 reducedForkId,
        uint256 reductionTimestamp,
        uint256 forkGenesisTimestamp,
        address reducer
    );
    event ReducedResultForkIdCleared(bytes32 indexed channelId, bytes32 indexed disputedForkId);

    event DisputedForkRemoved(bytes32 indexed channelId, bytes32 indexed forkId, uint256 index);
}
