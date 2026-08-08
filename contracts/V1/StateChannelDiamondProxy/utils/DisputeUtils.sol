pragma solidity ^0.8.8;

import "../../types/DisputeTypes.sol";
import "./BlockUtils.sol";
import "./GeneralUtils.sol";

function _getDisputeChannel(Dispute memory dispute) pure returns (bytes32) {
    return dispute.input.channelId;
}

function _getDisputeFork(Dispute memory dispute) pure returns (bytes32) {
    return dispute.input.forkId;
}

function _areDisputeAndBlockSameFork(Dispute memory dispute, Block memory _block) pure returns (bool) {
    return _getBlockFork(_block) == _getDisputeFork(dispute);
}

function _areDisputeAndBlockSameChannel(Dispute memory dispute, Block memory _block) pure returns (bool) {
    return _getBlockChannel(_block) == _getDisputeChannel(dispute);
}

function _getLatestBlock(StateProof memory stateProof) pure returns (bool hasBlock, Block memory) {
    Block memory _block;
    (bool _hasBlock, SignedBlock memory latestSignedBlock) = _getLatestSignedBlock(stateProof);
    if (_hasBlock) _block = abi.decode(latestSignedBlock.encodedBlock, (Block));
    return (_hasBlock, _block);
}

function _getLatestSignedBlock(StateProof memory stateProof) pure returns (bool hasBlock, SignedBlock memory) {
    SignedBlock memory signedBlock;
    MilestoneProof[] memory milestones = stateProof.milestones;
    if (milestones.length == 0 && stateProof.signedBlocks.length == 0) {
        return (false, signedBlock);
    }
    if (stateProof.signedBlocks.length > 0) {
        signedBlock = stateProof.signedBlocks[stateProof.signedBlocks.length - 1];
    } else {
        if (milestones[milestones.length - 1].blockConfirmations.length == 0) {
            return (false, signedBlock); // an honest milestone should always have at least one block
        }
        BlockConfirmation[] memory blockConfirmations = milestones[milestones.length - 1].blockConfirmations;
        signedBlock = blockConfirmations[blockConfirmations.length - 1].signedBlock;
    }
    return (true, signedBlock);
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

function _getUnfinalizedBlockConfirmationsFromStateProof(StateProof memory stateProof)
    pure
    returns (BlockConfirmation[] memory)
{
    BlockConfirmation[] memory blockConfirmations = new BlockConfirmation[](0);
    if (stateProof.milestones.length > 0) {
        MilestoneProof memory lastMilestone = stateProof.milestones[stateProof.milestones.length - 1];
        if (lastMilestone.blockConfirmations.length == 0) {
            return blockConfirmations;
        }
        // skip first block - the first block is finalized
        blockConfirmations = new BlockConfirmation[](lastMilestone.blockConfirmations.length - 1);
        for (uint256 i = 1; i < lastMilestone.blockConfirmations.length; i++) {
            blockConfirmations[i - 1] = lastMilestone.blockConfirmations[i];
        }
        return blockConfirmations;
    }
    // no milestone -> signedBlocks
    blockConfirmations = new BlockConfirmation[](stateProof.signedBlocks.length);
    for (uint256 i = 0; i < stateProof.signedBlocks.length; i++) {
        blockConfirmations[i] = BlockConfirmation({signedBlock: stateProof.signedBlocks[i], signatures: new bytes[](0)});
    }

    return blockConfirmations;
}

//not used anywhere right now
function _isEvidencePeriodExpired(DisputeWindow storage disputeWindow, uint256 evidenceTime) view returns (bool) {
    return block.timestamp >= disputeWindow.evidence.creationTimestamp + evidenceTime
        && _isDisputeWidnowCreated(disputeWindow);
}

function _isKillPeriodExpired(DisputeWindow storage disputeWindow, uint256 evidenceTime) view returns (bool, uint256) {
    uint256 killPeriodEnd = disputeWindow.evidence.lastEvidenceSubmissionTimestamp + evidenceTime;
    bool isExpired = block.timestamp >= killPeriodEnd && _isDisputeWidnowCreated(disputeWindow);
    return (isExpired, killPeriodEnd);
}

function _isReduceChallengePeriodExpired(DisputeWindow storage disputeWindow, uint256 evidenceTime)
    view
    returns (bool)
{
    return block.timestamp >= disputeWindow.reducedResult.timestamp + evidenceTime
        && disputeWindow.reducedResult.timestamp != 0 && _isDisputeWidnowCreated(disputeWindow);
}

function _isDisputeWidnowCreated(DisputeWindow storage disputeWindow) view returns (bool) {
    return disputeWindow.evidence.creationTimestamp != 0;
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

function _hadParticipantPostedEvidence(DisputeWindow storage disputeWindow, address participant) view returns (bool) {
    address[] memory hasPosted = disputeWindow.evidence.hasPosted;
    for (uint256 i = 0; i < hasPosted.length; i++) {
        if (hasPosted[i] == participant) return true;
    }
    return false;
}

function _hasDisputeReason(DisputeInput memory input, StateSnapshot memory latestStateSnapshot) pure returns (bool) {
    bool isForcedInboundMessage =
        input.lastInboundMessageBlockHeight > latestStateSnapshot.snapshotData.latestInboundMessageBlockHeight;
    // onChainSlashes counts as a reason only when every entry is still in
    // latestStateSnapshot.participants — already-slashed (and thus removed)
    // participants can't be slashed again.
    bool hasValidOnChainSlash = input.onChainSlashes.length > 0;
    for (uint256 i = 0; hasValidOnChainSlash && i < input.onChainSlashes.length; i++) {
        hasValidOnChainSlash = _isAddressInArray(latestStateSnapshot.snapshotData.participants, input.onChainSlashes[i]);
    }
    return
        input.timeout.participant != address(0) || hasValidOnChainSlash || input.selfRemoval || isForcedInboundMessage;
}

function _isSnapshotLinkedToLatestBlock(Dispute memory dispute, StateSnapshot memory latestStateSnapshot)
    pure
    returns (bool)
{
    bytes32 snapshotHash = keccak256(abi.encode(latestStateSnapshot));

    (bool hasBlock, Block memory latestBlock) = _getLatestBlock(dispute.input.stateProof);
    if (hasBlock) {
        return latestBlock.stateSnapshotHash == snapshotHash;
    }

    return dispute.input.forkId == keccak256(abi.encode(latestStateSnapshot.snapshotData));
}

function _isDisputeInboundAnchorBehindLatestState(Dispute memory dispute, StateSnapshot memory latestStateSnapshot)
    pure
    returns (bool)
{
    // pin latestStateSnapshot to dispute.input.latestStateSnapshotHash -> both
    // heights come from the signed dispute, so a supplied latestStateSnapshot
    // can't frame an honest disputer
    if (keccak256(abi.encode(latestStateSnapshot)) != dispute.input.latestStateSnapshotHash) return false;
    if (!_isSnapshotLinkedToLatestBlock(dispute, latestStateSnapshot)) return false;

    uint256 snapshotHeight = latestStateSnapshot.snapshotData.latestInboundMessageBlockHeight;
    bytes32 snapshotInboundHash = latestStateSnapshot.snapshotData.latestInboundMessageBlockHash;
    if (dispute.input.lastInboundMessageBlockHeight < snapshotHeight) return true;
    // equal heights but a different latestInboundMessageBlockHash -> a block the
    // walk from snapshotData.latestInboundMessageBlockHash never reaches
    return dispute.input.lastInboundMessageBlockHeight == snapshotHeight
        && dispute.input.latestInboundMessageBlockHash != snapshotInboundHash;
}

function _hasStateProofHeaderMismatch(Dispute memory dispute) pure returns (bool) {
    bytes32 channelId = dispute.input.channelId;
    bytes32 forkId = dispute.input.forkId;
    StateProof memory sp = dispute.input.stateProof;

    for (uint256 i = 0; i < sp.signedBlocks.length; i++) {
        Block memory b = abi.decode(sp.signedBlocks[i].encodedBlock, (Block));
        if (b.transaction.header.channelId != channelId || b.transaction.header.forkId != forkId) return true;
    }
    for (uint256 m = 0; m < sp.milestones.length; m++) {
        BlockConfirmation[] memory bcs = sp.milestones[m].blockConfirmations;
        for (uint256 j = 0; j < bcs.length; j++) {
            Block memory mb = abi.decode(bcs[j].signedBlock.encodedBlock, (Block));
            if (mb.transaction.header.channelId != channelId || mb.transaction.header.forkId != forkId) return true;
        }
    }
    return false;
}
