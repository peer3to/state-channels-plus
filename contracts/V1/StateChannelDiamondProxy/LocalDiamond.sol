pragma solidity ^0.8.8;

import "./StateChannelManagerProxy.sol";
import "../types/DataTypes.sol";
import "../types/DisputeTypes.sol";
import "../types/MessageTypeHashes.sol";
import "../StateChannelManagerEvents.sol";
import "./utils/DisputeUtils.sol";
import "./utils/BlockUtils.sol";
import "./utils/GeneralUtils.sol";
import "hardhat/console.sol";

/**
 * @title LocalDiamond
 * @dev Local implementation of the diamond proxy.
 * This contract provides storage sync methods and no-op asset management for local testing.
 *
 */
contract LocalDiamond is StateChannelManagerProxy {
    struct EventCoordinate {
        uint256 blockNumber;
        uint256 logIndex;
    }

    bytes32 private constant CHANNEL_OPENED_FAMILY = keccak256("ChannelOpened");
    bytes32 private constant STATE_SNAPSHOT_FAMILY = keccak256("StateSnapshotUpdated");
    bytes32 private constant INBOUND_MESSAGES_FAMILY = keccak256("InboundMessagesProcessed");
    bytes32 private constant REDUCED_RESULT_FAMILY = keccak256("DisputeReducedResultCommitted");
    bytes32 private constant WITHDRAWALS_FAMILY = keccak256("WithdrawalsUpdated");
    bytes32 private constant STORAGE_CLEARED_FAMILY = keccak256("ChannelStorageCleared");

    mapping(bytes32 => mapping(bytes32 => EventCoordinate)) private latestEventCoordinates;

    constructor(
        address _stateMachineImplementation,
        address _disputeManagerFacet,
        address _disputeVerificationFacet,
        address _fraudProofFacet,
        address _disputeFraudProofFacet,
        address _stateSnapshotFacet,
        address _joinChannelFacet,
        address _stateProofFacet,
        address _utilityFacet,
        uint256 _p2pTime,
        uint256 _agreementTime,
        uint256 _chainFallbackTime,
        uint256 _evidenceTime,
        uint256 _disputeExecutionGasLimit
    )
        StateChannelManagerProxy(
            _stateMachineImplementation,
            _disputeManagerFacet,
            _disputeVerificationFacet,
            _fraudProofFacet,
            _disputeFraudProofFacet,
            _stateSnapshotFacet,
            _joinChannelFacet,
            _stateProofFacet,
            _utilityFacet,
            address(0), // Use 0x00 for consumer facet in local environment
            _p2pTime,
            _agreementTime,
            _chainFallbackTime,
            _evidenceTime,
            _disputeExecutionGasLimit
        )
    {}

    // ========== Direct event handlers for existing events ==========

    function onChannelOpened(
        bytes32 channelId,
        StateSnapshot calldata stateSnapshot,
        bytes calldata, /* encodedState */
        uint256 blockNumber,
        uint256 logIndex
    ) external {
        if (!_acceptEvent(channelId, CHANNEL_OPENED_FAMILY, bytes32(0), blockNumber, logIndex)) return;
        console.log("onChannelOpened");
        // Store the genesis state snapshot
        stateSnapshots[channelId] = stateSnapshot;

        // ChannelOpened follows InboundMessagesProcessed in the open
        // transaction. Keep the finalized genesis deposit total instead of
        // resetting the local mirror back to zero.
        Balance memory zeroBalance = stateMachineImplementation.getZeroBalance();
        ChannelBalance storage channelBalance = channelBalances[channelId];

        channelBalance.totalDeposits = stateSnapshot.snapshotData.totalDeposits;
        channelBalance.totalWithdrawals = zeroBalance;

        bytes32 inboundMessageBlockHash = stateSnapshot.snapshotData.latestInboundMessageBlockHash;
        channelBalance.latestInboundMessageBlockHash = inboundMessageBlockHash;
        channelBalance.latestInboundMessageBlockHeight = stateSnapshot.snapshotData.latestInboundMessageBlockHeight;
        channelBalance.latestOutboundMessageBlockHeight = stateSnapshot.snapshotData.latestOutboundMessageBlockHeight;
    }

    // Called by StateSnapshotUpdated event
    function onStateSnapshotUpdated(
        bytes32 channelId,
        StateSnapshot calldata stateSnapshot,
        uint256 blockNumber,
        uint256 logIndex
    ) external {
        if (!_acceptEvent(channelId, STATE_SNAPSHOT_FAMILY, bytes32(0), blockNumber, logIndex)) return;
        stateSnapshots[channelId] = stateSnapshot;
    }

    // Called by InboundMessagesProcessed event
    function onInboundMessagesProcessed(
        bytes32 channelId,
        MessageBlock calldata messageBlock,
        uint256 blockNumber,
        uint256 logIndex
    ) external {
        if (!_acceptEvent(channelId, INBOUND_MESSAGES_FAMILY, bytes32(0), blockNumber, logIndex)) return;
        bytes32 blockHash = keccak256(abi.encode(messageBlock));
        ChannelBalance storage channelBalance = channelBalances[channelId];
        _persistInboundMessageBlock(channelId, blockHash, messageBlock);
        channelBalance.latestInboundMessageBlockHash = blockHash;
        channelBalance.latestInboundMessageBlockHeight = messageBlock.blockHeight;
        channelBalance.totalDeposits = messageBlock.totalBalance;
    }

    // Called by BlockCalldataPosted event
    function onBlockCalldataPosted(
        bytes32 channelId,
        bytes32 commitmentHash,
        address sender,
        SignedBlock calldata signedBlock,
        uint256 timestamp
    ) external {
        Block memory _block = abi.decode(signedBlock.encodedBlock, (Block));
        blockCalldataCommitments[channelId][sender][_block.transaction.header.forkId][_block
            .transaction
            .header
            .transactionCnt] = commitmentHash;
    }

    // Called by DisputeCommitted event
    function onDisputeCommitted(
        bytes32 channelId,
        Dispute calldata dispute,
        uint256 disputeCreationTimestamp,
        bool isFinal,
        uint256 windowCreationTimestamp
    ) external {
        // Update dispute data based on the dispute commitment
        bytes32 forkId = dispute.input.forkId;
        DisputeWindow storage disputeWindow = disputeData[channelId].disputeWindowMap[forkId];
        bytes32 commitment = keccak256(abi.encode(dispute));

        bytes32[] storage commitments = disputeWindow.evidence.disputeCommitments;
        for (uint256 i = 0; i < commitments.length; i++) {
            if (commitments[i] == commitment) return;
        }

        // Update dispute data only after duplicate delivery has been excluded.
        disputeWindow.forkId = forkId;
        disputeWindow.evidence.creationTimestamp = windowCreationTimestamp;
        // Set lastEvidenceSubmissionTimestamp based on whether this is a threshold final dispute
        // If final: windowCreationTimestamp (which equals block.timestamp - getEvidenceTime())
        // If not final: disputeCreationTimestamp (which equals block.timestamp)
        disputeWindow.evidence.lastEvidenceSubmissionTimestamp =
            isFinal ? windowCreationTimestamp : disputeCreationTimestamp;
        disputeWindow.evidence.hasPosted.push(dispute.input.disputer);

        // Handle reduced result if this is a final/threshold dispute
        if (isFinal) {
            disputeWindow.reducedResult.forkId = dispute.outputSnapshotDataHash;
            disputeWindow.reducedResult.timestamp = disputeCreationTimestamp;
            disputeWindow.reducedResult.reducer = dispute.input.disputer;

            // When final, clear all previous commitments then add the final one
            delete disputeData[channelId].disputeWindowMap[forkId].evidence.disputeCommitments;
        }

        commitments.push(commitment);
    }

    // Simple event handlers
    function onOnChainSlashAdded(bytes32 channelId, address participant, uint256 timestamp) external {
        OnChainSlash[] storage slashes = disputeData[channelId].onChainSlashes;
        for (uint256 i = 0; i < slashes.length; i++) {
            if (slashes[i].participant == participant) return;
        }
        disputeData[channelId].onChainSlashes.push(OnChainSlash(participant, timestamp));
    }

    function onDisputeKilled(
        bytes32 channelId,
        bytes32 forkId,
        address,
        /*disputer*/
        bytes32 disputeHash
    ) external {
        DisputeWindow storage disputeWindow = disputeData[channelId].disputeWindowMap[forkId];
        bytes32[] storage commitments = disputeWindow.evidence.disputeCommitments;

        for (uint256 i = 0; i < commitments.length; i++) {
            if (commitments[i] == disputeHash) {
                commitments[i] = commitments[commitments.length - 1];
                commitments.pop();
                break;
            }
        }
    }

    function onDisputeReducedResultCommitted(
        bytes32 channelId,
        bytes32 forkId,
        bytes32 reducedForkId,
        uint256 reductionTimestamp,
        address reducer,
        uint256 blockNumber,
        uint256 logIndex
    ) external {
        if (!_acceptEvent(channelId, REDUCED_RESULT_FAMILY, forkId, blockNumber, logIndex)) return;
        // Update the reduced result in the dispute window
        disputeData[channelId].disputeWindowMap[forkId].reducedResult.forkId = reducedForkId;
        disputeData[channelId].disputeWindowMap[forkId].reducedResult.timestamp = reductionTimestamp;
        disputeData[channelId].disputeWindowMap[forkId].reducedResult.reducer = reducer;
    }

    function onWithdrawalsUpdated(
        bytes32 channelId,
        Balance calldata totalWithdrawals,
        uint256 blockNumber,
        uint256 logIndex
    ) external {
        if (!_acceptEvent(channelId, WITHDRAWALS_FAMILY, bytes32(0), blockNumber, logIndex)) return;
        channelBalances[channelId].totalWithdrawals = totalWithdrawals;
    }

    function onChannelStorageCleared(
        bytes32 channelId,
        bytes32 latestInboundMessageBlockHash,
        uint256 blockNumber,
        uint256 logIndex
    ) external {
        if (!_acceptEvent(channelId, STORAGE_CLEARED_FAMILY, bytes32(0), blockNumber, logIndex)) return;
        // Clear dispute data
        DisputeData storage disputeData = disputeData[channelId];
        delete disputeData.onChainSlashes;
        mapping(bytes32 => DisputeWindow) storage disputeWindowMap = disputeData.disputeWindowMap;
        for (uint256 i = 0; i < disputeData.disputedForks.length; i++) {
            delete disputeWindowMap[disputeData.disputedForks[i]];
        }
        delete disputeData.disputedForks;

        // Clear old inbound message blocks (prune the snapshot head too)
        bytes32 keyToDelete = latestInboundMessageBlockHash;
        while (keyToDelete != bytes32(0)) {
            bytes32 nextKeyToDelete = inboundMessageBlockMap[channelId][keyToDelete].previousBlockHash;
            delete inboundMessageBlockMap[channelId][keyToDelete];
            keyToDelete = nextKeyToDelete;
        }
    }

    function _acceptEvent(bytes32 channelId, bytes32 family, bytes32 scope, uint256 blockNumber, uint256 logIndex)
        private
        returns (bool)
    {
        // (0, 0) is a trusted local reconciliation, not an observed event.
        // Apply it unconditionally without changing the latest real event
        // coordinate used for ordering and deduplication.
        if (blockNumber == 0 && logIndex == 0) return true;

        bytes32 key = keccak256(abi.encode(family, scope));
        EventCoordinate storage latest = latestEventCoordinates[channelId][key];
        if (blockNumber < latest.blockNumber || (blockNumber == latest.blockNumber && logIndex <= latest.logIndex)) {
            return false;
        }
        latest.blockNumber = blockNumber;
        latest.logIndex = logIndex;
        return true;
    }

    function persistDisputeWindow(bytes32 channelId, DisputeWindow memory disputeWindow) public {
        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage _disputeWindow = _disputeData.disputeWindowMap[disputeWindow.forkId];

        _disputeWindow.forkId = disputeWindow.forkId;
        _disputeWindow.evidence.creationTimestamp = disputeWindow.evidence.creationTimestamp;
        _disputeWindow.evidence.lastEvidenceSubmissionTimestamp = disputeWindow.evidence.lastEvidenceSubmissionTimestamp;

        delete _disputeWindow.evidence.disputeCommitments;
        delete _disputeWindow.evidence.hasPosted;
        for (uint256 i = 0; i < disputeWindow.evidence.disputeCommitments.length; i++) {
            _disputeWindow.evidence.disputeCommitments.push(disputeWindow.evidence.disputeCommitments[i]);
            _disputeWindow.evidence.hasPosted.push(disputeWindow.evidence.hasPosted[i]);
        }

        _disputeWindow.reducedResult.forkId = disputeWindow.reducedResult.forkId;
        _disputeWindow.reducedResult.timestamp = disputeWindow.reducedResult.timestamp;
        _disputeWindow.reducedResult.reducer = disputeWindow.reducedResult.reducer;
    }

    function getLatestJoinChannelBlockHash(bytes32 channelId) public view returns (bytes32) {
        return channelBalances[channelId].latestInboundMessageBlockHash;
    }

    function getTotalDeposits(bytes32 channelId) public view returns (Balance memory) {
        return channelBalances[channelId].totalDeposits;
    }

    function computeDisputeOutputSnapshotData(
        DisputeInput memory disputeInput,
        StateSnapshot memory latestStateSnapshot,
        bytes memory latestStateMachineState,
        MessageBlock[] memory inboundMessageBlocks
    ) public returns (SnapshotData memory outputSnapshotData) {
        // Encode the function selector and arguments
        bytes memory data = abi.encodeCall(
            DisputeVerificationFacet.computeDisputeOutputSnapshotData,
            (disputeInput, latestStateSnapshot, latestStateMachineState, inboundMessageBlocks)
        );

        // Perform the low-level call with a gas limit
        (bool success, bytes memory returnData) = disputeVerificationFacetAddress.delegatecall{gas: _getGasLimit()}(data);

        if (!success) {
            assembly ("memory-safe") {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }

        outputSnapshotData = abi.decode(returnData, (SnapshotData));
    }

    function computeDisputeOutputState(
        DisputeInput memory disputeInput,
        StateSnapshot memory latestStateSnapshot,
        bytes memory latestStateMachineState,
        MessageBlock[] memory inboundMessageBlocks
    ) public returns (DisputeOutputState memory outputState) {
        bytes memory data = abi.encodeCall(
            DisputeVerificationFacet.computeDisputeOutputState,
            (disputeInput, latestStateSnapshot, latestStateMachineState, inboundMessageBlocks)
        );

        (bool success, bytes memory returnData) = disputeVerificationFacetAddress.delegatecall{gas: _getGasLimit()}(data);

        if (!success) {
            assembly ("memory-safe") {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }

        outputState = abi.decode(returnData, (DisputeOutputState));
    }

    function checkDisputeAuditingDataCommitment(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        view
        returns (bool)
    {
        // The underlying function is pure, so no need for a delegatecall
        return DisputeVerificationFacet(disputeVerificationFacetAddress).checkDisputeAuditingDataCommitment(
            dispute, disputeAuditingData
        );
    }

    function isBlockAuthorParticipant(
        Block memory _block,
        StateSnapshot memory previousSnapshot,
        StateSnapshot memory resultingSnapshot
    ) public pure returns (bool) {
        return _isBlockAuthorParticipant(_block, previousSnapshot, resultingSnapshot);
    }

    // function isCorrectAuditingData(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
    //     public
    //     view
    //     returns (bool)
    // {
    //     // The underlying function is pure, so no need for a delegatecall
    //     return
    //         DisputeVerificationFacet(disputeVerificationFacetAddress)
    //             .isCorrectAuditingData(dispute, disputeAuditingData);
    // }

    function isDisputeOutputCorrect(
        Dispute memory dispute,
        StateSnapshot memory latestStateSnapshot,
        bytes memory latestFinalizedStateStateMachineState,
        MessageBlock[] memory inboundMessageBlocks
    ) public returns (bool) {
        // Encode the function selector and arguments
        bytes memory data = abi.encodeCall(
            DisputeVerificationFacet.isDisputeOutputCorrect,
            (dispute, latestStateSnapshot, latestFinalizedStateStateMachineState, inboundMessageBlocks)
        );
        // Perform the low-level call with a gas limit
        (bool success, bytes memory returnData) = disputeVerificationFacetAddress.delegatecall{gas: _getGasLimit()}(data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
        return abi.decode(returnData, (bool));
    }

    function getLatestBlockFromStateProof(StateProof memory stateProof)
        public
        pure
        returns (bool hasBlock, Block memory)
    {
        return _getLatestBlock(stateProof);
    }

    function hasDisputeReason(DisputeInput memory input, StateSnapshot memory latestStateSnapshot)
        public
        pure
        returns (bool)
    {
        return _hasDisputeReason(input, latestStateSnapshot);
    }

    function isDisputeInboundAnchorBehindLatestState(Dispute memory dispute, StateSnapshot memory latestStateSnapshot)
        public
        pure
        returns (bool)
    {
        return _isDisputeInboundAnchorBehindLatestState(dispute, latestStateSnapshot);
    }

    function getUnfinalizedBlockConfirmationsFromStateProof(StateProof memory stateProof)
        public
        pure
        returns (BlockConfirmation[] memory)
    {
        return _getUnfinalizedBlockConfirmationsFromStateProof(stateProof);
    }

    // ========== Override for debugging - Browser compatible console logs ==========

    function _isBlockAuthentic(SignedBlock memory _block) internal view override returns (bool) {
        (bool decoded, Block memory decodedBlock) =
            UtilityFacet(utilityFacetAddress).tryDecodeBlock(_block.encodedBlock);
        if (!decoded) {
            console.log("isBlockAuthentic - false - 1");
            return false;
        }
        (address signer, bool isValid) =
            UtilityFacet(utilityFacetAddress).retrieveSignerAddress(_block.encodedBlock, _block.signature);
        if (signer != decodedBlock.transaction.header.participant || !isValid) {
            console.log("isBlockAuthentic - false - 2");
            return false;
        }
        return true;
    }
}
