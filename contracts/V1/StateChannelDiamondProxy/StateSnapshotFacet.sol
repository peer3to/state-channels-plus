pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "../types/DataTypes.sol";
import "./StateChannelManagerProxy.sol";
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
        require(newStateSnapshot.blockHeight == 0, ErrorInvalidStateSnapshot());
        require(keccak256(abi.encode(newStateSnapshot.snapshotData)) == targetForkId, ErrorInvalidStateSnapshot());
        mapping(bytes32 forkId => DisputeWindow) storage disputeWindowMap = disputeData.disputeWindowMap;
        DisputeWindow storage disputeWindow = disputeWindowMap[currentStateSnapshot.forkId];
        bool updated = false;

        while (
            disputeWindow.reducedResult.forkId != bytes32(0)
                && _isReduceChallengePeriodExpired(disputeWindow, getEvidenceTime())
        ) {
            if (disputeWindow.reducedResult.forkId == targetForkId) {
                (bool hasGenesis, uint256 genesisTimestap) =
                    getGenesisTimestamp(channelId, newStateSnapshot.snapshotData.originForkId, targetForkId);
                require(hasGenesis && newStateSnapshot.timestamp == genesisTimestap, ErrorInvalidStateSnapshot());
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
        _validateExitChannelBlocks(exitChannelBlocks, currentOnChainSnapshot, newSnapshot);
        _applyExitChannelBlocks(channelId, exitChannelBlocks, newSnapshot.snapshotData.latestJoinChannelBlockHash);

        // Update the state snapshot
        stateSnapshots[channelId] = newSnapshot;

        //check if last fork -> clearStorage
        if (disputeData[channelId].disputeWindowMap[newSnapshot.forkId].evidence.creationTimestamp == 0) {
            _clearStorage(channelId, newSnapshot.snapshotData.latestJoinChannelBlockHash);
        }
        emit StateSnapshotUpdated(channelId, newSnapshot, block.timestamp);
    }

    function _verifyMilestones(
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        SnapshotData memory genesisSnapshotData
    ) internal returns (bool) {
        (bool isValid,) = StateChannelManagerProxy(address(this)).verifyMilestones(
            milestoneProofs, milestoneSnapshots, genesisSnapshotData
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
