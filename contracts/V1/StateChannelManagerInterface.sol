pragma solidity ^0.8.8;

import "./types/DataTypes.sol";
import "./types/DisputeTypes.sol";
import "./types/DisputeFraudProofTypes.sol";
import "./types/FraudProofTypes.sol";
import "./StateChannelManagerEvents.sol";

/// @dev Caller-side typing artifact for the whole deployed diamond: the union of
/// what `StateChannelManagerProxy` implements itself and what its fallback routes
/// to the facets. Nothing implements it - the proxy deliberately does not inherit
/// it, so routed functions cost the proxy a selector comparison instead of a
/// forwarder body. Callers (facets doing typed self-calls, typechain consumers)
/// bind it to the proxy address.
abstract contract StateChannelManagerInterface is StateChannelManagerEvents {
    // ********** implemented by StateChannelManagerProxy **********

    function open(OpenChannelConfirmation calldata openChannelConfirmation) public virtual;

    function postBlockCalldata(SignedBlock memory signedBlock, uint256 maxTimestamp) public virtual;

    function depositAssetsComposable(JoinChannel[] memory joinChannels, bool isAtomic)
        public
        virtual
        returns (
            MessageBlock memory messageBlock,
            Balance memory newTotalDeposits,
            JoinChannel[] memory successfulJoins
        );

    function withdrawAssetsComposable(ExitChannel memory exitChannel) public virtual returns (bool);

    function executeStateTransition(bytes32 channelId, bytes memory encodedState, Transaction memory _tx)
        public
        virtual
        returns (bool, bytes memory encodedModifiedState, Message[] memory outboundMessages);

    function multicall(bytes[] calldata calls) external virtual returns (bytes[] memory results);

    function facetAddressForSelector(bytes4 sig) public view virtual returns (address);

    // ********** routed to UtilityFacet **********

    function getParticipants(bytes32 channelId) public view virtual returns (address[] memory);

    function getSnapshotParticipants(bytes32 channelId) public view virtual returns (address[] memory);

    function getPendingParticipants(bytes32 channelId) public view virtual returns (address[] memory);

    function getOnChainSlashedParticipants(bytes32 channelId) public view virtual returns (address[] memory);

    function getOnChainSlashedParticipantsUpToTimestamp(bytes32 channelId, uint256 timestamp)
        public
        view
        virtual
        returns (address[] memory);

    function isParticipantSlashedOnChain(bytes32 channelId, address participant) public view virtual returns (bool);

    function getOnChainThresholdSet(bytes32 channelId) public view virtual returns (address[] memory);

    function canParticipateInDisputes(bytes32 channelId, address participant) public view virtual returns (bool);

    function getStateSnapshot(bytes32 channelId) public view virtual returns (StateSnapshot memory);

    function getChannelBalance(bytes32 channelId) public view virtual returns (ChannelBalance memory);

    function isChannelOpen(bytes32 channelId) public view virtual returns (bool, StateSnapshot memory);

    function isForkDisputed(bytes32 channelId, bytes32 forkId) public view virtual returns (bool);

    function getP2pTime() public view virtual returns (uint256);

    function getAgreementTime() public view virtual returns (uint256);

    function getChainFallbackTime() public view virtual returns (uint256);

    function getEvidenceTime() public view virtual returns (uint256);

    function getGasLimit() public view virtual returns (uint256);

    function getAllTimes() public view virtual returns (uint256, uint256, uint256, uint256);

    function getBlockCallDataCommitment(bytes32 channelId, bytes32 forkId, uint256 blockHeight, address participant)
        public
        view
        virtual
        returns (bool found, bytes32 blockCalldataCommitment);

    function hasInboundMessageBlock(bytes32 channelId, bytes32 messageBlockHash) public view virtual returns (bool);

    function isBlockAuthentic(SignedBlock memory _block) public view virtual returns (bool);

    function getWindowCommitments(bytes32 channelId, bytes32 forkId)
        public
        view
        virtual
        returns (bytes32[] memory disputeCommitments);

    function getDisputeWindowCreationTimestamp(bytes32 channelId, bytes32 forkId)
        public
        view
        virtual
        returns (uint256 creationTimestamp);

    function getReducedResult(bytes32 channelId, bytes32 forkId)
        public
        view
        virtual
        returns (bytes32 reducedForkId, uint256 timestamp, address reducer);

    function isKillPeriodExpired(bytes32 channelId, bytes32 forkId)
        public
        view
        virtual
        returns (bool windowExists, bool isExpired, uint256 killPeriodEnd, uint256 blockTimestamp);

    function isReduceChallengePeriodExpired(bytes32 channelId, bytes32 forkId) public view virtual returns (bool);

    function getDisputeWindows(bytes32 channelId, bytes32[] memory forkIds)
        public
        view
        virtual
        returns (DisputeWindow[] memory);

    function verifyOutboundMessageBlocks(
        MessageBlock[] memory outboundMessageBlocks,
        SnapshotData memory lowerSnapshot,
        SnapshotData memory upperSnapshot
    ) public view virtual returns (bool);

    function pruneOutboundMessageBlocks(MessageBlock[] memory outboundMessageBlocks, bytes32 lowerHash)
        public
        pure
        virtual
        returns (MessageBlock[] memory);

    function isGenesisSnapshotWithoutTimeCheck(StateSnapshot memory snapshot) public pure virtual returns (bool);

    function isSnapshotNewer(StateSnapshot memory newSnapshot, StateSnapshot memory currentSnapshot)
        public
        pure
        virtual
        returns (bool);

    // ********** routed to DisputeManagerFacet **********

    function uploadDispute(DisputeConfirmation memory disputeConfirmation) public virtual;

    function uploadDisputeWithCalldata(
        DisputeConfirmation memory disputeConfirmation,
        DisputeAuditingData memory disputeAuditingData
    ) public virtual;

    // ********** routed to DisputeVerificationFacet **********

    function challengeDisputeReduction(
        Dispute[] memory disputes,
        StateSnapshot memory latestStateSnapshot,
        bytes memory encodedStateMachineState,
        MessageBlock[] memory inboundMessageBlocks
    ) public virtual;

    function reduce(Dispute[] memory disputes) public view virtual returns (ReduceOutput memory reducedOutput);

    function reduceOutputToSnapshotData(
        bytes32 forkId,
        ReduceOutput memory reducedOutput,
        StateSnapshot memory latestStateSnapshot,
        bytes memory encodedStateMachineState,
        MessageBlock[] memory inboundMessageBlocks
    ) public virtual returns (SnapshotData memory outputSnapshotData, bytes memory, MessageBlock memory);

    function reduceAndFinalize(
        Dispute[] memory disputes,
        StateSnapshot memory stateSnapshot,
        bytes memory encodedStateMachineState,
        MessageBlock[] memory inboundMessageBlocks,
        bytes32 expectedReducedForkId
    ) public virtual;

    // Data provided from the latestStateSnapshot
    function verifyBalanceInvariantCheckSnapshot(
        bytes32 channelId,
        SnapshotData memory snapshotData,
        bytes memory encodedStateMachineState
    ) public virtual returns (bool);

    // ********** routed to FraudProofFacet **********

    function applyFraudProofs(
        FraudProof[] memory fraudProofs,
        FraudProofVerificationContext memory fraudProofVerificationContext
    ) public virtual;

    function hasInvalidTimestamp(InvalidTimestampProof memory proof) public view virtual returns (bool);

    // ********** routed to DisputeFraudProofFacet **********

    function applyDisputeFraudProofs(DisputeFraudProof[] memory proofs) public virtual;

    function validateTimeoutCalldataPostedProof(TimeoutCalldataPosted memory proof, Dispute memory dispute)
        public
        virtual
        returns (bool);

    function isLastMilestoneFinalByEveryone(Dispute memory dispute) public virtual returns (bool isFinal);

    function hasStateProofHeaderMismatch(Dispute memory dispute) public pure virtual returns (bool);

    function isDisputeInboundHashValid(Dispute memory dispute) public view virtual returns (bool);

    // ********** routed to StateSnapshotFacet **********

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

    // ********** routed to JoinChannelFacet **********

    function joinChannel(
        JoinChannelConfirmation memory joinChannelConfirmation,
        bytes32 expectedSnapshotHash,
        bytes32 expectedForkId
    ) public virtual;

    function topUpBalance(
        JoinChannelConfirmation memory joinChannelConfirmation,
        bytes32 expectedSnapshotHash,
        bytes32 expectedForkId
    ) public virtual;

    // ********** routed to StateProofFacet **********

    function verifyStateProof(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        virtual
        returns (bool);

    function isCorrectLatestState(Dispute memory dispute, SnapshotData memory genesisStateSnapshotData)
        public
        view
        virtual
        returns (bool);

    function areSignedBlocksLinkedAndVerified(SignedBlock[] memory signedBlocks) public view virtual returns (bool);

    function isInvalidBlockStructureInStateProof(StateProof memory stateProof, uint256 blockIndex)
        public
        view
        virtual
        returns (bool);

    function findFirstInvalidBlockStructureInStateProof(StateProof memory stateProof)
        public
        view
        virtual
        returns (bool found, uint256 blockIndex);

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
}
