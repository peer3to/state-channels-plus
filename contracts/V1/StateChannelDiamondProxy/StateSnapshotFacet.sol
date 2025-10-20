pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "../types/DataTypes.sol";
import "./StateChannelManagerProxy.sol";
import "./Errors.sol";

import "./UtilityFacet.sol";

contract StateSnapshotFacet is StateChannelCommon {
    function updateStateSnapshotFork(
        bytes32 channelId,
        StateSnapshot memory newStateSnapshot,
        ExitChannelBlock[] memory exitChannelBlocks
    ) external onlySelf {
        StateSnapshot storage currentStateSnapshot = stateSnapshots[channelId];
        DisputeData storage disputeData = disputeData[channelId];
        bytes32 targetForkId = newStateSnapshot.forkId;
        require(
            UtilityFacet(utilityFacetAddress).isGenesisSnapshotWithoutTimeCheck(newStateSnapshot),
            ErrorInvalidStateSnapshot()
        );
        (bool hasGenesis, uint256 genesisTimestamp) =
            getGenesisTimestamp(channelId, newStateSnapshot.snapshotData.originForkId, targetForkId);
        require(hasGenesis && newStateSnapshot.timestamp == genesisTimestamp, ErrorInvalidStateSnapshot());
        mapping(bytes32 forkId => DisputeWindow) storage disputeWindowMap = disputeData.disputeWindowMap;
        DisputeWindow storage disputeWindow = disputeWindowMap[currentStateSnapshot.forkId];
        bool updated = false;

        while (
            disputeWindow.reducedResult.forkId != bytes32(0)
                && _isReduceChallengePeriodExpired(disputeWindow, getEvidenceTime())
        ) {
            if (disputeWindow.reducedResult.forkId == targetForkId) {
                _updateStateSnapshot(channelId, currentStateSnapshot, newStateSnapshot, exitChannelBlocks);
                updated = true;
                break;
            }
            disputeWindow = disputeWindowMap[disputeWindow.reducedResult.forkId];
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

        require(currentStateSnapshot.forkId == newStateSnapshot.forkId, ErrorSnapshotForkMismatch());
        require(newStateSnapshot.blockHeight > currentStateSnapshot.blockHeight, ErrorBlockHeightTooOld());
        require(
            _verifyMilestones(milestoneProofs, milestoneSnapshots, currentStateSnapshot.snapshotData),
            ErrorInvalidStateProof()
        );

        _updateStateSnapshot(channelId, currentStateSnapshot, newStateSnapshot, exitChannelBlocks);
    }

    function _updateStateSnapshot(
        bytes32 channelId,
        StateSnapshot memory currentOnChainSnapshot,
        StateSnapshot memory newSnapshot,
        ExitChannelBlock[] memory exitChannelBlocks
    ) internal {
        require(
            _verifyExitChannelBlocks(exitChannelBlocks, currentOnChainSnapshot.snapshotData, newSnapshot.snapshotData),
            ErrorExitChannelBlocksInvalid()
        );
        _applyExitChannelBlocks(channelId, exitChannelBlocks, newSnapshot.snapshotData.latestJoinChannelBlockHash);

        // Update the state snapshot
        stateSnapshots[channelId] = newSnapshot;

        // Check if channel should be closed (0 participants remaining)
        if (newSnapshot.snapshotData.participants.length == 0) {
            emit ChannelClosed(channelId);
            // Clear storage when channel is closed (0 participants)
            _clearStorage(channelId, newSnapshot.snapshotData.latestJoinChannelBlockHash);
            // Clear the state snapshot
            delete stateSnapshots[channelId];
            // TODO! send all remaining funds to the treasury
        }

        //check if last fork -> clearStorage
        if (disputeData[channelId].disputeWindowMap[newSnapshot.forkId].evidence.creationTimestamp == 0) {
            _clearStorage(channelId, newSnapshot.snapshotData.latestJoinChannelBlockHash);
        }
        emit StateSnapshotUpdated(channelId, newSnapshot);
    }

    function _verifyMilestones(
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        SnapshotData memory genesisSnapshotData
    ) internal view returns (bool) {
        (bool isValid,) =
            UtilityFacet(utilityFacetAddress).verifyMilestones(milestoneProofs, milestoneSnapshots, genesisSnapshotData);
        return isValid;
    }

    function _applyExitChannelBlocks(
        bytes32 channelId,
        ExitChannelBlock[] memory exitChannelBlocks,
        bytes32 joinChannelBlockHash
    ) internal {
        ChannelBalance storage cb = channelBalances[channelId];
        Balance memory totalDeposits = cb.onChainJoinChannelMap[joinChannelBlockHash].totalDeposits;
        Balance memory totalWithdrawals = cb.totalOnChainWithdrawals;
        for (uint256 i = 0; i < exitChannelBlocks.length; i++) {
            for (uint256 j = 0; j < exitChannelBlocks[i].exitChannels.length; j++) {
                bool success = StateChannelManagerProxy(address(this)).withdrawAssetsComposable(
                    exitChannelBlocks[i].exitChannels[j]
                );
                require(success, ErrorWithdrawalFailed());

                totalWithdrawals = stateMachineImplementation.addBalance(
                    totalWithdrawals, exitChannelBlocks[i].exitChannels[j].balance
                );
                //require withdrawals <= deposits
                bool isLessThan = stateMachineImplementation.isBalanceLesserThan(totalWithdrawals, totalDeposits);
                bool isEqual = stateMachineImplementation.areBalancesEqual(totalWithdrawals, totalDeposits);
                require(isLessThan || isEqual, CantWithdrawMoreThanDeposits());
            }
        }
        cb.totalOnChainWithdrawals = totalWithdrawals;
        emit WithdrawalsUpdated(channelId, totalWithdrawals);
    }

    function _clearStorage(bytes32 channelId, bytes32 snapshotLatestJoinChannelBlockHash) internal {
        _clearDisputeData(channelId);
        _clearOldJoinChannels(channelId, snapshotLatestJoinChannelBlockHash);
        emit ChannelStorageCleared(channelId, snapshotLatestJoinChannelBlockHash);
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
    }

    function _clearOldJoinChannels(bytes32 channelId, bytes32 snapshotLatestJoinChannelBlockHash) internal {
        ChannelBalance storage cb = channelBalances[channelId];
        //start from the previous block hash (keep the current blockHash in storage for easy access even though it's in the snapshot)
        bytes32 keyToDelete = cb.onChainJoinChannelMap[snapshotLatestJoinChannelBlockHash].previousJoinChannelBlockHash;
        bytes32 prev;
        while (keyToDelete != bytes32(0)) {
            prev = cb.onChainJoinChannelMap[keyToDelete].previousJoinChannelBlockHash;
            delete cb.onChainJoinChannelMap[keyToDelete];
            keyToDelete = prev;
        }
    }
}
