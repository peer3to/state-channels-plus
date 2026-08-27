pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "../types/DataTypes.sol";
import "./StateChannelManagerProxy.sol";
import "./Errors.sol";

contract StateSnapshotFacet is StateChannelCommon {
    function updateStateSnapshotFork(
        bytes32 channelId,
        StateSnapshot memory newStateSnapshot,
        MessageBlock[] memory outboundMessageBlocks
    ) external {
        StateSnapshot storage currentStateSnapshot = stateSnapshots[channelId];
        DisputeData storage disputeData = disputeData[channelId];
        bytes32 targetForkId = newStateSnapshot.forkId;
        if (currentStateSnapshot.forkId == targetForkId) return; // already on the correct fork
        require(
            UtilityFacet(utilityFacetAddress).isGenesisSnapshotWithoutTimeCheck(newStateSnapshot),
            ErrorInvalidStateSnapshot()
        );
        (bool hasGenesis, uint256 genesisTimestamp) =
            _getGenesisTimestamp(channelId, newStateSnapshot.snapshotData.originForkId, targetForkId);
        require(hasGenesis && newStateSnapshot.timestamp == genesisTimestamp, ErrorInvalidStateSnapshot());
        mapping(bytes32 forkId => DisputeWindow) storage disputeWindowMap = disputeData.disputeWindowMap;
        DisputeWindow storage disputeWindow = disputeWindowMap[currentStateSnapshot.forkId];
        bool updated = false;
        while (
            disputeWindow.reducedResult.forkId != bytes32(0)
                && _isReduceChallengePeriodExpired(disputeWindow, _getEvidenceTime())
        ) {
            if (disputeWindow.reducedResult.forkId == targetForkId) {
                _updateStateSnapshot(channelId, currentStateSnapshot, newStateSnapshot, outboundMessageBlocks, false);
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
        MessageBlock[] memory outboundMessageBlocks
    ) external {
        require(milestoneSnapshots.length > 0, ErrorSnapshotsNotProvided());

        StateSnapshot storage currentStateSnapshot = stateSnapshots[channelId];
        StateSnapshot memory newStateSnapshot = milestoneSnapshots[milestoneSnapshots.length - 1];
        require(
            currentStateSnapshot.forkId == newStateSnapshot.forkId,
            RaceConditionSnapshotForkMismatch(currentStateSnapshot.forkId, newStateSnapshot.forkId)
        );
        require(
            UtilityFacet(utilityFacetAddress).isSnapshotNewer(newStateSnapshot, currentStateSnapshot),
            RaceConditionBlockHeightTooOld()
        );
        require(
            _verifyMilestones(currentStateSnapshot.forkId, milestoneProofs, milestoneSnapshots, currentStateSnapshot),
            ErrorInvalidStateProof()
        );
        require(
            newStateSnapshot.snapshotData.latestInboundMessageBlockHash
                == channelBalances[channelId].latestInboundMessageBlockHash,
            RaceConditionPendingInboundNotConsumed(
                newStateSnapshot.snapshotData.latestInboundMessageBlockHash,
                channelBalances[channelId].latestInboundMessageBlockHash
            )
        );

        _updateStateSnapshot(channelId, currentStateSnapshot, newStateSnapshot, outboundMessageBlocks, true);
    }

    function _updateStateSnapshot(
        bytes32 channelId,
        StateSnapshot memory currentOnChainSnapshot,
        StateSnapshot memory newSnapshot,
        MessageBlock[] memory outboundMessageBlocks,
        bool shouldClearStorage
    ) internal {
        outboundMessageBlocks = _pruneOutboundMessageBlocks(
            outboundMessageBlocks, currentOnChainSnapshot.snapshotData.latestOutboundMessageBlockHash
        );
        require(
            _verifyOutboundMessageBlocks(
                outboundMessageBlocks, currentOnChainSnapshot.snapshotData, newSnapshot.snapshotData
            ),
            ErrorOutboundMessageBlocksInvalid()
        );
        _applyOutboundMessageBlocks(channelId, outboundMessageBlocks, newSnapshot.snapshotData);

        // Update the state snapshot
        stateSnapshots[channelId] = newSnapshot;

        // Check if channel should be closed (0 participants remaining)
        if (newSnapshot.snapshotData.participants.length == 0) {
            // Clear storage when channel is closed (0 participants)
            _clearStorage(channelId, newSnapshot.snapshotData.latestInboundMessageBlockHash);
            // Clear the state snapshot
            delete stateSnapshots[channelId];
            // TODO! send all remaining funds to the treasury
        }

        //check if last fork -> clearStorage
        if (
            disputeData[channelId].disputeWindowMap[newSnapshot.forkId].evidence.creationTimestamp == 0
                && shouldClearStorage
        ) {
            _clearStorage(channelId, newSnapshot.snapshotData.latestInboundMessageBlockHash);
        }
        emit StateSnapshotUpdated(channelId, newSnapshot);
    }

    function _verifyMilestones(
        bytes32 forkId,
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        StateSnapshot memory thresholdStateSnapshot
    ) internal returns (bool) {
        bool isValid = StateChannelManagerProxy(address(this))
            .verifyMilestones(forkId, milestoneProofs, milestoneSnapshots, thresholdStateSnapshot);
        return isValid;
    }

    function _applyOutboundMessageBlocks(
        bytes32 channelId,
        MessageBlock[] memory outboundMessageBlocks,
        SnapshotData memory newSnapshotData
    ) internal {
        ChannelBalance storage cb = channelBalances[channelId];
        Balance memory totalDeposits = _resolveTotalDeposits(channelId, newSnapshotData.latestInboundMessageBlockHash);
        Balance memory totalWithdrawals = cb.totalWithdrawals;
        for (uint256 i = 0; i < outboundMessageBlocks.length; i++) {
            for (uint256 j = 0; j < outboundMessageBlocks[i].messages.length; j++) {
                bool success = _processOutboundMessage(outboundMessageBlocks[i].messages[j]);
                require(success, ErrorWithdrawalFailed());

                totalWithdrawals = stateMachineImplementation.addBalance(
                    totalWithdrawals, outboundMessageBlocks[i].messages[j].balance
                );
                //require withdrawals <= deposits
                bool isLessThan = stateMachineImplementation.isBalanceLesserThan(totalWithdrawals, totalDeposits);
                bool isEqual = stateMachineImplementation.areBalancesEqual(totalWithdrawals, totalDeposits);
                require(isLessThan || isEqual, CantWithdrawMoreThanDeposits());
            }
            // TODO - this event is not used
            emit OutboundMessagesProcessed(channelId, outboundMessageBlocks[i], block.timestamp, totalWithdrawals);
        }
        cb.totalWithdrawals = totalWithdrawals;
        cb.latestOutboundMessageBlockHeight = newSnapshotData.latestOutboundMessageBlockHeight;
        emit WithdrawalsUpdated(channelId, totalWithdrawals);
    }

    function _clearStorage(bytes32 channelId, bytes32 snapshotLatestInboundMessageBlockHash) internal {
        _clearDisputeData(channelId);
        _clearOldInboundMessageBlocks(channelId, snapshotLatestInboundMessageBlockHash);
        emit ChannelStorageCleared(channelId, snapshotLatestInboundMessageBlockHash);
    }

    function _clearDisputeData(bytes32 channelId) internal {
        DisputeData storage disputeData = disputeData[channelId];
        delete disputeData.onChainSlashes; //TODO! Check should we clear this since things happen in 'parallel' now
        mapping(bytes32 => DisputeWindow) storage disputeWindowMap = disputeData.disputeWindowMap;
        for (uint256 i = 0; i < disputeData.disputedForks.length; i++) {
            delete disputeWindowMap[disputeData.disputedForks[i]];
        }
        delete disputeData.disputedForks;
    }

    function _clearOldInboundMessageBlocks(bytes32 channelId, bytes32 snapshotLatestInboundMessageBlockHash) internal {
        // start from the snapshot head (prune it too) and walk backwards
        bytes32 keyToDelete = snapshotLatestInboundMessageBlockHash;
        bytes32 prev;
        while (keyToDelete != bytes32(0)) {
            prev = inboundMessageBlockMap[channelId][keyToDelete].previousBlockHash;
            delete inboundMessageBlockMap[channelId][keyToDelete];
            keyToDelete = prev;
        }
    }
}
