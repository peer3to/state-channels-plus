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
        StateSnapshot memory genesisStateSnapshot = _getGenesisStateSnapshot(
            channelId,
            updateStateSnapshotStruct
        );

        ExitChannelBlock[] memory exitChannelBlocks = updateStateSnapshotStruct
            .exitChannelBlocks;
        StateSnapshot memory newStateSnapshot = updateStateSnapshotStruct
            .stateSnapshot;
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
        UpdateStateSnapshotStruct memory updateStateSnapshotStruct
    ) internal view returns (StateSnapshot memory) {
        if (getDisputeLength(channelId) != getSnapshotForkCnt(channelId)) {
            // dispute proof is required
            Dispute memory dispute = updateStateSnapshotStruct
                .disputeProof
                .dispute;
            uint disputeTimestamp = updateStateSnapshotStruct
                .disputeProof
                .timestamp;

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
                    updateStateSnapshotStruct.disputeProof.outputStateSnapshot,
                    dispute
                ),
                "State snapshot is not valid"
            );

            return updateStateSnapshotStruct.disputeProof.outputStateSnapshot;
        } else {
            return stateSnapshots[channelId];
        }
    }
}
