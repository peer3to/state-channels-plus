pragma solidity ^0.8.8;

import "../../types/DisputeTypes.sol";
import "./BlockUtils.sol";

function _getDisputeChannel(Dispute memory dispute) pure returns (bytes32) {
    return dispute.channelId;
}

function _getDisputeFork(Dispute memory dispute) pure returns (bytes32) {
    return dispute.genesisSnapshotDataHash;
}

function _areDisputeAndBlockSameFork(Dispute memory dispute, Block memory _block) pure returns (bool) {
    return _getBlockFork(_block) == _getDisputeFork(dispute);
}

function _areDisputeAndBlockSameChannel(Dispute memory dispute, Block memory _block) pure returns (bool) {
    return _getBlockChannel(_block) == _getDisputeChannel(dispute);
}

function _getLatestBlock(StateProof memory stateProof) pure returns (Block memory) {
    return stateProof.signedBlocks.length > 0
        ? abi.decode(stateProof.signedBlocks[stateProof.signedBlocks.length - 1].encodedBlock, (Block))
        : abi.decode(
            stateProof.milestones[stateProof.milestones.length - 1].blockConfirmations[stateProof.milestones[stateProof
                .milestones
                .length - 1].blockConfirmations.length - 1].signedBlock.encodedBlock,
            (Block)
        );
}
