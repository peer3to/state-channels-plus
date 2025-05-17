pragma solidity ^0.8.8;

import "./DataTypes.sol";
import "./DisputeTypes.sol";

abstract contract StateChannelManagerInterface {
    function openChannel(
        bytes32 channelId,
        bytes[] calldata openChannelData,
        bytes[] calldata signatures
    ) public virtual;

    function closeChannel(
        bytes32 channelId,
        bytes[] calldata closeChannelData,
        bytes[] calldata signatures
    ) public virtual;

    function removeParticipant(
        bytes32 channelId,
        bytes[] calldata removeParticipantData,
        bytes[] calldata signatures
    ) public virtual;

    function processExitChannel(
        bytes32 channelId,
        ExitChannel calldata exitChannel
    ) public virtual;

    function addParticipant(
        bytes32 channelId,
        bytes[] calldata removeParticipantData,
        bytes[] calldata signatures
    ) public virtual;

    function isChannelOpen(
        bytes32 channelId
    ) public view virtual returns (bool);

    function getForkCnt(bytes32 channelId) public view virtual returns (uint);

    function getParticipants(
        bytes32 channelId
    ) public virtual returns (address[] memory);

    function getNextToWrite(
        bytes32 channelId,
        bytes memory encodedState
    ) public virtual returns (address);

    function getP2pTime() public view virtual returns (uint);

    function getAgreementTime() public view virtual returns (uint);

    function getChainFallbackTime() public view virtual returns (uint);

    function getChallengeTime() public view virtual returns (uint);

    function getAllTimes() public view virtual returns (uint, uint, uint, uint);

    function getChainLatestBlockTimestamp(
        bytes32 channelId,
        uint forkCnt,
        uint maxTransactionCnt
    ) public view virtual returns (uint);

    function executeStateTransitionOnState(
        bytes32 channelId,
        bytes memory encodedState,
        Transaction memory _tx
    ) public virtual returns (bool, bytes memory);

    function postBlockCalldata(SignedBlock memory signedBlock, uint maxTimestamp) public virtual;

    function getBlockCallDataCommitment(
        bytes32 channelId,
        uint forkCnt,
        uint blockHeight,
        address participant
    ) public view virtual returns (bool found, bytes32 blockCalldataCommitment);

    function createDispute(
        Dispute memory dispute
    ) public virtual;

    function auditDispute(
        Dispute memory dispute,
        DisputeAuditingData memory disputeAuditingData 
    ) public virtual returns (address[] memory slashParticipants);

    function challengeDispute(
        Dispute memory dispute,
        Dispute memory newDispute,
        DisputeAuditingData memory disputeAuditingData
    ) public virtual;

    function updateStateSnapshotWithDispute(
        bytes32 channelId,
        ForkMilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        DisputeProof memory disputeProof,
        ExitChannelBlock[] memory exitChannelBlocks
    ) public virtual;

    function updateStateSnapshotWithoutDispute(
        bytes32 channelId,
        ForkMilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        ExitChannelBlock[] memory exitChannelBlocks
    ) public virtual;
}
