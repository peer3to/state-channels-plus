pragma solidity ^0.8.8;

import "./StateChannelManagerProxy.sol";
import "../types/DataTypes.sol";
import "../types/DisputeTypes.sol";
import "../StateChannelManagerEvents.sol";

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
        killTime = 10;
    }

    // ========== Direct event handlers for existing events ==========

    // Called by StateSnapshotUpdated event
    function onStateSnapshotUpdated(bytes32 channelId, StateSnapshot calldata stateSnapshot, uint256 timestamp)
        external
    {
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
        bytes32 forkId = keccak256(abi.encode(dispute.input.genesisSnapshotDataHash));
        disputeData[channelId].disputeWindowMap[forkId].forkId = forkId;
        disputeData[channelId].disputeWindowMap[forkId].evidence.creationTimestamp = windowCreationTimestamp;
        disputeData[channelId].disputeWindowMap[forkId].evidence.hasPosted[dispute.input.disputer] = true;

        bytes32 commitment = keccak256(abi.encode(dispute));
        disputeData[channelId].disputeWindowMap[forkId].evidence.disputeCommitments.push(commitment);

        // Handle reduced result if this is a final/threshold dispute
        if (isFinal) {
            disputeData[channelId].disputeWindowMap[forkId].reducedResult.forkId = dispute.outputSnapshotDataHash;
            disputeData[channelId].disputeWindowMap[forkId].reducedResult.timestamp = disputeCreationTimestamp;
            disputeData[channelId].disputeWindowMap[forkId].reducedResult.forkGenesisTimestamp =
                disputeCreationTimestamp;
            disputeData[channelId].disputeWindowMap[forkId].reducedResult.reducer = dispute.input.disputer;

            // Clear dispute commitments (matches on-chain behavior)
            delete disputeData[channelId].disputeWindowMap[forkId].evidence.disputeCommitments;
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
        uint256 forkGenesisTimestamp,
        address reducer
    ) external {
        // Update the reduced result in the dispute window
        disputeData[channelId].disputeWindowMap[forkId].reducedResult.forkId = reducedForkId;
        disputeData[channelId].disputeWindowMap[forkId].reducedResult.forkGenesisTimestamp = forkGenesisTimestamp;
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
        (bool success, bytes memory returnData) =
            address(disputeVerificationFacet).delegatecall{gas: getGasLimit()}(data);
        if (!success) {
            assembly {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
        (outputSnapshotData,) = abi.decode(returnData, (SnapshotData, address[]));
    }
}
