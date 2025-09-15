pragma solidity ^0.8.8;

import "../../types/DisputeTypes.sol";
import "./BlockUtils.sol";

function _getDisputeChannel(Dispute memory dispute) pure returns (bytes32) {
    return dispute.input.channelId;
}

function _getDisputeFork(Dispute memory dispute) pure returns (bytes32) {
    return dispute.input.genesisSnapshotDataHash;
}

function _areDisputeAndBlockSameFork(Dispute memory dispute, Block memory _block) pure returns (bool) {
    return _getBlockFork(_block) == _getDisputeFork(dispute);
}

function _areDisputeAndBlockSameChannel(Dispute memory dispute, Block memory _block) pure returns (bool) {
    return _getBlockChannel(_block) == _getDisputeChannel(dispute);
}

function _getLatestBlock(StateProof memory stateProof) pure returns (bool hasBlock, Block memory) {
    Block memory _block;
    MilestoneProof[] memory milestones = stateProof.milestones;
    if (milestones.length == 0 && stateProof.signedBlocks.length == 0) {
        return (false, _block);
    }
    if (stateProof.signedBlocks.length > 0) {
        _block = abi.decode(stateProof.signedBlocks[stateProof.signedBlocks.length - 1].encodedBlock, (Block));
    } else {
        if (milestones[milestones.length - 1].blockConfirmations.length == 0) {
            return (false, _block); // an honest state proof should always have at least one block
        }
        BlockConfirmation[] memory blockConfirmations = milestones[milestones.length - 1].blockConfirmations;
        _block = abi.decode(blockConfirmations[blockConfirmations.length - 1].signedBlock.encodedBlock, (Block));
    }
    return (true, _block);
}

function _getMilestoneBlocks(StateProof memory stateProof) pure returns (Block[] memory) {
    if (stateProof.milestones.length == 0) {
        return new Block[](0);
    }
    Block[] memory milestoneBlocks = new Block[](stateProof.milestones.length);
    for (uint256 i = 0; i < stateProof.milestones.length; i++) {
        if (stateProof.milestones[i].blockConfirmations.length == 0) {
            return new Block[](0); // an honest milestone should always have at least one block
        }
        milestoneBlocks[i] =
            abi.decode(stateProof.milestones[i].blockConfirmations[0].signedBlock.encodedBlock, (Block));
    }
    return milestoneBlocks;
}

//not used anywhere right now
function _isEvidencePeriodExpired(DisputeWindow storage disputeWindow, uint256 evidenceTime) view returns (bool) {
    return block.timestamp > disputeWindow.evidence.creationTimestamp + evidenceTime;
}

function _isKillPeriodExpired(DisputeWindow storage disputeWindow, uint256 killTime) view returns (bool) {
    return block.timestamp > disputeWindow.evidence.creationTimestamp + killTime;
}

function areDisputesCommitted(DisputeWindow storage disputeWindow, Dispute[] memory disputes) view returns (bool) {
    if (disputes.length != disputeWindow.evidence.disputeCommitments.length) {
        return false;
    }
    for (uint256 i = 0; i < disputes.length; i++) {
        bytes32 commitment = keccak256(abi.encode(disputes[i]));
        // off-chain client puts the disputes in correct order - save on gas
        if (disputeWindow.evidence.disputeCommitments[i] != commitment) {
            return false;
        }
    }
    return true;
}
