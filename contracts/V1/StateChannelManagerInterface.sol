pragma solidity ^0.8.8;

import "./types/DataTypes.sol";
import "./types/DisputeTypes.sol";

abstract contract StateChannelManagerInterface {
    function openChannel(bytes32 channelId, bytes[] calldata openChannelData, bytes[] calldata signatures)
        public
        virtual;

    function closeChannel(bytes32 channelId, bytes[] calldata closeChannelData, bytes[] calldata signatures)
        public
        virtual;

    function removeParticipant(bytes32 channelId, bytes[] calldata removeParticipantData, bytes[] calldata signatures)
        public
        virtual;

    function addParticipant(bytes32 channelId, bytes[] calldata removeParticipantData, bytes[] calldata signatures)
        public
        virtual;

    function isChannelOpen(bytes32 channelId) public view virtual returns (bool);

    function getParticipants(bytes32 channelId) public virtual returns (address[] memory);

    function getP2pTime() public view virtual returns (uint256);

    function getAgreementTime() public view virtual returns (uint256);

    function getChainFallbackTime() public view virtual returns (uint256);

    function getEvidenceTime() public view virtual returns (uint256);

    function getKillTime() public view virtual returns (uint256);

    function getAllTimes() public view virtual returns (uint256, uint256, uint256, uint256, uint256);

    function executeStateTransition(bytes32 channelId, bytes memory encodedState, Transaction memory _tx)
        public
        virtual
        returns (bool, bytes memory);

    function postBlockCalldata(SignedBlock memory signedBlock, uint256 maxTimestamp) public virtual;

    function getBlockCallDataCommitment(bytes32 channelId, bytes32 forkId, uint256 blockHeight, address participant)
        public
        view
        virtual
        returns (bool found, bytes32 blockCalldataCommitment);

    function uploadDispute(DisputeConfirmation memory disputeConfirmation) public virtual;

    function uploadDisputeWithCalldata(
        DisputeConfirmation memory disputeConfirmation,
        DisputeAuditingData memory disputeAuditingData
    ) public virtual;

    function auditDispute(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        virtual
        returns (address[] memory slashParticipants);

    function uploadDisputeAndAudit(
        DisputeConfirmation memory disputeConfirmation,
        DisputeAuditingData memory disputeAuditingData
    ) public virtual;

    function challengeDispute(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData) public virtual;

    function applyDisputeFraudProofs(DisputeFraudProof[] memory proofs) public virtual;

    function updateStateSnapshotFork(
        bytes32 channelId,
        StateSnapshot memory newStateSnapshot,
        ExitChannelBlock[] memory exitChannelBlocks
    ) public virtual;

    function updateStateSnapshotSameFork(
        bytes32 channelId,
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        ExitChannelBlock[] memory exitChannelBlocks
    ) public virtual;

    function joinChannel(JoinChannelConfirmation memory joinChannelConfirmations) public virtual;

    function isForkDisputed(bytes32 channelId, bytes32 forkId) public view virtual returns (bool);

    function multicall(bytes[] calldata calls) external virtual returns (bytes[] memory results);
}
