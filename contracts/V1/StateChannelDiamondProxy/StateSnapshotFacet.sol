pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "../DataTypes.sol";
import "./AStateChannelManagerProxy.sol";
import "./Errors.sol";
import "./StateChannelUtilLibrary.sol";

contract StateSnapshotFacet is StateChannelCommon {
    function updateStateSnapshotFork(
        bytes32 channelId,
        StateSnapshot memory newStateSnapshot,
        ExitChannelBlock[] memory exitChannelBlocks
    ) external onlySelf {
        StateSnapshot storage currentStateSnapshot = stateSnapshots[channelId];
        DisputeData storage disputeData = disputeData[channelId];
        bytes32 targetForkId = newStateSnapshot.forkId;
        require(keccak256(abi.encode(newStateSnapshot.snapshotData)) != targetForkId, ErrorInvalidStateSnapshot());
        mapping(bytes32 forkId => DisputeWindow) storage disputeWindowMap = disputeData.disputeWindowMap;
        DisputeWindow storage disputeWindow = disputeWindowMap[currentStateSnapshot.forkId];
        bool updated = false;

        while (
            disputeWindow.reducedResult.reducedForkId != bytes32(0) && _isReduceChallengePeriodExpired(disputeWindow)
        ) {
            if (disputeWindow.reducedResult.reducedForkId == targetForkId) {
                _updateStateSnapshot(channelId, currentStateSnapshot, newStateSnapshot, exitChannelBlocks);
                updated = true;
                break;
            }
            disputeWindow = disputeWindowMap[disputeWindow.reducedResult.reducedForkId];
        }
        require(updated, ErrorStateSnapshotNotValid());
    }

    function updateStateSnapshotSameFork(
        bytes32 channelId,
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        ExitChannelBlock[] memory exitChannelBlocks
    ) external onlySelf {
        require(milestoneSnapshots.length > 0, ErrorSnapshotsNotProvided());

        StateSnapshot storage currentStateSnapshot = stateSnapshots[channelId];
        StateSnapshot memory newStateSnapshot = milestoneSnapshots[milestoneSnapshots.length - 1];

        require(currentStateSnapshot.forkId == newStateSnapshot.forkId, ErrorStanpshotForkMismatch());
        require(_verifyMilestones(milestoneProofs, milestoneSnapshots, currentStateSnapshot), ErrorInvalidStateProof());

        _updateStateSnapshot(channelId, currentStateSnapshot, newStateSnapshot, exitChannelBlocks);
    }

    function _updateStateSnapshot(
        bytes32 channelId,
        StateSnapshot memory currentOnChainSnapshot,
        StateSnapshot memory newSnapshot,
        ExitChannelBlock[] memory exitChannelBlocks
    ) internal {
        _validateExitChannelBlocks(exitChannelBlocks, currentOnChainSnapshot, newSnapshot);
        _applyExitChannelBlocks(channelId, exitChannelBlocks);

        // Update the state snapshot
        stateSnapshots[channelId] = newSnapshot;

        //check if last fork -> clearDisputeData
        if (disputeData[channelId].disputeWindowMap[newSnapshot.forkId].evidence.creationTimestamp == 0) {
            _clearDisputeData(channelId);
        }
        emit StateSnapshotUpdated(channelId, newSnapshot, block.timestamp);
    }

    function _verifyMilestones(
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        StateSnapshot memory genesisSnapshot
    ) internal returns (bool) {
        (bool isValid,) = AStateChannelManagerProxy(address(this)).verifyMilestones(
            milestoneProofs, milestoneSnapshots, genesisSnapshot
        );
        return isValid;
    }

    function _validateExitChannelBlocks(
        ExitChannelBlock[] memory exitChannelBlocks,
        StateSnapshot memory onChainStateSnapshot,
        StateSnapshot memory lastProovenSnapshot
    ) internal pure {
        // Validate ExitChannelBlock chain if there are any blocks
        if (exitChannelBlocks.length > 0) {
            // Check first block points to genesis state
            require(
                exitChannelBlocks[0].previousBlockHash == onChainStateSnapshot.snapshotData.latestExitChannelBlockHash,
                ErrorFirstExitChannelBlockInvalid()
            );

            // Verify all blocks are cryptographically linked if there's more than one block
            for (uint256 i = 1; i < exitChannelBlocks.length; i++) {
                require(
                    exitChannelBlocks[i].previousBlockHash == keccak256(abi.encode(exitChannelBlocks[i - 1])),
                    ErrorExitChannelBlocksNotLinked()
                );
            }

            // Verify last snapshot points to last block
            require(
                lastProovenSnapshot.snapshotData.latestExitChannelBlockHash
                    == keccak256(abi.encode(exitChannelBlocks[exitChannelBlocks.length - 1])),
                ErrorLastSnapshotInvalid()
            );
        } else {
            // If no exit blocks, verify the snapshot points to the genesis state's latest block hash
            require(
                lastProovenSnapshot.snapshotData.latestExitChannelBlockHash
                    == onChainStateSnapshot.snapshotData.latestExitChannelBlockHash,
                ErrorLastSnapshotDoesNotMatchGenesis()
            );
        }
    }

    function _applyExitChannelBlocks(bytes32 channelId, ExitChannelBlock[] memory exitChannelBlocks) internal {
        for (uint256 i = 0; i < exitChannelBlocks.length; i++) {
            for (uint256 j = 0; j < exitChannelBlocks[i].exitChannels.length; j++) {
                AStateChannelManagerProxy(address(this)).processExitChannel(
                    channelId, exitChannelBlocks[i].exitChannels[j]
                );
            }
        }
    }

    function _clearDisputeData(bytes32 channelId) internal {
        DisputeData storage disputeData = disputeData[channelId];
        delete disputeData.onChainSlashes; //TODO! Check should we clear this since things happen in 'parallel' now
        delete disputeData.pendingParticipants;
        mapping(bytes32 => DisputeWindow) storage disputeWindowMap = disputeData.disputeWindowMap;
        for (uint256 i = 0; i < disputeData.disputedForks.length; i++) {
            delete disputeWindowMap[disputeData.disputedForks[i]];
        }
        delete disputeData.disputedForks;
        delete disputeData.latestJoinChannelBlockHash;
    }
}
