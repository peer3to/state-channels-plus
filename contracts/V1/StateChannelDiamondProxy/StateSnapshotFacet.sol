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
        ForkMilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        DisputeProof memory disputeProof,
        ExitChannelBlock[] memory exitChannelBlocks
    ) external onlySelf {
        StateSnapshot memory genesisStateSnapshot = _getGenesisStateSnapshot(
            channelId,
            disputeProof
        );

        // verify state proof within the fork
        bool isStateValid = _verifyForkProof(
            milestoneProofs,
            milestoneSnapshots,
            genesisStateSnapshot
        );
        require(isStateValid, "Invalid State Proof");

        StateSnapshot memory lastProovenSnapshot = milestoneSnapshots[
            milestoneSnapshots.length - 1
        ];

        _validateExitChannelBlocks(
            exitChannelBlocks,
            genesisStateSnapshot,
            lastProovenSnapshot
        );

        stateSnapshots[channelId] = lastProovenSnapshot;
        emit StateSnapshotUpdated(channelId, lastProovenSnapshot);
    }

    function _validateExitChannelBlocks(
        ExitChannelBlock[] memory exitChannelBlocks,
        StateSnapshot memory genesisStateSnapshot,
        StateSnapshot memory lastProovenSnapshot
    ) internal pure {
        // Validate ExitChannelBlock chain if there are any blocks
        if (exitChannelBlocks.length > 0) {
            // Check first block points to genesis state
            require(
                exitChannelBlocks[0].previousBlockHash ==
                    genesisStateSnapshot.latestExitChannelBlockHash,
                "First ExitChannelBlock must point to genesis state"
            );

            // Verify all blocks are cryptographically linked if there's more than one block
            for (uint i = 1; i < exitChannelBlocks.length; i++) {
                require(
                    exitChannelBlocks[i].previousBlockHash ==
                        keccak256(abi.encode(exitChannelBlocks[i - 1])),
                    "ExitChannelBlocks must be cryptographically linked"
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
                "Last snapshot must point to last ExitChannelBlock"
            );
        } else {
            // If no exit blocks, verify the snapshot points to the genesis state's latest block hash
            require(
                lastProovenSnapshot.latestExitChannelBlockHash ==
                    genesisStateSnapshot.latestExitChannelBlockHash,
                "Last snapshot must point to genesis state's latest block hash when no exits"
            );
        }
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

    function _isDisputeProofProvided(
        uint disputeTimestamp
    ) internal pure returns (bool) {
        return disputeTimestamp != 0;
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

    function _isDisputeFinalized(
        uint disputeTimestamp
    ) internal view returns (bool) {
        return block.timestamp >= disputeTimestamp + getChallengeTime();
    }

    function _isStateSnapshotValid(
        StateSnapshot memory outputStateSnapshot,
        Dispute memory dispute
    ) internal pure returns (bool) {
        return
            keccak256(abi.encode(outputStateSnapshot)) ==
            dispute.outputStateSnapshotHash;
    }

    function _getGenesisStateSnapshot(
        bytes32 channelId,
        DisputeProof memory disputeProof
    ) internal view returns (StateSnapshot memory) {
        if (getDisputeLength(channelId) != getSnapshotForkCnt(channelId)) {
            // dispute proof is required
            Dispute memory dispute = disputeProof.dispute;
            uint disputeTimestamp = disputeProof.timestamp;

            require(
                _isDisputeProofProvided(disputeTimestamp),
                "Dispute proof is required"
            );
            require(
                _isDisputeCommitmentValid(dispute, disputeTimestamp, channelId),
                "Dispute proof is not valid"
            );
            require(
                _isDisputeFinalized(disputeTimestamp),
                "Dispute is not finalized"
            );
            require(
                _isStateSnapshotValid(
                    disputeProof.outputStateSnapshot,
                    dispute
                ),
                "State snapshot is not valid"
            );

            return disputeProof.outputStateSnapshot;
        } else {
            return stateSnapshots[channelId];
        }
    }
}
