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
     * at that height, not which blocks lie below it. When the dispute's latest finalized point
     * (`_latestFinalizedInbound`) consumed more inbound blocks than F, and those extra blocks hold a JOIN of an address
     * outside F's participants, F is no evidence against it: F's history never counted that joiner. Extra blocks that
     * only top up F's participants do not refuse the kill. When that point is the walk's start, F walked from it passes.
     * `slashes` are the addresses that signed both conflicting final points: F's finality signer set (`_directSignersIn`)
     * members whose own signature is on the dispute's block, when that block is a final point of the dispute (the
     * first block of a milestone, but not an unfinalized genesis block zero). A tail block, or F as the walk's start,
     * slashes nobody.
     */
    function isDisputeConflictingWithFinalState(Dispute memory dispute, DisputeConflictsWithFinalState memory proof)
        public
        view
        returns (bool, address[] memory slashes)
    {
        (bool isFinal, StateSnapshot memory finalPoint, address[] memory finalSigners) =
            _killFinalPointOf(dispute, proof.finalProof);
        MilestoneProof[] memory milestones = dispute.input.stateProof.milestones;
        if (!isFinal || proof.milestoneIndex >= milestones.length) return (false, slashes);
        MilestoneProof memory milestone = milestones[proof.milestoneIndex];
        if (proof.blockIndex >= milestone.blockConfirmations.length) return (false, slashes);
        WalkCursor memory cursor;
        cursor.start = stateSnapshots[dispute.input.channelId];
        cursor.useOnChainSnapshot = _canStartFromOnChainSnapshot(cursor.start, dispute.input.forkId);
        // a block the dispute's walk does not check (history below the anchor) is no conflict
        (bool isKept, bool hasHeight, uint256 fromIndex) = _checkedRunStart(milestone, cursor);
        if (!isKept || !hasHeight || proof.blockIndex < fromIndex) return (false, slashes);
        (bool decoded, Block memory conflicting) = UtilityFacet(utilityFacetAddress)
            .tryDecodeBlock(milestone.blockConfirmations[proof.blockIndex].signedBlock.encodedBlock);
        if (
            !decoded || conflicting.transaction.header.channelId != dispute.input.channelId
                || conflicting.transaction.header.forkId != dispute.input.forkId
                || conflicting.transaction.header.transactionCnt != finalPoint.blockHeight
                || conflicting.stateSnapshotHash == keccak256(abi.encode(finalPoint))
        ) return (false, slashes);
        (bool isKnown, bool isStart,, bytes32 finalizedInboundHash) =
            _latestFinalizedInbound(dispute, proof.latestFinalizedSnapshot, proof.finalProof.genesisStateSnapshotData);
        if (!isKnown) return (false, slashes);
        if (!isStart && _hasJoinOutsideFinalPoint(dispute.input.channelId, finalPoint, finalizedInboundHash)) {
            return (false, slashes);
        }
        // the start as the dispute's latest finalized point is a last milestone without a final first block
        if (proof.blockIndex == 0 && !(isStart && proof.milestoneIndex == milestones.length - 1)) {
            slashes = _directSignersIn(milestone.blockConfirmations[0], finalSigners);
        }
        return (true, slashes);
    }

    /// The dispute's latest finalized point, whose inbound head is `finalizedInboundHash`, consumed more inbound blocks
    /// than F (`finalPoint`) and those extra blocks hold a JOIN of an address outside F's participants.
    function _hasJoinOutsideFinalPoint(bytes32 channelId, StateSnapshot memory finalPoint, bytes32 finalizedInboundHash)
        internal
        view
        returns (bool)
    {
        // F is walked from the same start, and a walk never lowers the inbound height
        bytes32 finalInboundHash = finalPoint.snapshotData.latestInboundMessageBlockHash;
        if (_inboundHeightOf(channelId, finalInboundHash) >= _inboundHeightOf(channelId, finalizedInboundHash)) {
            return false;
        }
        return _hasJoinOutside(channelId, finalizedInboundHash, finalInboundHash, finalPoint.snapshotData.participants);
    }

    /**
     * The dispute's latest finalized point G (`_latestFinalizedInbound`) is above a threshold-final state F of the same
     * fork (`proof.finalProof`), G's snapshot consumed fewer inbound blocks than F's, and the inbound blocks F consumed
     * above G's head hold a JOIN of an address outside G's participants: on one history the inbound height never goes
     * down, so G's history skipped that JOIN and never needed the signature of the joiner F counted. Skipped blocks
     * that only top up G's participants are no kill. Only the latest finalized point is compared, never an earlier
     * milestone. The walk's start (the anchor or the fork genesis) as that point is never above F, which is walked
     * from it. The proof names that JOIN's block (`joinInboundBlockHash`): the chain holds one inbound chain, so a
     * stored block whose height lies above G's head and at most F's head is one F consumed and G skipped. F's head
     * must be a stored block and G's head a stored block or the anchor's inbound head, else the check reverts with
     * `ErrorInboundMessageBlockNotStored`; a missing inbound block inside F's walk reverts the same way, so neither
     * kills nor slashes. `slashes` are the addresses that signed both conflicting final points: F's finality signer
     * set members whose own signature is on G (`_directSignersIn`); F as the walk's start slashes nobody.
     */
    function isDisputeFinalPointRegression(Dispute memory dispute, DisputeFinalPointRegression memory proof)
        public
        view
        returns (bool, address[] memory slashes)
    {
        (bool isKnown, bool isStart, uint256 finalizedHeight, bytes32 finalizedInboundHash) =
            _latestFinalizedInbound(dispute, proof.latestFinalizedSnapshot, proof.finalProof.genesisStateSnapshotData);
        // the height check below also refuses the start; this skips the walk of F
        if (!isKnown || isStart) return (false, slashes);
        (bool isFinal, StateSnapshot memory finalPoint, address[] memory finalSigners) =
            _killFinalPointOf(dispute, proof.finalProof);
        if (!isFinal || finalizedHeight <= finalPoint.blockHeight) return (false, slashes);
        bytes32 channelId = dispute.input.channelId;
        // G's head may be the anchor's unstored inbound head: every block above it is stored
        uint256 finalizedInboundHeight = _inboundHeightOf(channelId, finalizedInboundHash);
        uint256 finalInboundHeight =
            _storedInboundHeightOf(channelId, finalPoint.snapshotData.latestInboundMessageBlockHash);
        if (finalizedInboundHeight >= finalInboundHeight) return (false, slashes);
        // the hint replaces a walk of the skipped run: F's own walk already read it
        if (!_hasInboundMessageBlock(channelId, proof.joinInboundBlockHash)) return (false, slashes);
        StoredInboundBlock storage joinBlock = inboundMessageBlockMap[channelId][proof.joinInboundBlockHash];
        if (joinBlock.blockHeight <= finalizedInboundHeight || joinBlock.blockHeight > finalInboundHeight) {
            return (false, slashes);
        }
        if (
            UtilityFacet(utilityFacetAddress)
                .subtractAddressArrays(joinBlock.joiners, proof.latestFinalizedSnapshot.snapshotData.participants)
                .length == 0
        ) return (false, slashes);
        MilestoneProof[] memory milestones = dispute.input.stateProof.milestones;
        return (true, _directSignersIn(milestones[milestones.length - 1].blockConfirmations[0], finalSigners));
    }

    /// The members of `signerSet` whose own signature is on `confirmation`'s block: the author's signature or a
    /// confirmation signature. A signature that does not recover is skipped; each member is listed once.
    function _directSignersIn(BlockConfirmation memory confirmation, address[] memory signerSet)
        internal
        view
        returns (address[] memory signers)
    {
        address[] memory found = new address[](signerSet.length);
        bytes memory encodedBlock = confirmation.signedBlock.encodedBlock;
        uint256 count = _tryInsertDirectSigner(encodedBlock, confirmation.signedBlock.signature, signerSet, found, 0);
        for (uint256 i = 0; i < confirmation.signatures.length; i++) {
            count = _tryInsertDirectSigner(encodedBlock, confirmation.signatures[i], signerSet, found, count);
        }
        signers = new address[](count);
        count = 0;
        for (uint256 i = 0; i < found.length; i++) {
            if (found[i] != address(0)) signers[count++] = found[i];
        }
    }

    function _tryInsertDirectSigner(
        bytes memory encodedBlock,
        bytes memory signature,
        address[] memory signerSet,
        address[] memory found,
        uint256 count
    ) internal view returns (uint256) {
        (address signer, bool isValid) =
            UtilityFacet(utilityFacetAddress).retrieveSignerAddress(encodedBlock, signature);
        if (!isValid) return count;
        return _tryInsertAddressInThresholdSet(signer, found, count, signerSet);
    }

    /// The stored height of inbound block `messageBlockHash`. A hash the chain does not store, also the anchor's
    /// unstored inbound head, reverts with `ErrorInboundMessageBlockNotStored`.
    function _storedInboundHeightOf(bytes32 channelId, bytes32 messageBlockHash) internal view returns (uint256) {
        if (!_hasInboundMessageBlock(channelId, messageBlockHash)) {
            revert ErrorInboundMessageBlockNotStored(channelId, messageBlockHash);
        }
        return inboundMessageBlockMap[channelId][messageBlockHash].blockHeight;
    }

    /// The stored inbound run above `lowerInboundHash` up to `upperInboundHash` holds a JOIN of an address outside
    /// `participants` (a top-up of a participant is no such JOIN). The run must be stored down to the lower head: a
    /// run the chain does not hold, also an upper head that is only the anchor's unstored inbound head, reverts with
    /// `ErrorInboundMessageBlockNotStored` for the upper head and never reads as a run without JOINs.
    function _hasJoinOutside(
        bytes32 channelId,
        bytes32 upperInboundHash,
        bytes32 lowerInboundHash,
        address[] memory participants
    ) internal view returns (bool) {
        if (!_isInboundRunStored(channelId, upperInboundHash, lowerInboundHash)) {
            revert ErrorInboundMessageBlockNotStored(channelId, upperInboundHash);
        }
        address[] memory joiners =
            _derivePendingParticipantsFromInboundHash(channelId, upperInboundHash, lowerInboundHash);
        return UtilityFacet(utilityFacetAddress).subtractAddressArrays(joiners, participants).length != 0;
    }

    /// The final point of `finalProof` walked from the chain's start, when the proof is on the dispute's channel and
    /// fork, walks, and ends above the fork genesis (no block commits the genesis).
    function _finalPointOf(Dispute memory dispute, ProofWalkInput memory finalProof)
        internal
        view
        returns (bool isFinal, StateSnapshot memory finalPoint)
    {
        (isFinal, finalPoint,) = _walkFinalProof(dispute, finalProof);
    }

    /// `_finalPointOf` for the two kills that read F's inbound: a hop of F whose consumed inbound run the chain does
    /// not store reverts with `ErrorInboundMessageBlockNotStored` for that hop's inbound head, so the challenger is
    /// not slashed for the chain's missing block. The dispute's own walk still reads such a hop as not linked.
    function _killFinalPointOf(Dispute memory dispute, ProofWalkInput memory finalProof)
        internal
        view
        returns (bool isFinal, StateSnapshot memory finalPoint, address[] memory finalSigners)
    {
        ProofWalkResult memory walk;
        (isFinal, finalPoint, walk) = _walkFinalProof(dispute, finalProof);
        if (walk.isInboundRunMissing) {
            revert ErrorInboundMessageBlockNotStored(
                finalProof.channelId,
                finalProof.milestoneSnapshots[walk.failedMilestoneIndex].snapshotData.latestInboundMessageBlockHash
            );
        }
        finalSigners = walk.finalizedSignerSet;
    }

    function _walkFinalProof(Dispute memory dispute, ProofWalkInput memory finalProof)
        internal
        view
        returns (bool isFinal, StateSnapshot memory finalPoint, ProofWalkResult memory walk)
    {
        if (finalProof.channelId != dispute.input.channelId || finalProof.forkId != dispute.input.forkId) {
            return (false, finalPoint, walk);
        }
        walk = _walkStateProof(finalProof, stateSnapshots[finalProof.channelId]);
        return (
            walk.valid && _canStartFromOnChainSnapshot(walk.finalizedSnapshot, finalProof.forkId),
            walk.finalizedSnapshot,
            walk
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
        (
            bool firstDecoded,
            bool isAnchor,
            Block memory firstBlock,
            bool canUseOnChainSnapshot,
            StateSnapshot memory anchor
        ) = _latestFinalizedPoint(dispute);
        (bool decoded, Block memory challengedBlock) =
            UtilityFacet(utilityFacetAddress).tryDecodeBlock(lastRun[blockIndex].signedBlock.encodedBlock);
        if (!firstDecoded || !decoded) return false;

        uint256 firstHeight = firstBlock.transaction.header.transactionCnt;
        uint256 boundaryEnd = 1;
        if (isAnchor) {
            boundaryEnd = anchor.blockHeight - firstHeight + 1;
        } else if (!canUseOnChainSnapshot && firstHeight == 0) {
            boundaryEnd = 0;
        }
        if (blockIndex < boundaryEnd) return false;
        return !canUseOnChainSnapshot || challengedBlock.transaction.header.transactionCnt > anchor.blockHeight;
    }

    /// The first block of the dispute's last milestone, or the same-fork anchor when that is at or above it
    /// (`isAnchor`): the protected boundary of `isBlockChallengeEligible`. It is also the dispute's latest finalized
    /// point, except under a genesis start with block zero first: there `isBlockChallengeEligible` protects nothing,
    /// and `_latestFinalizedInbound` decides whether block zero is final. False `firstDecoded` when the proof has no
    /// last-milestone block or that block does not decode.
    function _latestFinalizedPoint(Dispute memory dispute)
        internal
        view
        returns (
            bool firstDecoded,
            bool isAnchor,
            Block memory firstBlock,
            bool canUseOnChainSnapshot,
            StateSnapshot memory anchor
        )
    {
        (canUseOnChainSnapshot, anchor) = _getAnchorSnapshot(dispute.input.channelId, dispute.input.forkId);
        MilestoneProof[] memory milestones = dispute.input.stateProof.milestones;
        if (milestones.length == 0) return (false, false, firstBlock, canUseOnChainSnapshot, anchor);
        BlockConfirmation[] memory lastRun = milestones[milestones.length - 1].blockConfirmations;
        if (lastRun.length == 0) return (false, false, firstBlock, canUseOnChainSnapshot, anchor);
        (firstDecoded, firstBlock) =
            UtilityFacet(utilityFacetAddress).tryDecodeBlock(lastRun[0].signedBlock.encodedBlock);
        isAnchor =
            firstDecoded && canUseOnChainSnapshot && firstBlock.transaction.header.transactionCnt <= anchor.blockHeight;
    }

    /// The height and inbound head of the dispute's latest finalized point G (`_latestFinalizedPoint`). The anchor as
    /// G is read from the chain; a block as G must be on the dispute's channel and fork and commit `finalizedSnapshot`.
    /// Under a genesis start, block zero is G only when the dispute's last milestone finalizes it (walked with
    /// `genesisStateSnapshotData`); an unfinalized block zero finalizes nothing, so G is the fork genesis. `isStart` when
    /// G is the walk's start (the anchor or the fork genesis). False `isKnown` when G cannot be read, the snapshot is not
    /// the one its block commits, or the last milestone does not walk from the genesis.
    function _latestFinalizedInbound(
        Dispute memory dispute,
        StateSnapshot memory finalizedSnapshot,
        SnapshotData memory genesisStateSnapshotData
    ) internal view returns (bool isKnown, bool isStart, uint256 height, bytes32 inboundHash) {
        (
            bool firstDecoded,
            bool atAnchor,
            Block memory firstBlock,
            bool canUseOnChainSnapshot,
            StateSnapshot memory anchor
        ) = _latestFinalizedPoint(dispute);
        if (!firstDecoded) return (false, false, 0, bytes32(0));
        if (atAnchor) return (true, true, anchor.blockHeight, anchor.snapshotData.latestInboundMessageBlockHash);
        if (
            firstBlock.transaction.header.channelId != dispute.input.channelId
                || firstBlock.transaction.header.forkId != dispute.input.forkId
                || firstBlock.stateSnapshotHash != keccak256(abi.encode(finalizedSnapshot))
        ) return (false, false, 0, bytes32(0));
        if (!canUseOnChainSnapshot && firstBlock.transaction.header.transactionCnt == 0) {
            (bool isWalked, StateSnapshot memory finalized) =
                _genesisZeroFinalizedSnapshot(dispute, finalizedSnapshot, genesisStateSnapshotData);
            if (!isWalked) return (false, false, 0, bytes32(0));
            if (keccak256(abi.encode(finalized)) != firstBlock.stateSnapshotHash) {
                return (true, true, 0, finalized.snapshotData.latestInboundMessageBlockHash);
            }
        }
        return (
            true,
            false,
            firstBlock.transaction.header.transactionCnt,
            finalizedSnapshot.snapshotData.latestInboundMessageBlockHash
        );
    }

    /// The walk of the dispute's last milestone alone from the fork genesis, with `finalizedSnapshot` as its hop
    /// evidence: its finalized snapshot is block zero's when the run reaches the threshold, else the genesis.
    function _genesisZeroFinalizedSnapshot(
        Dispute memory dispute,
        StateSnapshot memory finalizedSnapshot,
        SnapshotData memory genesisStateSnapshotData
    ) internal view returns (bool isWalked, StateSnapshot memory finalized) {
        MilestoneProof[] memory milestones = dispute.input.stateProof.milestones;
        ProofWalkInput memory input;
        input.channelId = dispute.input.channelId;
        input.forkId = dispute.input.forkId;
        input.stateProof.milestones = new MilestoneProof[](1);
        input.stateProof.milestones[0] = milestones[milestones.length - 1];
        input.genesisStateSnapshotData = genesisStateSnapshotData;
        input.milestoneSnapshots = new StateSnapshot[](1);
        input.milestoneSnapshots[0] = finalizedSnapshot;
        ProofWalkResult memory walk = _walkStateProof(input, stateSnapshots[input.channelId]);
        return (walk.valid, walk.finalizedSnapshot);
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
