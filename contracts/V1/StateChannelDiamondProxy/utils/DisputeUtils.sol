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

/// The last block of the last milestone; none for an empty proof.
function _getLatestSignedBlock(StateProof memory stateProof) pure returns (bool hasBlock, SignedBlock memory) {
    SignedBlock memory signedBlock;
    MilestoneProof[] memory milestones = stateProof.milestones;
    if (milestones.length == 0) {
        return (false, signedBlock);
    }
    BlockConfirmation[] memory blockConfirmations = milestones[milestones.length - 1].blockConfirmations;
    if (blockConfirmations.length == 0) {
        return (false, signedBlock); // an honest milestone should always have at least one block
    }
    signedBlock = blockConfirmations[blockConfirmations.length - 1].signedBlock;
    return (true, signedBlock);
}

function _isEvidencePeriodExpired(DisputeWindow storage disputeWindow, uint256 evidenceTime)
    view
    returns (bool, uint256 periodEnd)
{
    uint256 evidencePeriodEnd = disputeWindow.evidence.creationTimestamp + evidenceTime;
    bool isExpired = block.timestamp >= evidencePeriodEnd && _isDisputeWidnowCreated(disputeWindow);
    return (isExpired, evidencePeriodEnd);
}

function _isKillPeriodExpired(DisputeWindow storage disputeWindow, uint256 evidenceTime) view returns (bool, uint256) {
    uint256 killPeriodEnd = disputeWindow.evidence.lastEvidenceSubmissionTimestamp + evidenceTime;
    bool isExpired = block.timestamp >= killPeriodEnd && _isDisputeWidnowCreated(disputeWindow);
    return (isExpired, killPeriodEnd);
}

function _isReduceChallengePeriodExpired(DisputeWindow storage disputeWindow, uint256 evidenceTime)
    view
    returns (bool, uint256 periodEnd)
{
    uint256 challengePeriodEnd = disputeWindow.reducedResult.timestamp + evidenceTime;
    bool isExpired = block.timestamp >= challengePeriodEnd && disputeWindow.reducedResult.timestamp != 0
        && _isDisputeWidnowCreated(disputeWindow);
    return (isExpired, challengePeriodEnd);
}

function _isDisputeWidnowCreated(DisputeWindow storage disputeWindow) view returns (bool) {
    return disputeWindow.evidence.creationTimestamp != 0;
}

/// The single owner of the dispute-commitment preimage. Everything that
/// commits, looks up, or reports a dispute commitment hashes it through here,
/// so the window contents and an error payload can never drift apart.
function _disputeCommitmentHash(Dispute memory dispute) pure returns (bytes32) {
    return keccak256(abi.encode(dispute));
}

function _disputeCommitmentHashes(Dispute[] memory disputes) pure returns (bytes32[] memory commitments) {
    commitments = new bytes32[](disputes.length);
    for (uint256 i = 0; i < disputes.length; i++) {
        commitments[i] = _disputeCommitmentHash(disputes[i]);
    }
}

function areDisputesCommitted(DisputeWindow storage disputeWindow, Dispute[] memory disputes) view returns (bool) {
    if (disputes.length != disputeWindow.evidence.disputeCommitments.length) {
        return false;
    }
    for (uint256 i = 0; i < disputes.length; i++) {
        bytes32 commitment = _disputeCommitmentHash(disputes[i]);
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

// A listed on-chain slash is valid only for a participant of the dispute's latest state, the disputed fork's
// participant state. A slash of anyone else, e.g. a participant an ancestor fork already removed, invalidates the
// dispute whatever its other reasons.
function _hasDisputeReason(DisputeInput memory input, StateSnapshot memory latestStateSnapshot) pure returns (bool) {
    for (uint256 i = 0; i < input.onChainSlashes.length; i++) {
        if (!_isAddressInArray(latestStateSnapshot.snapshotData.participants, input.onChainSlashes[i])) return false;
    }
    bool isForcedInboundMessage =
        input.lastInboundMessageBlockHeight > latestStateSnapshot.snapshotData.latestInboundMessageBlockHeight;
    return input.timeout.participant != address(0) || input.onChainSlashes.length > 0 || input.selfRemoval
        || isForcedInboundMessage || input.requireExistingDisputeWindow;
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
