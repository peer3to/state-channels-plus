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
        // start with the simplest case.
        // the snapshot submittes is on the latest fork and  there are no exitBlocks to consider

        ExitChannel[] memory exitChannels = updateStateSnapshotStruct
            .exitChannelBlocks;
        StateSnapshot memory newStateSnapshot = updateStateSnapshotStruct
            .stateSnapshot;

        ForkMilestoneProof memory milestone = updateStateSnapshotStruct
            .forkMilestoneProof;

        if (
            exitChannels.length == 0 &&
            newStateSnapshot.forkCnt == getDisputeLength(channelId) // or should it compare to the latest snapshot.forkCnt?
        ) {
            // we are on the latest fork
            // proof finaly of the milestone within the fork

            // this implies that a pervious stateSnapshot already "teleported" to the latest fork
            // and so we can use the participants of the previous stateSnapshot as the expectedParticipants
            address[] memory expectedParticipants = getSnapshotParticipants(
                channelId
            );

            // and the genesisSnapshotHash is the hash of the previous stateSnapshot
            bytes32 genesisSnapshotHash = keccak256(
                abi.encode(stateSnapshots[channelId])
            );

            (
                bool isFinal,
                bytes32 _finalizedSnapshotHash
            ) = AStateChannelManagerProxy(address(this)).isMilestoneFinal(
                    milestone,
                    expectedParticipants,
                    genesisSnapshotHash
                );

            if (isFinal) {
                stateSnapshots[channelId] = newStateSnapshot;
            } else {
                revert("Milestone not finalized");
            }
        }

        // Emit an event for the update
        emit StateSnapshotUpdated(
            channelId,
            updateStateSnapshotStruct.stateSnapshot
        );
    }
}
