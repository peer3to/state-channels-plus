pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./UtilityFacet.sol";
import "./Errors.sol";
import "../types/DisputeFraudProofTypes.sol";

contract StateProofFacet is StateChannelCommon {
    function isCorrectLatestState(Dispute memory dispute, SnapshotData memory genesisStateSnapshotData)
        public
        view
        virtual
        returns (bool)
    {
        (bool hasBlock, SignedBlock memory latestSignedBlock) = _getLatestSignedBlock(dispute.input.stateProof);
        if (hasBlock) {
            (bool decoded, Block memory latestBlock) =
                UtilityFacet(utilityFacetAddress).tryDecodeBlock(latestSignedBlock.encodedBlock);
            return decoded && latestBlock.stateSnapshotHash == dispute.input.latestStateSnapshotHash;
        }

        if (!_isGenesisSnapshotDataLinkedToFork(dispute.input.forkId, genesisStateSnapshotData)) {
            return false;
        }

        (bool hasGenesisTimestamp, uint256 genesisTimestamp) =
            _getGenesisTimestamp(dispute.input.channelId, genesisStateSnapshotData.originForkId, dispute.input.forkId);
        if (!hasGenesisTimestamp) {
            return false;
        }

        StateSnapshot memory genesisStateSnapshot = StateSnapshot({
            snapshotData: genesisStateSnapshotData,
            forkId: dispute.input.forkId,
            blockHeight: 0,
            timestamp: genesisTimestamp
        });
        return (dispute.input.latestStateSnapshotHash == keccak256(abi.encode(genesisStateSnapshot)));
    }

    /**
     * The invalid-state-proof counter, judged on one step: the proof's latest state is not the dispute's, or the
     * pointed step of the walk from the on-chain anchor fails. With posted data the committed auditing data is the
     * evidence: its hash is checked (linear in the posted data, as the dispute's own commitment hash is), then only
     * the step's entries are read; a committed snapshot its block does not commit to is the disputer's fault. With
     * omitted data the challenger supplies the genesis data and the step's snapshots; evidence that does not fit makes
     * the challenge invalid.
     */
    function isStateProofStepInvalid(Dispute memory dispute, DisputeInvalidStateProof memory proof)
        public
        view
        returns (bool)
    {
        DisputeAuditingData memory data = proof.auditingData;
        uint256 milestoneIndex = proof.milestoneIndex;
        StateSnapshot memory previousSnapshot = proof.previousStateSnapshot;
        StateSnapshot memory resultingSnapshot = proof.resultingStateSnapshot;
        if (dispute.postedAuditingData) {
            if (dispute.input.disputeAuditingDataHash != keccak256(abi.encode(data))) return false;
            if (dispute.input.latestStateSnapshotHash != keccak256(abi.encode(data.latestStateSnapshot))) return true;
            // the committed data holds one snapshot per milestone
            if (data.milestoneSnapshots.length != dispute.input.stateProof.milestones.length) return true;
            if (milestoneIndex < data.milestoneSnapshots.length) {
                resultingSnapshot = data.milestoneSnapshots[milestoneIndex];
                if (milestoneIndex != 0) previousSnapshot = data.milestoneSnapshots[milestoneIndex - 1];
            }
        } else if (!_isGenesisSnapshotDataLinkedToFork(dispute.input.forkId, data.genesisStateSnapshotData)) {
            // fraud prover supplies the genesis reference -> it must be linked to the fork
            return false;
        }
        if (!isCorrectLatestState(dispute, data.genesisStateSnapshotData)) return true;
        (bool isFault, bool snapshotMismatch) = _isStateProofStepFault(
            ProofWalkInput(
                dispute.input.channelId,
                dispute.input.forkId,
                dispute.input.stateProof,
                data.genesisStateSnapshotData,
                new StateSnapshot[](0)
            ),
            stateSnapshots[dispute.input.channelId],
            milestoneIndex,
            proof.hasBlockIndex,
            proof.blockIndex,
            previousSnapshot,
            resultingSnapshot
        );
        return isFault || (snapshotMismatch && dispute.postedAuditingData);
    }

    /// The committed posted auditing data's outbound run does not link the chain anchor's outbound head to the
    /// dispute's latest state (`_outboundRunAboveAnchor`): a block above the anchor is missing, forged or extra. Data
    /// that is not posted, not committed, or whose latest state is not the dispute's is no evidence here.
    function isDisputeOutboundRunInvalid(Dispute memory dispute, DisputeInvalidOutboundRun memory proof)
        public
        view
        returns (bool)
    {
        DisputeAuditingData memory data = proof.auditingData;
        if (!dispute.postedAuditingData || dispute.input.disputeAuditingDataHash != keccak256(abi.encode(data))) {
            return false;
        }
        if (dispute.input.latestStateSnapshotHash != keccak256(abi.encode(data.latestStateSnapshot))) return false;
        (bool isValid,) = _outboundRunAboveAnchor(
            data.outboundMessageBlocks,
            stateSnapshots[dispute.input.channelId].snapshotData,
            data.latestStateSnapshot.snapshotData
        );
        return !isValid;
    }

    /// The on-chain anchor of `forkId`; see `_getAnchorSnapshot`.
    function getAnchorSnapshot(bytes32 channelId, bytes32 forkId)
        public
        view
        returns (bool canUseOnChainSnapshot, StateSnapshot memory onChainSnapshot)
    {
        return _getAnchorSnapshot(channelId, forkId);
    }

    /// The state-proof walk with finality, from the anchor this contract's storage holds.
    function verifyMilestones(ProofWalkInput memory input) public view virtual returns (ProofWalkResult memory) {
        return _walkStateProof(input, stateSnapshots[input.channelId]);
    }

    /// The dispute's latest state is strictly below the same-fork non-genesis on-chain anchor, which is already
    /// final. An empty proof claims the fork genesis, which that anchor is past even at equal height zero.
    function isStateProofBelowOnChainAnchor(Dispute memory dispute) public view returns (bool) {
        (bool canUseOnChainSnapshot, StateSnapshot memory onChainSnapshot) =
            _getAnchorSnapshot(dispute.input.channelId, dispute.input.forkId);
        if (!canUseOnChainSnapshot) return false;
        if (dispute.input.stateProof.milestones.length == 0) return true;
        (bool hasBlock, SignedBlock memory latestSignedBlock) = _getLatestSignedBlock(dispute.input.stateProof);
        if (!hasBlock) return false;
        (bool decoded, Block memory latestBlock) =
            UtilityFacet(utilityFacetAddress).tryDecodeBlock(latestSignedBlock.encodedBlock);
        return decoded && latestBlock.transaction.header.transactionCnt < onChainSnapshot.blockHeight;
    }

    /// The dispute's timeout names a height that a threshold-final state on the same fork already reaches: the
    /// same-fork chain anchor, or the final point of `proof.finalProof` walked from the chain's start.
    function isTimeoutSupersededByFinalState(Dispute memory dispute, TimeoutSupersededByFinalState memory proof)
        public
        view
        returns (bool)
    {
        Timeout memory timeout = dispute.input.timeout;
        if (timeout.participant == address(0)) return false;
        (bool canUseOnChainSnapshot, StateSnapshot memory anchor) =
            _getAnchorSnapshot(dispute.input.channelId, dispute.input.forkId);
        if (canUseOnChainSnapshot && anchor.blockHeight >= timeout.blockHeight) return true;
        (bool isFinal, StateSnapshot memory finalPoint) = _finalPointOf(dispute, proof.finalProof);
        return isFinal && finalPoint.blockHeight >= timeout.blockHeight;
    }

    /**
     * The dispute's block at `blockIndex` of milestone `milestoneIndex`, one its walk checks, is at the height of a
     * threshold-final state F of the same fork (`proof.finalProof`) and commits another snapshot: the dispute's
     * history conflicts with the final history. Only F's own height is compared: the final proof proves the snapshot
     * at that height, not which blocks lie below it.
     */
    function isDisputeConflictingWithFinalState(Dispute memory dispute, DisputeConflictsWithFinalState memory proof)
        public
        view
        returns (bool)
    {
        (bool isFinal, StateSnapshot memory finalPoint) = _finalPointOf(dispute, proof.finalProof);
        MilestoneProof[] memory milestones = dispute.input.stateProof.milestones;
        if (!isFinal || proof.milestoneIndex >= milestones.length) return false;
        MilestoneProof memory milestone = milestones[proof.milestoneIndex];
        if (proof.blockIndex >= milestone.blockConfirmations.length) return false;
        WalkCursor memory cursor;
        cursor.start = stateSnapshots[dispute.input.channelId];
        cursor.useOnChainSnapshot = _canStartFromOnChainSnapshot(cursor.start, dispute.input.forkId);
        // a block the dispute's walk does not check (history below the anchor) is no conflict
        (bool isKept, bool hasHeight, uint256 fromIndex) = _checkedRunStart(milestone, cursor);
        if (!isKept || !hasHeight || proof.blockIndex < fromIndex) return false;
        (bool decoded, Block memory conflicting) = UtilityFacet(utilityFacetAddress).tryDecodeBlock(
            milestone.blockConfirmations[proof.blockIndex].signedBlock.encodedBlock
        );
        return decoded && conflicting.transaction.header.channelId == dispute.input.channelId
            && conflicting.transaction.header.forkId == dispute.input.forkId
            && conflicting.transaction.header.transactionCnt == finalPoint.blockHeight
            && conflicting.stateSnapshotHash != keccak256(abi.encode(finalPoint));
    }

    /// The final point of `finalProof` walked from the chain's start, when the proof is on the dispute's channel and
    /// fork, walks, and ends above the fork genesis (no block commits the genesis).
    function _finalPointOf(Dispute memory dispute, ProofWalkInput memory finalProof)
        internal
        view
        returns (bool isFinal, StateSnapshot memory finalPoint)
    {
        if (finalProof.channelId != dispute.input.channelId || finalProof.forkId != dispute.input.forkId) {
            return (false, finalPoint);
        }
        ProofWalkResult memory walk = _walkStateProof(finalProof, stateSnapshots[finalProof.channelId]);
        return (
            walk.valid && _canStartFromOnChainSnapshot(walk.finalizedSnapshot, finalProof.forkId),
            walk.finalizedSnapshot
        );
    }

    /**
     * A block-specific challenge can punish the dispute submitter only for a block after the protected boundary:
     * the last milestone's first block or the same-fork anchor, whichever is later. `blockIndex` counts from the
     * start of the last milestone. With a genesis anchor, a last milestone starting at block zero leaves zero
     * eligible; block zero's resulting snapshot as the anchor protects zero.
     */
    function isBlockChallengeEligible(Dispute memory dispute, uint256 blockIndex) public view returns (bool) {
        MilestoneProof[] memory milestones = dispute.input.stateProof.milestones;
        if (milestones.length == 0) return false;
        BlockConfirmation[] memory lastRun = milestones[milestones.length - 1].blockConfirmations;
        if (blockIndex >= lastRun.length) return false;
        (bool firstDecoded, Block memory firstBlock) =
            UtilityFacet(utilityFacetAddress).tryDecodeBlock(lastRun[0].signedBlock.encodedBlock);
        (bool decoded, Block memory challengedBlock) =
            UtilityFacet(utilityFacetAddress).tryDecodeBlock(lastRun[blockIndex].signedBlock.encodedBlock);
        if (!firstDecoded || !decoded) return false;

        (bool canUseOnChainSnapshot, StateSnapshot memory anchor) =
            _getAnchorSnapshot(dispute.input.channelId, dispute.input.forkId);
        uint256 firstHeight = firstBlock.transaction.header.transactionCnt;
        uint256 boundaryEnd = 1;
        if (canUseOnChainSnapshot && firstHeight <= anchor.blockHeight) {
            boundaryEnd = anchor.blockHeight - firstHeight + 1;
        } else if (!canUseOnChainSnapshot && firstHeight == 0) {
            boundaryEnd = 0;
        }
        if (blockIndex < boundaryEnd) return false;
        return !canUseOnChainSnapshot || challengedBlock.transaction.header.transactionCnt > anchor.blockHeight;
    }

    /**
     * Input-only structure check of the last milestone's block at `blockIndex`: the block must be authentic and,
     * after the first, link to its predecessor in the same run by hash and height + 1. Out-of-range positions are no
     * offense.
     */
    function isInvalidBlockStructureInStateProof(StateProof memory stateProof, uint256 blockIndex)
        public
        view
        returns (bool)
    {
        if (stateProof.milestones.length == 0) return false;
        MilestoneProof memory lastMilestone = stateProof.milestones[stateProof.milestones.length - 1];
        if (blockIndex >= lastMilestone.blockConfirmations.length) return false;

        return _isInvalidBlockStructureInStateProof(lastMilestone, blockIndex);
    }

    function _isInvalidBlockStructureInStateProof(MilestoneProof memory milestone, uint256 blockIndex)
        internal
        view
        returns (bool)
    {
        SignedBlock memory currentSignedBlock = milestone.blockConfirmations[blockIndex].signedBlock;
        if (!_isBlockAuthentic(currentSignedBlock)) return true;
        if (blockIndex == 0) return false;

        (bool currentDecoded, Block memory currentBlock) =
            UtilityFacet(utilityFacetAddress).tryDecodeBlock(currentSignedBlock.encodedBlock);
        if (!currentDecoded) return true;

        SignedBlock memory previousSignedBlock = milestone.blockConfirmations[blockIndex - 1].signedBlock;

        (bool previousDecoded, Block memory previousBlock) =
            UtilityFacet(utilityFacetAddress).tryDecodeBlock(previousSignedBlock.encodedBlock);
        if (!previousDecoded) return true;

        return currentBlock.previousBlockHash != keccak256(previousSignedBlock.encodedBlock)
            || !_isNextHeight(previousBlock, currentBlock);
    }

    function isMilestoneFinal(
        bytes32 forkId,
        SnapshotData memory thresholdSnapshotData,
        MilestoneProof memory milestone
    ) public virtual returns (bool isFinal, bytes32 finalizedSnapshotHash) {
        (bool isLinked, uint256 thresholdCount, bytes32 fromBlockSnapshotHash,) =
            _walkMilestoneBlocks(bytes32(0), forkId, milestone, 0, thresholdSnapshotData.participants);
        if (!isLinked) return (false, bytes32(0));
        return (thresholdCount == thresholdSnapshotData.participants.length, fromBlockSnapshotHash);
    }
}
