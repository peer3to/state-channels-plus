pragma solidity ^0.8.8;

import "./StateChannelManagerProxy.sol";
import "../types/DataTypes.sol";
import "../types/DisputeTypes.sol";
import "../StateChannelManagerEvents.sol";
import "./utils/DisputeUtils.sol";

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
        address _joinChannelFacet
    )
        StateChannelManagerProxy(
            _stateMachineImplementation,
            _disputeManagerFacet,
            _disputeVerificationFacet,
            _fraudProofFacet,
            _disputeFraudProofFacet,
            _stateSnapshotFacet,
            _joinChannelFacet,
            address(0) // Use 0x00 for consumer facet in local environment
        )
    {
        p2pTime = 5;
        agreementTime = 5;
        chainFallbackTime = 5;
        evidenceTime = 5;
    }

    // ========== Direct event handlers for existing events ==========

    // Called by StateSnapshotUpdated event
    function onStateSnapshotUpdated(bytes32 channelId, StateSnapshot calldata stateSnapshot) external {
        stateSnapshots[channelId] = stateSnapshot;
    }

    // Called by JoinChannelProcessed event
    function onJoinChannelProcessed(
        bytes32 channelId,
        JoinChannelBlock calldata joinChannelBlock,
        uint256 timestamp,
        Balance calldata totalDeposits
    ) external {
        // Extract the join channel data and update storage
        bytes32 blockHash = keccak256(abi.encode(joinChannelBlock));
        channelBalances[channelId].onChainJoinChannelMap[blockHash] = OnChainJoinChannel({
            previousJoinChannelBlockHash: channelBalances[channelId].latestJoinChannelBlockHash,
            timestamp: timestamp,
            totalDeposits: totalDeposits
        });
        channelBalances[channelId].latestJoinChannelBlockHash = blockHash;

        // Add participants to pending participants
        for (uint256 i = 0; i < joinChannelBlock.joinChannels.length; i++) {
            disputeData[channelId].pendingParticipants.push(joinChannelBlock.joinChannels[i].participant);
        }
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
        bytes32 forkId = dispute.input.genesisSnapshotDataHash;
        disputeData[channelId].disputeWindowMap[forkId].forkId = forkId;
        disputeData[channelId].disputeWindowMap[forkId].evidence.creationTimestamp = windowCreationTimestamp;
        disputeData[channelId].disputeWindowMap[forkId].evidence.hasPosted.push(dispute.input.disputer);

        bytes32 commitment = keccak256(abi.encode(dispute));
        disputeData[channelId].disputeWindowMap[forkId].evidence.disputeCommitments.push(commitment);

        // Handle reduced result if this is a final/threshold dispute
        if (isFinal) {
            disputeData[channelId].disputeWindowMap[forkId].reducedResult.forkId = dispute.outputSnapshotDataHash;
            disputeData[channelId].disputeWindowMap[forkId].reducedResult.timestamp = disputeCreationTimestamp;
            disputeData[channelId].disputeWindowMap[forkId].reducedResult.reducer = dispute.input.disputer;

            // Clear dispute commitments (matches on-chain behavior)
            delete disputeData[channelId]
                .disputeWindowMap[forkId]
                .evidence
                .disputeCommitments;
        }
    }

    // Simple event handlers
    function onOnChainSlashAdded(bytes32 channelId, address participant, uint256 timestamp) external {
        disputeData[channelId].onChainSlashes.push(OnChainSlash(participant, timestamp));
    }

    function onDisputeKilled(bytes32 channelId, bytes32 forkId, address disputer) external {
        // Remove dispute window and disputed fork (matches on-chain behavior)
        delete disputeData[channelId].disputeWindowMap[forkId];

        // Remove from disputed forks array
        bytes32[] storage disputedForks = disputeData[channelId].disputedForks;
        for (uint256 i = 0; i < disputedForks.length; i++) {
            if (disputedForks[i] == forkId) {
                disputedForks[i] = disputedForks[disputedForks.length - 1];
                disputedForks.pop();
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
        channelBalances[channelId].totalOnChainWithdrawals = totalWithdrawals;
    }

    function onChannelStorageCleared(bytes32 channelId, bytes32 latestJoinChannelBlockHash) external {
        // Clear dispute data
        DisputeData storage disputeData = disputeData[channelId];
        delete disputeData.onChainSlashes;
        delete disputeData.pendingParticipants;
        mapping(bytes32 => DisputeWindow) storage disputeWindowMap = disputeData.disputeWindowMap;
        for (uint256 i = 0; i < disputeData.disputedForks.length; i++) {
            delete disputeWindowMap[disputeData.disputedForks[i]];
        }
        delete disputeData.disputedForks;

        // Clear old join channels
        ChannelBalance storage cb = channelBalances[channelId];
        bytes32 keyToDelete = cb.onChainJoinChannelMap[latestJoinChannelBlockHash].previousJoinChannelBlockHash;
        while (keyToDelete != bytes32(0)) {
            bytes32 nextKeyToDelete = cb.onChainJoinChannelMap[keyToDelete].previousJoinChannelBlockHash;
            delete cb.onChainJoinChannelMap[keyToDelete];
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
        return channelBalances[channelId].latestJoinChannelBlockHash;
    }

    function getTotalDeposits(bytes32 channelId) public view returns (Balance memory) {
        bytes32 latestJoinChannelBlockHash = channelBalances[channelId].latestJoinChannelBlockHash;
        return channelBalances[channelId].onChainJoinChannelMap[latestJoinChannelBlockHash].totalDeposits;
    }

    function computeDisputeOutputSnapshotData(
        DisputeInput memory disputeInput,
        StateSnapshot memory latestStateSnapshot,
        bytes memory latestStateMachineState,
        bytes32 latestJoinChannelBlockHash
    ) public returns (SnapshotData memory outputSnapshotData) {
        // Encode the function selector and arguments
        bytes memory data = abi.encodeCall(
            DisputeVerificationFacet.computeDisputeOutputSnapshotData,
            (disputeInput, latestStateSnapshot, latestStateMachineState, latestJoinChannelBlockHash)
        );
        // Perform the low-level call with a gas limit
        (bool success, bytes memory returnData) = disputeVerificationFacetAddress.delegatecall{gas: getGasLimit()}(data);
        if (!success) {
            assembly {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
        (outputSnapshotData,) = abi.decode(returnData, (SnapshotData, address[]));
    }

    function reduceOutputToSnapshotData(
        bytes32 forkId,
        ReduceOutput memory reducedOutput,
        StateSnapshot memory latestStateSnapshot,
        bytes memory latestStateMachineState,
        JoinChannelBlock[] memory joinChannelBlocks
    ) public returns (SnapshotData memory outputSnapshotData) {
        bytes memory data = abi.encodeCall(
            DisputeVerificationFacet.reduceOutputToSnapshotData,
            (forkId, reducedOutput, latestStateSnapshot, latestStateMachineState, joinChannelBlocks)
        );
        (bool success, bytes memory returnData) = disputeVerificationFacetAddress.delegatecall(data);
        if (!success) {
            assembly {
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
        return DisputeVerificationFacet(disputeVerificationFacetAddress).checkDisputeAuditingDataCommitment(
            dispute, disputeAuditingData
        );
    }

    function isCorrectAuditingData(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        view
        returns (bool)
    {
        // The underlying function is pure, so no need for a delegatecall
        return DisputeVerificationFacet(disputeVerificationFacetAddress).isCorrectAuditingData(
            dispute, disputeAuditingData
        );
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
            assembly {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
        return abi.decode(returnData, (bool));
    }

    function verifyBalanceInvariantCheckView(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        view
        returns (bool)
    {
        bytes32 channelId = dispute.input.channelId;
        SnapshotData memory latestSnapshotData = disputeAuditingData.latestStateSnapshot.snapshotData;
        Balance memory totalDeposits = latestSnapshotData.totalDeposits;
        Balance memory totalWithdrawals = latestSnapshotData.totalWithdrawals;
        bytes32 latestJoinChannelBlockHash = latestSnapshotData.latestJoinChannelBlockHash;
        // Trick the compiler and ethers for the localEvm - delegatecall in view functions
        return DisputeVerificationFacet(address(this)).verifyBalanceInvariantCheck(
            channelId, totalDeposits, totalWithdrawals, latestJoinChannelBlockHash
        );
    }

    // Data provided from the latestStateSnapshot
    function verifyBalanceInvariantCheck(
        bytes32 channelId,
        Balance memory totalDeposits,
        Balance memory totalWithdrawals,
        bytes32 latestJoinChannelBlockHash
    ) public returns (bool) {
        // Encode the function selector and arguments
        bytes memory data = abi.encodeCall(
            DisputeVerificationFacet.verifyBalanceInvariantCheck,
            (channelId, totalDeposits, totalWithdrawals, latestJoinChannelBlockHash)
        );
        // Perform the low-level call with a gas limit
        (bool success, bytes memory returnData) = disputeVerificationFacetAddress.delegatecall(data);
        if (!success) {
            assembly {
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
        return DisputeVerificationFacet(disputeVerificationFacetAddress).verifyStateProof(
            dispute, disputeAuditingData, auditingDataIntegrityVerified
        );
    }

    function getLatestBlockFromStateProof(StateProof memory stateProof)
        public
        pure
        returns (bool hasBlock, Block memory)
    {
        return _getLatestBlock(stateProof);
    }
}
