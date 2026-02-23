pragma solidity ^0.8.8;

import "./StateChannelManagerProxy.sol";
import "../types/DataTypes.sol";
import "../types/DisputeTypes.sol";
import "../types/MessageTypeHashes.sol";
import "../StateChannelManagerEvents.sol";
import "./utils/DisputeUtils.sol";
import "hardhat/console.sol";

/**
 * @title LocalDiamond
 * @dev Local implementation of the diamond proxy.
 * This contract provides storage sync methods and no-op asset management for local testing.
 *
 */
contract LocalDiamond is StateChannelManagerProxy {
    constructor(
        address _stateMachineImplementation,
        address _disputeManagerFacet,
        address _disputeVerificationFacet,
        address _fraudProofFacet,
        address _disputeFraudProofFacet,
        address _stateSnapshotFacet,
        address _joinChannelFacet,
        address _utilityFacet,
        uint256 _p2pTime,
        uint256 _agreementTime,
        uint256 _chainFallbackTime,
        uint256 _evidenceTime
    )
        StateChannelManagerProxy(
            _stateMachineImplementation,
            _disputeManagerFacet,
            _disputeVerificationFacet,
            _fraudProofFacet,
            _disputeFraudProofFacet,
            _stateSnapshotFacet,
            _joinChannelFacet,
            _utilityFacet,
            address(0), // Use 0x00 for consumer facet in local environment
            _p2pTime,
            _agreementTime,
            _chainFallbackTime,
            _evidenceTime
        )
    {}

    // ========== Direct event handlers for existing events ==========

    function onChannelOpened(
        bytes32 channelId,
        StateSnapshot calldata stateSnapshot,
        bytes calldata /* encodedState */
    )
        external
    {
        console.log("onChannelOpened");
        // Store the genesis state snapshot
        stateSnapshots[channelId] = stateSnapshot;

        // Initialize channel balance with zero values
        Balance memory zeroBalance = stateMachineImplementation.getZeroBalance();
        ChannelBalance storage channelBalance = channelBalances[channelId];

        channelBalance.totalDeposits = zeroBalance;
        channelBalance.totalWithdrawals = zeroBalance;

        bytes32 inboundMessageBlockHash = stateSnapshot.snapshotData.latestInboundMessageBlockHash;
        channelBalance.latestInboundMessageBlockHash = inboundMessageBlockHash;
        channelBalance.latestInboundMessageBlockHeight = stateSnapshot.snapshotData.latestInboundMessageBlockHeight;
        channelBalance.latestOutboundMessageBlockHeight = stateSnapshot.snapshotData.latestOutboundMessageBlockHeight;
        if (inboundMessageBlockHash != bytes32(0)) {
            MessageBlock memory snapshotInboundBlock;
            snapshotInboundBlock.previousBlockHash = bytes32(0);
            snapshotInboundBlock.blockHeight = stateSnapshot.snapshotData.latestInboundMessageBlockHeight;
            snapshotInboundBlock.totalBalance = stateSnapshot.snapshotData.totalDeposits;
            snapshotInboundBlock.timestamp = stateSnapshot.timestamp;
        }
    }

    // Called by StateSnapshotUpdated event
    function onStateSnapshotUpdated(bytes32 channelId, StateSnapshot calldata stateSnapshot) external {
        stateSnapshots[channelId] = stateSnapshot;
    }

    // Called by InboundMessagesProcessed event
    function onInboundMessagesProcessed(bytes32 channelId, MessageBlock calldata messageBlock) external {
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
        blockCalldataCommitments[
            channelId
        ][sender][_block.transaction.header.forkId][_block.transaction.header.transactionCnt] = commitmentHash;
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
        disputeWindow.forkId = forkId;
        disputeWindow.evidence.creationTimestamp = windowCreationTimestamp;
        // Set lastEvidenceSubmissionTimestamp based on whether this is a threshold final dispute
        // If final: windowCreationTimestamp (which equals block.timestamp - getEvidenceTime())
        // If not final: disputeCreationTimestamp (which equals block.timestamp)
        disputeWindow.evidence.lastEvidenceSubmissionTimestamp =
            isFinal ? windowCreationTimestamp : disputeCreationTimestamp;
        disputeWindow.evidence.hasPosted.push(dispute.input.disputer);

        bytes32 commitment = keccak256(abi.encode(dispute));

        // Handle reduced result if this is a final/threshold dispute
        if (isFinal) {
            disputeWindow.reducedResult.forkId = dispute.outputSnapshotDataHash;
            disputeWindow.reducedResult.timestamp = disputeCreationTimestamp;
            disputeWindow.reducedResult.reducer = dispute.input.disputer;

            // When final, clear all previous commitments then add the final one
            delete disputeData[channelId].disputeWindowMap[forkId].evidence.disputeCommitments;
        }

        disputeWindow.evidence.disputeCommitments.push(commitment);
    }

    // Simple event handlers
    function onOnChainSlashAdded(bytes32 channelId, address participant, uint256 timestamp) external {
        disputeData[channelId].onChainSlashes.push(OnChainSlash(participant, timestamp));
    }

    function onDisputeKilled(
        bytes32 channelId,
        bytes32 forkId,
        address,
        /*disputer*/
        bytes32 disputeHash
    )
        external
    {
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
        address reducer
    ) external {
        // Update the reduced result in the dispute window
        disputeData[channelId].disputeWindowMap[forkId].reducedResult.forkId = reducedForkId;
        disputeData[channelId].disputeWindowMap[forkId].reducedResult.timestamp = reductionTimestamp;
        disputeData[channelId].disputeWindowMap[forkId].reducedResult.reducer = reducer;
    }

    function onWithdrawalsUpdated(bytes32 channelId, Balance calldata totalWithdrawals) external {
        channelBalances[channelId].totalWithdrawals = totalWithdrawals;
    }

    function onChannelStorageCleared(bytes32 channelId, bytes32 latestInboundMessageBlockHash) external {
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
        (bool success, bytes memory returnData) = disputeVerificationFacetAddress.delegatecall{gas: getGasLimit()}(data);

        if (!success) {
            assembly ("memory-safe") {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }

        outputSnapshotData = abi.decode(returnData, (SnapshotData));
    }

    function checkDisputeAuditingDataCommitment(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        view
        returns (bool)
    {
        // The underlying function is pure, so no need for a delegatecall
        return DisputeVerificationFacet(disputeVerificationFacetAddress)
            .checkDisputeAuditingDataCommitment(dispute, disputeAuditingData);
    }

    function isCorrectAuditingData(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        view
        returns (bool)
    {
        // The underlying function is pure, so no need for a delegatecall
        return
            DisputeVerificationFacet(disputeVerificationFacetAddress)
                .isCorrectAuditingData(dispute, disputeAuditingData);
    }

    function isDisputeOutputCorrect(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        returns (bool)
    {
        // Encode the function selector and arguments
        bytes memory data =
            abi.encodeCall(DisputeVerificationFacet.isDisputeOutputCorrect, (dispute, disputeAuditingData));
        // Perform the low-level call with a gas limit
        (bool success, bytes memory returnData) = disputeVerificationFacetAddress.delegatecall{gas: getGasLimit()}(data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
        return abi.decode(returnData, (bool));
    }

    function verifyStateProof(
        Dispute memory dispute,
        DisputeAuditingData memory disputeAuditingData,
        bool auditingDataIntegrityVerified
    ) public view returns (bool) {
        // The underlying function is pure, so no need for a delegatecall
        return
            UtilityFacet(utilityFacetAddress)
                .verifyStateProof(dispute, disputeAuditingData, auditingDataIntegrityVerified);
    }

    function verifyMilestones(
        bytes32 forkId,
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        SnapshotData memory genesisSnapshotData
    ) public view returns (bool isValid, bytes memory lastBlockEncoded) {
        return UtilityFacet(utilityFacetAddress)
            .verifyMilestones(forkId, milestoneProofs, milestoneSnapshots, genesisSnapshotData);
    }

    function getLatestBlockFromStateProof(StateProof memory stateProof)
        public
        pure
        returns (bool hasBlock, Block memory)
    {
        return _getLatestBlock(stateProof);
    }

    function isGenesisSnapshotWithoutTimeCheck(StateSnapshot memory snapshot) public view returns (bool) {
        return UtilityFacet(utilityFacetAddress).isGenesisSnapshotWithoutTimeCheck(snapshot);
    }

    function getUnfinalizedBlockConfirmationsFromStateProof(StateProof memory stateProof)
        public
        pure
        returns (BlockConfirmation[] memory)
    {
        return _getUnfinalizedBlockConfirmationsFromStateProof(stateProof);
    }

    // ========== Override for debugging - Browser compatible console logs ==========

    function isBlockAuthentic(SignedBlock memory _block) public view override returns (bool) {
        // try decode block
        bytes memory data = abi.encodeCall(this.decodeBlock, (_block.encodedBlock));
        (bool success, bytes memory encodedBlock) = address(this).staticcall(data);
        if (!success) {
            console.log("isBlockAuthentic - false - 1");
            return false;
        }
        Block memory decodedBlock = abi.decode(encodedBlock, (Block));
        (address signer, bool isValid) =
            UtilityFacet(utilityFacetAddress).retrieveSignerAddress(encodedBlock, _block.signature);
        if (signer != decodedBlock.transaction.header.participant || !isValid) {
            console.log("isBlockAuthentic - false - 2");
            return false;
        }
        return true;
    }
}
