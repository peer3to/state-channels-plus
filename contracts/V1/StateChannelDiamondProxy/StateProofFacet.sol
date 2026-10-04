pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./UtilityFacet.sol";
import "./Errors.sol";

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

    function verifyStateProof(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        virtual
        returns (bool)
    {
        // reference check - is this the auditingData the dispute committed to?
        if (dispute.input.disputeAuditingDataHash != keccak256(abi.encode(disputeAuditingData))) {
            return false;
        }

        ProofWalkInput memory input = ProofWalkInput(
            dispute.input.channelId,
            dispute.input.forkId,
            dispute.input.stateProof,
            disputeAuditingData.genesisStateSnapshotData,
            disputeAuditingData.milestoneSnapshots
        );
        ProofWalkResult memory walk = verifyMilestones(input);
        if (!walk.valid) {
            return false;
        }

        // the posted finalized state is the state of the snapshot the walk ends at
        if (
            keccak256(disputeAuditingData.latestFinalizedStateStateMachineState)
                != walk.finalizedSnapshot.snapshotData.stateMachineStateHash
        ) {
            return false;
        }

        if (!isCorrectLatestState(dispute, disputeAuditingData.genesisStateSnapshotData)) {
            return false;
        }

        //check commitment to latestStateSnapshot
        if (dispute.input.latestStateSnapshotHash != keccak256(abi.encode(disputeAuditingData.latestStateSnapshot))) {
            return false;
        }
        return true;
    }

    /// The on-chain anchor of `forkId`; see `_getAnchorSnapshot`.
    function getAnchorSnapshot(bytes32 channelId, bytes32 forkId)
        public
        view
        returns (bool canUseOnChainSnapshot, StateSnapshot memory onChainSnapshot)
    {
        return _getAnchorSnapshot(channelId, forkId);
    }

    /// The state-proof walk with finality, from the start this contract's storage holds.
    function verifyMilestones(ProofWalkInput memory input) public view virtual returns (ProofWalkResult memory) {
        return _walkStateProof(input, stateSnapshots[input.channelId], true);
    }

    /// The state-proof walk without finality: start commitment, genesis link and the links of every kept run.
    function isStateProofLinked(
        bytes32 channelId,
        bytes32 forkId,
        StateProof memory stateProof,
        SnapshotData memory genesisStateSnapshotData
    ) public view returns (bool) {
        ProofWalkInput memory input =
            ProofWalkInput(channelId, forkId, stateProof, genesisStateSnapshotData, new StateSnapshot[](0));
        return _walkStateProof(input, stateSnapshots[channelId], false).valid;
    }

    /**
     * A block challenge can punish the dispute submitter only for an unfinal block: `blockIndex` of the last
     * milestone, at or after its tail start, and above the anchor when the proof can start from it. The tail starts
     * right after the anchor when the anchor is inside the last milestone, at 0 when the only milestone starts at
     * block 0 from the genesis, else at 1 (the first block is threshold-final). Finalized history stays with its
     * original signers; the proof's validity is `DisputeInvalidStateProof`'s concern.
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
        uint256 tailStart = 1;
        if (canUseOnChainSnapshot && firstHeight <= anchor.blockHeight) {
            tailStart = anchor.blockHeight - firstHeight + 1;
        } else if (milestones.length == 1 && firstHeight == 0) {
            tailStart = 0;
        }
        if (blockIndex < tailStart) return false;
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

    /// The first position of the last milestone that fails the structure check.
    function findFirstInvalidBlockStructureInStateProof(StateProof memory stateProof)
        public
        view
        returns (bool found, uint256 blockIndex)
    {
        if (stateProof.milestones.length == 0) return (false, 0);
        MilestoneProof memory lastMilestone = stateProof.milestones[stateProof.milestones.length - 1];
        for (uint256 i = 0; i < lastMilestone.blockConfirmations.length; i++) {
            if (_isInvalidBlockStructureInStateProof(lastMilestone, i)) return (true, i);
        }
        return (false, 0);
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
        (bool isLinked, uint256 thresholdCount, bytes32 fromBlockSnapshotHash) =
            _walkMilestoneBlocks(forkId, milestone, 0, thresholdSnapshotData.participants);
        if (!isLinked) return (false, bytes32(0));
        return (thresholdCount == thresholdSnapshotData.participants.length, fromBlockSnapshotHash);
    }
}
