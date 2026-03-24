pragma solidity ^0.8.8;

import "./types/DataTypes.sol";
import "./types/DisputeTypes.sol";

abstract contract StateChannelManagerInterface {
    function open(OpenChannelConfirmation calldata openChannelConfirmation) public virtual;

    function isChannelOpen(bytes32 channelId) public view virtual returns (bool, StateSnapshot memory);

    function getParticipants(bytes32 channelId) public virtual returns (address[] memory);

    function getP2pTime() public view virtual returns (uint256);

    function getAgreementTime() public view virtual returns (uint256);

    function getChainFallbackTime() public view virtual returns (uint256);

    function getEvidenceTime() public view virtual returns (uint256);

    function getAllTimes() public view virtual returns (uint256, uint256, uint256, uint256);

    function withdrawAssetsComposable(ExitChannel memory exitChannel) public virtual returns (bool);

    function executeStateTransition(bytes32 channelId, bytes memory encodedState, Transaction memory _tx)
        public
        virtual
        returns (bool, bytes memory, Message[] memory);

    function postBlockCalldata(SignedBlock memory signedBlock, uint256 maxTimestamp) public virtual;

    function getBlockCallDataCommitment(bytes32 channelId, bytes32 forkId, uint256 blockHeight, address participant)
        public
        view
        virtual
        returns (bool found, bytes32 blockCalldataCommitment);

    function hasInboundMessageBlock(bytes32 channelId, bytes32 messageBlockHash) public view virtual returns (bool);

    function verifyStateProof(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        virtual
        returns (bool);

    function isCorrectLatestState(Dispute memory dispute, SnapshotData memory genesisStateSnapshotData)
        public
        virtual
        returns (bool);

    function verifyMilestones(
        bytes32 forkId,
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        StateSnapshot memory thresholdStateSnapshot
    ) public virtual returns (bool isValid);

    function isMilestoneFinal(
        bytes32 forkId,
        SnapshotData memory thresholdSnapshotData,
        MilestoneProof memory milestone
    ) public virtual returns (bool isFinal, bytes32 finalizedSnapshotHash);

    function isGenesisSnapshotWithoutTimeCheck(StateSnapshot memory snapshot) public view virtual returns (bool);

    function isSnapshotNewer(StateSnapshot memory newSnapshot, StateSnapshot memory currentSnapshot)
        public
        view
        virtual
        returns (bool);

    function uploadDispute(DisputeConfirmation memory disputeConfirmation) public virtual;

    function uploadDisputeWithCalldata(
        DisputeConfirmation memory disputeConfirmation,
        DisputeAuditingData memory disputeAuditingData
    ) public virtual;

    function challengeDisputeReduction(
        Dispute[] memory disputes,
        StateSnapshot memory latestStateSnapshot,
        bytes memory encodedStateMachineState,
        MessageBlock[] memory inboundMessageBlocks
    ) public virtual;

    function applyDisputeFraudProofs(DisputeFraudProof[] memory proofs) public virtual;

    function updateStateSnapshotFork(
        bytes32 channelId,
        StateSnapshot memory newStateSnapshot,
        MessageBlock[] memory outboundMessageBlocks
    ) public virtual;

    function updateStateSnapshotSameFork(
        bytes32 channelId,
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        MessageBlock[] memory outboundMessageBlocks
    ) public virtual;

    function joinChannel(JoinChannelConfirmation memory joinChannelConfirmations) public virtual;

    function isForkDisputed(bytes32 channelId, bytes32 forkId) public view virtual returns (bool);

    function multicall(bytes[] calldata calls) external virtual returns (bytes[] memory results);

    function reduce(Dispute[] memory disputes) public virtual returns (ReduceOutput memory);

    function reduceOutputToSnapshotData(
        bytes32 forkId,
        ReduceOutput memory reducedOutput,
        StateSnapshot memory latestStateSnapshot,
        bytes memory encodedStateMachineState,
        MessageBlock[] memory inboundMessageBlocks
    ) public virtual returns (SnapshotData memory, bytes memory, MessageBlock memory);

    function reduceAndFinalize(
        Dispute[] memory disputes,
        StateSnapshot memory stateSnapshot,
        bytes memory encodedStateMachineState,
        MessageBlock[] memory inboundMessageBlocks,
        bytes32 expectedReducedForkId
    ) public virtual;
}
