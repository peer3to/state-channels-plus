pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "../DataTypes.sol";
import "./AStateChannelManagerProxy.sol";
import "./Errors.sol";
import "./StateChannelUtilLibrary.sol";

contract StateSnapshotFacet is StateChannelCommon {
    function updateStateSnapshotWithDispute(
        bytes32 channelId,
        ForkMilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        DisputeProof memory disputeProof,
        ExitChannelBlock[] memory exitChannelBlocks
    ) external onlySelf {
        // resolve genesis state snapshot source
        // - if stateSnapshot(on-chain).forkCnt == disputeProof.forkCnt, then the genesis state snapshot is the on-chain stateSnapshot
        // - otherwise, the dispute is validated and the genesis state snapshot is disputeProof.outputStateSnapshot
        StateSnapshot memory genesisStateSnapshot = _resolveGenesisSnapshot(
            channelId,
            disputeProof
        );

        _updateStateSnapshot(
            channelId,
            milestoneProofs,
            milestoneSnapshots,
            exitChannelBlocks,
            genesisStateSnapshot
        );
    }

    function updateStateSnapshotWithoutDispute(
        bytes32 channelId,
        ForkMilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        ExitChannelBlock[] memory exitChannelBlocks
    ) external onlySelf {
        require(
            getDisputeLength(channelId) == getSnapshotForkCnt(channelId),
            ErrorDisputeProofRequired()
        );
        StateSnapshot memory onChainStateSnapshot = stateSnapshots[channelId];

        _updateStateSnapshot(
            channelId,
            milestoneProofs,
            milestoneSnapshots,
            exitChannelBlocks,
            onChainStateSnapshot
        );
    }

    function _resolveGenesisSnapshot(
        bytes32 channelId,
        DisputeProof memory disputeProof
    ) internal view returns (StateSnapshot memory) {
        if (getDisputeLength(channelId) == getSnapshotForkCnt(channelId)) {
            return stateSnapshots[channelId];
        }
        Dispute memory dispute = disputeProof.dispute;
        uint disputeTimestamp = disputeProof.timestamp;

        require(
            _isDisputeCommitmentValid(dispute, disputeTimestamp, channelId),
            ErrorDisputeProofNotValid()
        );

        address[] memory addressesInThreshold = _getAddressesInThreshold(
            channelId
        );

        require(
            _isDisputeFinalized(disputeProof, addressesInThreshold),
            ErrorDisputeNotFinalized()
        );
        require(
            _isStateSnapshotValid(disputeProof.outputStateSnapshot, dispute),
            ErrorStateSnapshotNotValid()
        );

        return disputeProof.outputStateSnapshot;
    }

    function _updateStateSnapshot(
        bytes32 channelId,
        ForkMilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        ExitChannelBlock[] memory exitChannelBlocks,
        StateSnapshot memory genesisStateSnapshot
    ) internal {
        // verify state proof within the fork
        bool isStateValid = _verifyForkProof(
            milestoneProofs,
            milestoneSnapshots,
            genesisStateSnapshot
        );
        require(isStateValid, ErrorInvalidStateProof());

        StateSnapshot memory onChainStateSnapshot = stateSnapshots[channelId];
        StateSnapshot memory lastProovenSnapshot = milestoneSnapshots[
            milestoneSnapshots.length - 1
        ];

        _validateExitChannelBlocks(
            exitChannelBlocks,
            onChainStateSnapshot,
            lastProovenSnapshot
        );

        _applyExitChannelBlocks(channelId, exitChannelBlocks);

        // Update the state snapshot
        stateSnapshots[channelId] = lastProovenSnapshot;

        // clear onChainSlashedParticipants
        delete disputeData[channelId].onChainSlashedParticipants;
        // clear pendingParticipants
        delete disputeData[channelId].pendingParticipants;

        emit StateSnapshotUpdated(
            channelId,
            lastProovenSnapshot,
            block.timestamp
        );
    }

    function _verifyForkProof(
        ForkMilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        StateSnapshot memory genesisSnapshot
    ) internal returns (bool) {
        (bool isValid, ) = AStateChannelManagerProxy(address(this))
            .verifyForkProof(
                milestoneProofs,
                milestoneSnapshots,
                genesisSnapshot
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
                exitChannelBlocks[0].previousBlockHash ==
                    onChainStateSnapshot.latestExitChannelBlockHash,
                ErrorFirstExitChannelBlockInvalid()
            );

            // Verify all blocks are cryptographically linked if there's more than one block
            for (uint i = 1; i < exitChannelBlocks.length; i++) {
                require(
                    exitChannelBlocks[i].previousBlockHash ==
                        keccak256(abi.encode(exitChannelBlocks[i - 1])),
                    ErrorExitChannelBlocksNotLinked()
                );
            }

            // Verify last snapshot points to last block
            require(
                lastProovenSnapshot.latestExitChannelBlockHash ==
                    keccak256(
                        abi.encode(
                            exitChannelBlocks[exitChannelBlocks.length - 1]
                        )
                    ),
                ErrorLastSnapshotInvalid()
            );
        } else {
            // If no exit blocks, verify the snapshot points to the genesis state's latest block hash
            require(
                lastProovenSnapshot.latestExitChannelBlockHash ==
                    onChainStateSnapshot.latestExitChannelBlockHash,
                ErrorLastSnapshotDoesNotMatchGenesis()
            );
        }
    }

    function _applyExitChannelBlocks(
        bytes32 channelId,
        ExitChannelBlock[] memory exitChannelBlocks
    ) internal {
        for (uint i = 0; i < exitChannelBlocks.length; i++) {
            for (
                uint j = 0;
                j < exitChannelBlocks[i].exitChannels.length;
                j++
            ) {
                AStateChannelManagerProxy(address(this)).processExitChannel(
                    channelId,
                    exitChannelBlocks[i].exitChannels[j]
                );
            }
        }
    }

    function _isDisputeCommitmentValid(
        Dispute memory dispute,
        uint disputeTimestamp,
        bytes32 channelId
    ) internal view returns (bool) {
        bytes32 onChainDisputeCommitment = getLatestDisputeCommitment(
            channelId
        );
        bytes32 providedDisputeCommitment = keccak256(
            abi.encode(abi.encode(dispute), disputeTimestamp)
        );
        return providedDisputeCommitment == onChainDisputeCommitment;
    }

    function _getAddressesInThreshold(
        bytes32 channelId
    ) internal view returns (address[] memory) {
        address[] memory snapshotParticipants = getSnapshotParticipants(
            channelId
        );
        address[] memory slashedParticipants = getOnChainSlashedParticipants(
            channelId
        );

        address[] memory pendingParticpants = getPendingParticipants(channelId);

        // Merge participants with deduplication
        address[] memory uniqueParticipants = StateChannelUtilLibrary
            .concatAddressArraysNoDuplicates(
                snapshotParticipants,
                pendingParticpants
            );

        // Pre-allocate maximum possible size
        address[] memory result = new address[](uniqueParticipants.length);
        uint validCount = 0;

        for (uint i = 0; i < uniqueParticipants.length; i++) {
            // Skip if participant is slashed
            if (
                StateChannelUtilLibrary.isAddressInArray(
                    slashedParticipants,
                    uniqueParticipants[i]
                )
            ) {
                continue;
            }

            // Add to result immediately
            result[validCount] = uniqueParticipants[i];
            validCount++;
        }

        // If we used all slots, return as is
        if (validCount == uniqueParticipants.length) {
            return result;
        }

        // Otherwise create a properly sized copy
        address[] memory finalResult = new address[](validCount);
        for (uint i = 0; i < validCount; i++) {
            finalResult[i] = result[i];
        }

        return finalResult;
    }

    function _isDisputeFinalized(
        DisputeProof memory disputeProof,
        address[] memory addressesInThreshold
    ) internal view returns (bool) {
        if (block.timestamp >= disputeProof.timestamp + getChallengeTime()) {
            return true;
        }
        bytes memory encodedDispute = abi.encode(disputeProof.dispute);
        (bool isValid, ) = StateChannelUtilLibrary.verifyThresholdSigned(
            addressesInThreshold,
            encodedDispute,
            disputeProof.signatures
        );
        return isValid;
    }

    function _isStateSnapshotValid(
        StateSnapshot memory outputStateSnapshot,
        Dispute memory dispute
    ) internal pure returns (bool) {
        return
            keccak256(abi.encode(outputStateSnapshot)) ==
            dispute.outputStateSnapshotHash;
    }
}
