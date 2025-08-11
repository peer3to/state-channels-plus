pragma solidity ^0.8.8;

import "./StateChannelManagerProxy.sol";
import "../types/DataTypes.sol";
import "../types/DisputeTypes.sol";

/**
 * @title LocalDiamond
 * @dev Local implementation of the diamond proxy.
 * This contract provides storage sync methods and no-op asset management for local testing.
 *
 */
contract LocalDiamond is StateChannelManagerProxy {
    // Events for storage sync
    event StorageSet(bytes32 indexed slot, bytes32 value);
    event StorageGet(bytes32 indexed slot, bytes32 value);

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

    // ========== Storage slot management (existing) ==========
    function setStorageSlot(bytes32 slot, bytes32 value) external {
        assembly {
            sstore(slot, value)
        }
        emit StorageSet(slot, value);
    }

    function getStorageSlot(bytes32 slot) external view returns (bytes32) {
        bytes32 value;
        assembly {
            value := sload(slot)
        }
        return value;
    }

    function setStorageSlots(bytes32[] calldata slots, bytes32[] calldata values) external {
        require(slots.length == values.length, "LocalDiamond: slots and values arrays must have same length");

        for (uint256 i = 0; i < slots.length; i++) {
            bytes32 slot = slots[i];
            bytes32 value = values[i];
            assembly {
                sstore(slot, value)
            }
            emit StorageSet(slot, value);
        }
    }

    function getStorageSlots(bytes32[] calldata slots) external view returns (bytes32[] memory) {
        bytes32[] memory values = new bytes32[](slots.length);

        for (uint256 i = 0; i < slots.length; i++) {
            bytes32 slot = slots[i];
            bytes32 value;
            assembly {
                value := sload(slot)
            }
            values[i] = value;
        }

        return values;
    }

    // ========== Typed setters for event mirroring ==========

    function setChannelSnapshot(bytes32 channelId, StateSnapshot calldata stateSnapshot) external {
        stateSnapshots[channelId] = stateSnapshot;
    }

    function setBlockCalldataCommitment(
        bytes32 channelId,
        address participant,
        bytes32 forkId,
        uint256 blockHeight,
        bytes32 commitment
    ) external {
        blockCalldataCommitments[channelId][participant][forkId][blockHeight] = commitment;
    }

    function setOnChainJoinChannel(bytes32 channelId, bytes32 blockHash, OnChainJoinChannel calldata value) external {
        channelBalances[channelId].onChainJoinChannelMap[blockHash] = value;
    }

    function deleteOnChainJoinChannel(bytes32 channelId, bytes32 blockHash) external {
        delete channelBalances[channelId].onChainJoinChannelMap[blockHash];
    }

    function setLatestJoinChannelBlockHash(bytes32 channelId, bytes32 blockHash) external {
        channelBalances[channelId].latestJoinChannelBlockHash = blockHash;
    }

    function setTotalOnChainWithdrawals(bytes32 channelId, Balance calldata balance) external {
        channelBalances[channelId].totalOnChainWithdrawals = balance;
    }

    function addPendingParticipant(bytes32 channelId, address participant) external {
        disputeData[channelId].pendingParticipants.push(participant);
    }

    function createDisputeWindow(bytes32 channelId, bytes32 forkId, uint256 creationTimestamp) external {
        disputeData[channelId].disputeWindowMap[forkId].forkId = forkId;
        disputeData[channelId].disputeWindowMap[forkId].evidence.creationTimestamp = creationTimestamp;
    }

    function setDisputeWindowCreationTimestamp(bytes32 channelId, bytes32 forkId, uint256 creationTimestamp) external {
        disputeData[channelId].disputeWindowMap[forkId].evidence.creationTimestamp = creationTimestamp;
    }

    function clearDisputeCommitments(bytes32 channelId, bytes32 forkId) external {
        delete disputeData[channelId].disputeWindowMap[forkId].evidence.disputeCommitments;
    }

    function pushDisputeCommitment(bytes32 channelId, bytes32 forkId, bytes32 commitment) external {
        disputeData[channelId].disputeWindowMap[forkId].evidence.disputeCommitments.push(commitment);
    }

    function removeDisputeCommitment(bytes32 channelId, bytes32 forkId, uint256 index) external {
        bytes32[] storage commitments = disputeData[channelId].disputeWindowMap[forkId].evidence.disputeCommitments;
        require(index < commitments.length, "LocalDiamond: commitment index out of bounds");

        // Move last element to index and pop
        commitments[index] = commitments[commitments.length - 1];
        commitments.pop();
    }

    function setHasPosted(bytes32 channelId, bytes32 forkId, address participant, bool hasPosted) external {
        disputeData[channelId].disputeWindowMap[forkId].evidence.hasPosted[participant] = hasPosted;
    }

    function deleteDisputeWindow(bytes32 channelId, bytes32 forkId) external {
        delete disputeData[channelId].disputeWindowMap[forkId];
    }

    function commitReducedResult(
        bytes32 channelId,
        bytes32 disputedForkId,
        bytes32 reducedForkId,
        uint256 reductionTimestamp,
        uint256 forkGenesisTimestamp,
        address reducer
    ) external {
        disputeData[channelId].disputeWindowMap[disputedForkId].reducedResult.forkId = reducedForkId;
        disputeData[channelId].disputeWindowMap[disputedForkId].reducedResult.timestamp = reductionTimestamp;
        disputeData[channelId].disputeWindowMap[disputedForkId].reducedResult.forkGenesisTimestamp =
            forkGenesisTimestamp;
        disputeData[channelId].disputeWindowMap[disputedForkId].reducedResult.reducer = reducer;
    }

    function clearReducedResultForkId(bytes32 channelId, bytes32 disputedForkId) external {
        delete disputeData[channelId].disputeWindowMap[disputedForkId].reducedResult;
    }

    function removeDisputedFork(bytes32 channelId, bytes32 forkId, uint256 index) external {
        bytes32[] storage disputedForks = disputeData[channelId].disputedForks;
        require(index < disputedForks.length, "LocalDiamond: disputed fork index out of bounds");

        // Move last element to index and pop
        disputedForks[index] = disputedForks[disputedForks.length - 1];
        disputedForks.pop();
    }

    function addOnChainSlash(bytes32 channelId, address participant, uint256 timestamp) external {
        disputeData[channelId].onChainSlashes.push(OnChainSlash(participant, timestamp));
    }
}
