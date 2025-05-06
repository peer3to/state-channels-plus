pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "../DataTypes.sol";
import "./AStateChannelManagerProxy.sol";

contract StateSnapshotFacet is StateChannelCommon {
    event StateSnapshotUpdated(
        bytes32 indexed channelId,
        StateSnapshot stateSnapshot
    );

    function updateStateSnapshot(
        bytes32 channelId,
        UpdateStateSnapshotStruct memory updateStateSnapshotStruct
    ) external onlySelf {
        ExitChannelBlock[] memory exitChannelBlocks = updateStateSnapshotStruct
            .exitChannelBlocks;
        StateSnapshot memory newStateSnapshot = updateStateSnapshotStruct
            .stateSnapshot;

        bool hasLatestDisputeProof = updateStateSnapshotStruct
            .latestDisputeProof
            .hasValue;
        bool hasMilestoneProof = updateStateSnapshotStruct
            .milestoneProofs
            .hasValue;

        // No teleport, no progress - useless case, just validate snapshot
        if (!hasLatestDisputeProof && !hasMilestoneProof) {
            if (
                keccak256(abi.encode(newStateSnapshot)) !=
                keccak256(abi.encode(stateSnapshots[channelId]))
            ) {
                revert("StateSnapshot is not valid");
            }

            return;
        }

        // Only teleport to latest fork, no progress within fork
        if (hasLatestDisputeProof && !hasMilestoneProof) {
            _handleForkTeleport(
                channelId,
                updateStateSnapshotStruct,
                newStateSnapshot
            );
            return;
        }

        //Already on latest fork, progress state within it
        if (!hasLatestDisputeProof && hasMilestoneProof) {
            _handleForkProgress(
                channelId,
                updateStateSnapshotStruct.stateSnapshot,
                updateStateSnapshotStruct.exitChannelBlocks,
                updateStateSnapshotStruct.milestoneProofs.value
            );
            return;
        }

        //Teleport to latest fork and then progress state within it
        if (hasLatestDisputeProof && hasMilestoneProof) {
            _handleForkTeleport(
                channelId,
                updateStateSnapshotStruct,
                newStateSnapshot
            );
            _handleForkProgress(
                channelId,
                updateStateSnapshotStruct.stateSnapshot,
                updateStateSnapshotStruct.exitChannelBlocks,
                updateStateSnapshotStruct.milestoneProofs.value
            );
            return;
        }
    }

    function _handleForkTeleport(
        bytes32 channelId,
        UpdateStateSnapshotStruct memory updateStateSnapshotStruct,
        StateSnapshot memory newStateSnapshot
    ) internal {
        // TODO: Implement teleportation to latest fork using forkFinalityProof
        // This should verify the fork proof and update the state snapshot to the new fork

        // For now, just update the state snapshot
        _updateStateSnapshot(channelId, newStateSnapshot);
    }

    function _handleForkProgress(
        bytes32 channelId,
        StateSnapshot memory newStateSnapshot,
        ExitChannelBlock[] memory exitChannelBlocks,
        ForkMilestoneProof[] memory milestoneProofs
    ) internal {
        StateSnapshot memory currentStateSnapshot = stateSnapshots[channelId];

        // Only process if both snapshots are for the latest fork
        require(
            newStateSnapshot.forkCnt == getDisputeLength(channelId) &&
                stateSnapshots[channelId].forkCnt ==
                getDisputeLength(channelId),
            "StateSnapshot is not valid"
        );

        require(
            milestoneProofs.length == exitChannelBlocks.length,
            "Milestone proofs length must match exit channel blocks length"
        );
        // Get current participants from state snapshot
        address[] memory currentParticipants = getSnapshotParticipants(
            channelId
        );
        bytes32 previousExitChannelBlockHash = currentStateSnapshot
            .latestExitChannelBlockHash;
        bytes32 genesisSnapshotHash = keccak256(
            abi.encode(currentStateSnapshot)
        );

        // Loop through all exit channel blocks and validate them
        for (uint i = 0; i < exitChannelBlocks.length; i++) {
            ExitChannelBlock memory exitBlock = exitChannelBlocks[i];

            // Verify connection to previous block hash
            // For first block, it must connect to the stateSnapshot's latestExitChannelBlockHash
            require(
                exitBlock.previousBlockHash == previousExitChannelBlockHash,
                "Exit block not connected to chain"
            );

            // Check corresponding milestone proof is finalized
            ForkMilestoneProof memory milestone = milestoneProofs[i];
            (bool isFinal, bytes32 finalizedSnapshotHash) = _isMilestoneFinal(
                milestone,
                currentParticipants,
                genesisSnapshotHash
            );
            require(isFinal, "Milestone not finalized");

            // Process each exit in the block and update participant set
            for (uint j = 0; j < exitBlock.exitChannels.length; j++) {
                ExitChannel memory exit = exitBlock.exitChannels[j];

                // If not a partial exit, remove participant from the set
                if (!exit.isPartialExit) {
                    currentParticipants = removeParticipant(
                        currentParticipants,
                        exit.participant
                    );
                }
            }

            // Update previous hash for next iteration
            previousExitChannelBlockHash = keccak256(abi.encode(exitBlock));
        }
    }

    function _updateStateSnapshot(
        bytes32 channelId,
        StateSnapshot memory newStateSnapshot
    ) internal {
        stateSnapshots[channelId] = newStateSnapshot;
        emit StateSnapshotUpdated(channelId, newStateSnapshot);
    }

    function _isMilestoneFinal(
        ForkMilestoneProof memory milestone,
        address[] memory expectedParticipants,
        bytes32 genesisSnapshotHash
    ) internal returns (bool isFinal, bytes32 finalizedSnapshotHash) {
        return
            AStateChannelManagerProxy(address(this)).isMilestoneFinal(
                milestone,
                expectedParticipants,
                genesisSnapshotHash
            );
    }

    function removeParticipant(
        address[] memory participants,
        address participantToRemove
    ) internal pure returns (address[] memory) {
        // Count how many participants will remain after removal
        uint count = 0;
        for (uint i = 0; i < participants.length; i++) {
            if (participants[i] != participantToRemove) {
                count++;
            }
        }

        // Create new array with reduced size
        address[] memory newParticipants = new address[](count);

        // Fill new array with remaining participants
        uint index = 0;
        for (uint i = 0; i < participants.length; i++) {
            if (participants[i] != participantToRemove) {
                newParticipants[index] = participants[i];
                index++;
            }
        }

        return newParticipants;
    }
}
