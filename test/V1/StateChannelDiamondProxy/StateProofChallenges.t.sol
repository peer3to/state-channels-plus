pragma solidity ^0.8.8;

import {StateProofStaging} from "../harness/StateProofStaging.sol";
import {
    DisputeInvalidStateProof,
    DisputeOnChainSlashesNotSubset
} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/DisputeTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// The dispute counters over the state proof, each applied through `applyDisputeFraudProofs` with real evidence:
/// below-anchor (U45-U48), block-specific eligibility and every block counter family at the boundary (U49-U53, U92,
/// U106, U108), the auditing-data omission rule and its counter (U34-U38, U95, U112), the invalid-state-proof counter
/// at one walk step (U107, U111, U120), departure and rejoin across hops (U100) and the balance counter on the latest
/// state (U43, U44).
// test naming: test_<plan case>_<scenario>
contract StateProofChallengesTest is StateProofStaging {
    function setUp() public {
        _stageGenesisChannel();
    }

    // ==================== U45-U48: the below-anchor counter ====================

    function test_U45_strictlyHigherSameForkAnchorCountersTheDispute() public {
        _seedAnchor(5);
        Dispute memory dispute =
            _dispute(_one(_thresholdRun(1, 3, genesisData.participants, _signers(ALICE_KEY, BOB_KEY))));
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor, _belowAnchorProof());
        _assertKilled(dispute);
    }

    function test_U45_equalHeightSameForkAnchorDoesNotCounter() public {
        _seedAnchor(5);
        // the latest block is 5, the anchor's height
        Dispute memory dispute = _dispute(_one(_run(3, 3, keccak256("block 2"), _signers(ALICE_KEY))));
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor, _belowAnchorProof());
        _assertRejected(dispute);
    }

    function test_U45_lowerSameForkAnchorDoesNotCounter() public {
        _seedAnchor(5);
        Dispute memory dispute = _dispute(_one(_run(5, 3, keccak256("block 4"), _signers(ALICE_KEY))));
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor, _belowAnchorProof());
        _assertRejected(dispute);
    }

    function test_U46_higherAnchorOnAnotherForkDoesNotCounter() public {
        StateSnapshot memory otherFork = _snapshot(10, genesisData.participants);
        otherFork.forkId = keccak256("other-fork");
        harness.seedSnapshot(CHANNEL, otherFork);
        Dispute memory dispute =
            _dispute(_one(_thresholdRun(1, 3, genesisData.participants, _signers(ALICE_KEY, BOB_KEY))));
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor, _belowAnchorProof());
        _assertRejected(dispute);
    }

    function test_U47_genesisAnchorGivesNoCounterToTheEmptyGenesisClaim() public {
        Dispute memory dispute = _dispute(new MilestoneProof[](0));
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor, _belowAnchorProof());
        _assertRejected(dispute);
    }

    function test_U47_blockZeroAnchorCountersTheEmptyGenesisClaimAtEqualHeightZero() public {
        _seedAnchor(0);
        Dispute memory dispute = _dispute(new MilestoneProof[](0));
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor, _belowAnchorProof());
        _assertKilled(dispute);
    }

    function test_U47_laterSameForkAnchorCountersTheEmptyGenesisClaim() public {
        _seedAnchor(5);
        Dispute memory dispute = _dispute(new MilestoneProof[](0));
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor, _belowAnchorProof());
        _assertKilled(dispute);
    }

    function test_U48_anchorAloneCountersADisputerThatNeverSignedIt() public {
        _seedAnchor(5);
        // D submits A's history ending at 3; D signed nothing, the challenger supplies no signature evidence
        Dispute memory dispute =
            _disputeBy(dave, _one(_thresholdRun(1, 3, genesisData.participants, _signers(ALICE_KEY, BOB_KEY))));
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor, _belowAnchorProof());
        _assertKilled(dispute);
    }

    // ==================== U49-U53: block-specific challenge eligibility ====================

    /// the last milestone [50, 53] with the anchor 51 inside it
    function _anchorInsideLastMilestone() private returns (Dispute memory dispute, MilestoneProof memory run) {
        _seedAnchor(51);
        run = _run(50, 4, keccak256("block 49"), _signers(ALICE_KEY));
        dispute = _dispute(_one(run));
    }

    function test_U49_milestoneStartBeforeTheAnchorIsIneligible() public {
        (Dispute memory dispute,) = _anchorInsideLastMilestone();
        assertFalse(_isEligible(dispute, 0));
    }

    function test_U49_anchorBlockIsIneligible() public {
        (Dispute memory dispute,) = _anchorInsideLastMilestone();
        assertFalse(_isEligible(dispute, 1));
    }

    function test_U49_firstBlockAfterTheAnchorIsEligible() public {
        (Dispute memory dispute,) = _anchorInsideLastMilestone();
        assertTrue(_isEligible(dispute, 2));
    }

    function test_U49_laterTailBlockIsEligible() public {
        (Dispute memory dispute,) = _anchorInsideLastMilestone();
        assertTrue(_isEligible(dispute, 3));
    }

    function test_U49_positionPastTheLastMilestoneIsIneligible() public {
        (Dispute memory dispute,) = _anchorInsideLastMilestone();
        assertFalse(_isEligible(dispute, 4));
    }

    function test_U49_faultAtTheAnchorBoundaryIsNotChallengeable() public {
        _seedAnchor(51);
        MilestoneProof memory run = _run(50, 4, keccak256("block 49"), _signers(ALICE_KEY));
        // block 51 does not link to 50, yet 51 still commits the anchor
        _breakLinkAt(run, 1);
        Dispute memory dispute = _dispute(_one(run));
        _commit(dispute);
        assertTrue(_diamond().isInvalidBlockStructureInStateProof(dispute.input.stateProof, 1), "a real fault");
        _apply(dispute, DisputeFraudProofType.DisputeInvalidBlockStructure, _structureProof(1));
        _assertRejected(dispute);
    }

    function test_U49_positionAfterTheBoundaryNamesTheSameBlockWithTheAnchorMidMilestone() public {
        _seedAnchor(51);
        MilestoneProof memory run = _run(50, 4, keccak256("block 49"), _signers(ALICE_KEY));
        _breakLinkAt(run, 2);
        Dispute memory dispute = _dispute(_one(run));
        _commit(dispute);
        assertEq(_decode(run, 2).transaction.header.transactionCnt, 52, "position 2 is block 52");
        _apply(dispute, DisputeFraudProofType.DisputeInvalidBlockStructure, _structureProof(2));
        _assertKilled(dispute);
    }

    function test_U49_positionAfterTheBoundaryNamesTheSameBlockWithTheAnchorAtTheMilestoneStart() public {
        _seedAnchor(50);
        MilestoneProof memory run = _run(50, 4, keccak256("block 49"), _signers(ALICE_KEY));
        _breakLinkAt(run, 2);
        Dispute memory dispute = _dispute(_one(run));
        _commit(dispute);
        assertEq(_decode(run, 2).transaction.header.transactionCnt, 52, "position 2 is block 52");
        _apply(dispute, DisputeFraudProofType.DisputeInvalidBlockStructure, _structureProof(2));
        _assertKilled(dispute);
    }

    function test_U50_unfinalizedZeroWithAGenesisAnchorIsEligible() public view {
        Dispute memory dispute = _dispute(_one(_genesisRun(3, genesisData.participants, _signers(ALICE_KEY))));
        assertTrue(_isEligible(dispute, 0));
    }

    function test_U50_thresholdFinalZeroWithAGenesisAnchorIsEligible() public view {
        Dispute memory dispute = _dispute(_one(_genesisRun(3, genesisData.participants, _signers(ALICE_KEY, BOB_KEY))));
        assertTrue(_isEligible(dispute, 0));
    }

    function test_U50_unfinalizedZeroWithAGenesisAnchorIsKilledByABlockChallenge() public {
        MilestoneProof memory run = _genesisRun(3, genesisData.participants, _signers(ALICE_KEY));
        _badAuthorAt(run, 0);
        _assertStructureVerdict(run, 0, true);
    }

    function test_U50_blockZeroResultingSnapshotAnchorProtectsZero() public {
        _seedAnchor(0);
        Dispute memory dispute = _dispute(_one(_genesisRun(3, genesisData.participants, _signers(ALICE_KEY))));
        assertFalse(_isEligible(dispute, 0), "zero is the anchor");
        assertTrue(_isEligible(dispute, 1), "one is after it");
    }

    function test_U51_earlierMilestoneBlockCannotBeNamedByABlockChallenge() public {
        uint256[] memory both = _signers(ALICE_KEY, BOB_KEY);
        // the earlier run's block 2 is dated before block 1: a genuine block fault
        MilestoneProof memory earlier = _genesisRun(3, genesisData.participants, both);
        _backdateAt(earlier, 2, _signers(ALICE_KEY));
        MilestoneProof memory last = _thresholdRun(5, 2, genesisData.participants, both);
        Dispute memory dispute = _dispute(_two(earlier, last));
        _commit(dispute);
        assertEq(harness.judgeFraudProof(CHANNEL, _invalidTimestampAt(earlier, 2)), alice, "premise: a real fault");
        assertFalse(_isEligible(dispute, 2), "position 2 is outside the last milestone");
        _apply(
            dispute,
            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
            _applyProof(_invalidTimestampAt(earlier, 2), 2)
        );
        _assertRejected(dispute);
    }

    function test_U52_anchorOnlyLastMilestoneHasNoCandidate() public {
        _seedAnchor(5);
        Dispute memory dispute = _dispute(_one(_run(5, 1, keccak256("block 4"), _signers(ALICE_KEY))));
        assertFalse(_isEligible(dispute, 0));
        assertFalse(_isEligible(dispute, 1));
    }

    function test_U52_singleThresholdFinalLastMilestoneHasNoCandidate() public view {
        Dispute memory dispute =
            _dispute(_one(_thresholdRun(5, 1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY))));
        assertFalse(_isEligible(dispute, 0));
        assertFalse(_isEligible(dispute, 1));
    }

    function test_U53_anchorAdvancingAcrossTheTargetMakesItIneligible() public {
        MilestoneProof memory run = _thresholdRun(3, 5, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        _breakLinkAt(run, 2);
        Dispute memory dispute = _dispute(_one(run));
        _commit(dispute);
        assertTrue(_isEligible(dispute, 2), "block 5 is unfinalized");

        // the chain adopts block 6's snapshot before the challenge is judged
        harness.seedSnapshot(CHANNEL, _snapshot(6, genesisData.participants));
        assertFalse(_isEligible(dispute, 2), "block 5 is now final history");
        _apply(dispute, DisputeFraudProofType.DisputeInvalidBlockStructure, _structureProof(2));
        _assertRejected(dispute);
    }

    // ==================== U92: every block counter family at the boundary ====================

    /// the anchor is block zero's resulting snapshot and the last milestone [0, 2] starts at it
    function _zeroAnchoredRun() private returns (MilestoneProof memory) {
        _seedAnchor(0);
        return _genesisRun(3, genesisData.participants, _signers(ALICE_KEY));
    }

    /// a genesis anchor and the last milestone [0, 2] whose block 0 carries A's and B's signatures
    function _thresholdZeroRun() private view returns (MilestoneProof memory) {
        return _genesisRun(3, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
    }

    /// a genesis anchor and the last milestone [5, 7] whose first block is threshold-final
    function _laterFinalRun() private view returns (MilestoneProof memory) {
        return _thresholdRun(5, 3, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
    }

    // -- structure --

    function test_U92_structureAtAnchorFinalZeroIsNotChallengeable() public {
        MilestoneProof memory run = _zeroAnchoredRun();
        _badAuthorAt(run, 0);
        _assertStructureVerdict(run, 0, false);
    }

    function test_U92_structureAtThresholdFinalZeroIsChallengeable() public {
        MilestoneProof memory run = _thresholdZeroRun();
        _badAuthorAt(run, 0);
        _assertStructureVerdict(run, 0, true);
    }

    function test_U92_structureAtALaterFinalPointIsNotChallengeable() public {
        MilestoneProof memory run = _laterFinalRun();
        _badAuthorAt(run, 0);
        _assertStructureVerdict(run, 0, false);
    }

    function test_U92_structureInTheUnfinalizedTailIsChallengeable() public {
        MilestoneProof memory run = _laterFinalRun();
        _breakLinkAt(run, 1);
        _assertStructureVerdict(run, 1, true);
    }

    function _assertStructureVerdict(MilestoneProof memory run, uint256 blockIndex, bool killed) private {
        Dispute memory dispute = _dispute(_one(run));
        _commit(dispute);
        assertTrue(
            _diamond().isInvalidBlockStructureInStateProof(dispute.input.stateProof, blockIndex), "premise: a fault"
        );
        _apply(dispute, DisputeFraudProofType.DisputeInvalidBlockStructure, _structureProof(blockIndex));
        if (killed) _assertKilled(dispute);
        else _assertRejected(dispute);
    }

    // -- author membership --

    function test_U92_outsiderAuthorAtAnchorFinalZeroIsNotChallengeable() public {
        MilestoneProof memory run = _zeroAnchoredRun();
        _authorAt(run, 0, _signers(DAVE_KEY));
        _assertAuthorVerdict(run, 0, _noBlock(), genesis, false);
    }

    function test_U92_outsiderAuthorAtThresholdFinalZeroIsChallengeable() public {
        MilestoneProof memory run = _thresholdZeroRun();
        _authorAt(run, 0, _signers(DAVE_KEY, ALICE_KEY, BOB_KEY));
        _assertAuthorVerdict(run, 0, _noBlock(), genesis, true);
    }

    function test_U92_outsiderAuthorAtALaterFinalPointIsNotChallengeable() public {
        MilestoneProof memory run = _laterFinalRun();
        // block 5 links to a real block 4
        (SignedBlock memory four, StateSnapshot memory fourSnapshot) = _blockFour();
        Block memory five = _decode(run, 0);
        five.previousBlockHash = keccak256(four.encodedBlock);
        five.transaction.header.participant = dave;
        _replaceBlock(run, 0, five, _signers(DAVE_KEY, ALICE_KEY, BOB_KEY));
        _assertAuthorVerdict(run, 0, four, fourSnapshot, false);
    }

    function test_U92_outsiderAuthorInTheUnfinalizedTailIsChallengeable() public {
        MilestoneProof memory run = _laterFinalRun();
        _authorAt(run, 1, _signers(DAVE_KEY));
        _assertAuthorVerdict(
            run, 1, run.blockConfirmations[0].signedBlock, _snapshot(5, genesisData.participants), true
        );
    }

    function _assertAuthorVerdict(
        MilestoneProof memory run,
        uint256 blockIndex,
        SignedBlock memory previousBlock,
        StateSnapshot memory previousSnapshot,
        bool killed
    ) private {
        Dispute memory dispute = _dispute(_one(run));
        _commit(dispute);
        assertEq(_decode(run, blockIndex).transaction.header.participant, dave, "premise: D is no participant");
        uint256 height = _decode(run, blockIndex).transaction.header.transactionCnt;
        _apply(
            dispute,
            DisputeFraudProofType.DisputeBlockAuthorNotParticipant,
            _authorProof(blockIndex, previousBlock, previousSnapshot, _snapshot(height, genesisData.participants))
        );
        if (killed) _assertKilled(dispute);
        else _assertRejected(dispute);
    }

    // -- wrapped block fraud --

    function test_U92_wrappedFraudAtAnchorFinalZeroIsNotChallengeable() public {
        MilestoneProof memory run = _zeroAnchoredRun();
        _redateAt(run, 0, GENESIS_TIMESTAMP - 1, _signers(ALICE_KEY));
        _assertWrappedVerdict(
            run, 0, _invalidTimestamp(run.blockConfirmations[0].signedBlock, _noBlock(), genesis), false
        );
    }

    function test_U92_wrappedFraudAtThresholdFinalZeroIsChallengeable() public {
        MilestoneProof memory run = _thresholdZeroRun();
        _redateAt(run, 0, GENESIS_TIMESTAMP - 1, _signers(ALICE_KEY, BOB_KEY));
        _assertWrappedVerdict(
            run, 0, _invalidTimestamp(run.blockConfirmations[0].signedBlock, _noBlock(), genesis), true
        );
    }

    function test_U92_wrappedFraudAtALaterFinalPointIsNotChallengeable() public {
        MilestoneProof memory run = _laterFinalRun();
        // block 5 is dated before the real block 4 it links to
        (SignedBlock memory four,) = _blockFour();
        Block memory five = _decode(run, 0);
        five.previousBlockHash = keccak256(four.encodedBlock);
        five.transaction.header.timestamp = abi.decode(four.encodedBlock, (Block)).transaction.header.timestamp - 1;
        _replaceBlock(run, 0, five, _signers(ALICE_KEY, BOB_KEY));
        StateSnapshot memory unused;
        _assertWrappedVerdict(run, 0, _invalidTimestamp(run.blockConfirmations[0].signedBlock, four, unused), false);
    }

    function test_U92_wrappedFraudInTheUnfinalizedTailIsChallengeable() public {
        MilestoneProof memory run = _laterFinalRun();
        _backdateAt(run, 1, _signers(ALICE_KEY));
        _assertWrappedVerdict(run, 1, _invalidTimestampAt(run, 1), true);
    }

    function _assertWrappedVerdict(
        MilestoneProof memory run,
        uint256 blockIndex,
        FraudProof memory fraudProof,
        bool killed
    ) private {
        Dispute memory dispute = _dispute(_one(run));
        _commit(dispute);
        assertEq(harness.judgeFraudProof(CHANNEL, fraudProof), alice, "premise: a real block fault");
        _apply(
            dispute,
            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
            _applyProof(fraudProof, blockIndex)
        );
        if (killed) _assertKilled(dispute);
        else _assertRejected(dispute);
    }

    // -- header mismatch: the separate scan respects the same boundary --

    function test_U92_headerMismatchAtALaterFinalPointIsNotChallengeable() public {
        MilestoneProof memory run = _laterFinalRun();
        _otherForkAt(run, 0);
        _assertHeaderVerdict(run, false);
    }

    function test_U92_headerMismatchInTheUnfinalizedTailIsChallengeable() public {
        MilestoneProof memory run = _laterFinalRun();
        _otherForkAt(run, 1);
        _assertHeaderVerdict(run, true);
    }

    function test_U92_headerMismatchAtAnchorFinalZeroIsNotChallengeable() public {
        MilestoneProof memory run = _zeroAnchoredRun();
        _otherForkAt(run, 0);
        _assertHeaderVerdict(run, false);
    }

    function test_U92_headerMismatchAtThresholdFinalZeroIsChallengeable() public {
        MilestoneProof memory run = _thresholdZeroRun();
        _otherForkAt(run, 0);
        _assertHeaderVerdict(run, true);
    }

    function _assertHeaderVerdict(MilestoneProof memory run, bool killed) private {
        Dispute memory dispute = _dispute(_one(run));
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeStateProofHeaderMismatch, _headerMismatchProof());
        if (killed) _assertKilled(dispute);
        else _assertRejected(dispute);
    }

    /// a real A-authored block 4 committing its snapshot, and that snapshot
    function _blockFour() private view returns (SignedBlock memory four, StateSnapshot memory fourSnapshot) {
        fourSnapshot = _snapshot(4, genesisData.participants);
        bytes memory encoded = abi.encode(_block(4, keccak256("block 3"), keccak256(abi.encode(fourSnapshot))));
        four = SignedBlock({encodedBlock: encoded, signature: _sign(ALICE_KEY, encoded)});
    }

    function _noBlock() private pure returns (SignedBlock memory none) {}

    // ==================== U106: defects in skipped history below the anchor ====================

    /// the anchor 5 inside the last milestone [3, 8]
    function _anchorRun() private returns (MilestoneProof memory) {
        _seedAnchor(5);
        return _run(3, 6, keccak256("block 2"), _signers(ALICE_KEY));
    }

    function test_U106_structureDefectBelowTheAnchorIsNotChallengeable() public {
        MilestoneProof memory run = _anchorRun();
        _breakLinkAt(run, 1);
        _assertStructureVerdict(run, 1, false);
    }

    function test_U106_structureDefectInTheRetainedTailIsChallengeable() public {
        MilestoneProof memory run = _anchorRun();
        _breakLinkAt(run, 4);
        _assertStructureVerdict(run, 4, true);
    }

    function test_U106_headerDefectBelowTheAnchorIsNotChallengeable() public {
        MilestoneProof memory run = _anchorRun();
        // block 4, before the anchor block 5, names another fork
        _otherForkAt(run, 1);
        assertTrue(_walk(_one(run), _entries(_snapshot(5, genesisData.participants))).valid, "the suffix is valid");
        _assertHeaderVerdict(run, false);
    }

    function test_U106_structureDefectInTheRetainedTailAfterAWhollySkippedMilestoneIsChallengeable() public {
        MilestoneProof memory run = _anchorRun();
        _breakLinkAt(run, 4);
        // a milestone wholly below the anchor comes first: the position counts from the last milestone
        Dispute memory dispute = _dispute(_two(_run(1, 2, keccak256("block 0"), _signers(ALICE_KEY)), run));
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeInvalidBlockStructure, _structureProof(4));
        _assertKilled(dispute);
    }

    function test_U106_headerDefectInTheRetainedTailIsChallengeable() public {
        MilestoneProof memory run = _anchorRun();
        _otherForkAt(run, 3);
        _assertHeaderVerdict(run, true);
    }

    // ==================== U108: finality evidence after the boundary does not protect a block ====================

    /// the last milestone [5, 8]; block 7 carries everyone's signature and is dated before block 6; B submitted it
    function _fullySignedFaultyTail() private view returns (Dispute memory dispute, MilestoneProof memory run) {
        run = _thresholdRun(5, 4, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        _backdateAt(run, 2, _signers(ALICE_KEY, BOB_KEY));
        dispute = _disputeBy(bob, _one(run));
    }

    function test_U108_extraFinalityEvidenceDoesNotRemoveEligibility() public {
        (Dispute memory dispute, MilestoneProof memory run) = _fullySignedFaultyTail();
        _commit(dispute);
        assertEq(run.blockConfirmations[2].signatures.length, 1, "B also signed block 7");
        assertTrue(_isEligible(dispute, 2));
        // C proves the fault: B, the dispute submitter, is punished, not A who issued the block
        _applyBy(
            carol,
            dispute,
            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
            _applyProof(_invalidTimestampAt(run, 2), 2)
        );
        assertEq(harness.commitmentCount(CHANNEL, forkId), 0, "dispute killed");
        assertTrue(harness.isSlashed(CHANNEL, bob), "the dispute submitter is slashed");
        assertFalse(harness.isSlashed(CHANNEL, alice), "the block issuer is not");
    }

    function test_U108_eligibleCorrectBlockEstablishesNoOffense() public {
        MilestoneProof memory run = _thresholdRun(5, 4, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        Dispute memory dispute = _dispute(_one(run));
        _commit(dispute);
        assertTrue(_isEligible(dispute, 2), "eligible");
        _apply(dispute, DisputeFraudProofType.DisputeInvalidBlockStructure, _structureProof(2));
        _assertRejected(dispute);
    }

    // ==================== U34-U38: the auditing-data omission rule ====================

    function _assertOmissionCounterVerdict(Dispute memory dispute, bool killed) private {
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData, _notFinalProof());
        if (killed) _assertKilled(dispute);
        else _assertRejected(dispute);
    }

    function test_U34_anchorAtTheFirstPositionOfTheLastMilestonePermitsOmission() public {
        _seedAnchor(5);
        Dispute memory dispute = _dispute(_one(_run(5, 3, keccak256("block 4"), _signers(ALICE_KEY))));
        assertTrue(harness.isAuditingDataOmissionAllowed(dispute));
        _assertOmissionCounterVerdict(dispute, false);
    }

    function test_U34_anchorAtAMiddlePositionOfTheLastMilestonePermitsOmission() public {
        _seedAnchor(5);
        Dispute memory dispute = _dispute(_one(_run(4, 3, keccak256("block 3"), _signers(ALICE_KEY))));
        assertTrue(harness.isAuditingDataOmissionAllowed(dispute));
        _assertOmissionCounterVerdict(dispute, false);
    }

    function test_U34_anchorAtTheLastPositionOfTheLastMilestonePermitsOmission() public {
        _seedAnchor(5);
        Dispute memory dispute = _dispute(_one(_run(3, 3, keccak256("block 2"), _signers(ALICE_KEY))));
        assertTrue(harness.isAuditingDataOmissionAllowed(dispute));
        _assertOmissionCounterVerdict(dispute, false);
    }

    function test_U35_everyoneFinalWithoutPendingParticipantsPermitsOmission() public {
        _seedAnchor(5);
        Dispute memory dispute =
            _dispute(_one(_thresholdRun(7, 2, genesisData.participants, _signers(ALICE_KEY, BOB_KEY))));
        assertTrue(harness.isAuditingDataOmissionAllowed(dispute));
        _assertOmissionCounterVerdict(dispute, false);
    }

    function test_U35_everyoneFinalIncludingAPendingParticipantPermitsOmission() public {
        _seedAnchor(5);
        (, bytes32 join) = _seedJoin(bytes32(0), 1, carol);
        Dispute memory dispute =
            _dispute(_one(_thresholdRun(7, 2, genesisData.participants, _signers(ALICE_KEY, BOB_KEY, CAROL_KEY))));
        dispute.input.latestInboundMessageBlockHash = join;
        dispute.input.lastInboundMessageBlockHeight = 1;
        assertTrue(harness.isAuditingDataOmissionAllowed(dispute));
        _assertOmissionCounterVerdict(dispute, false);
    }

    function test_U36_missingParticipantSignatureRequiresPostedData() public {
        _seedAnchor(5);
        Dispute memory dispute = _dispute(_one(_thresholdRun(7, 2, genesisData.participants, _signers(ALICE_KEY))));
        assertFalse(harness.isAuditingDataOmissionAllowed(dispute));
    }

    function test_U36_missingPendingParticipantSignatureRequiresPostedData() public {
        _seedAnchor(5);
        (, bytes32 join) = _seedJoin(bytes32(0), 1, carol);
        Dispute memory dispute =
            _dispute(_one(_thresholdRun(7, 2, genesisData.participants, _signers(ALICE_KEY, BOB_KEY))));
        dispute.input.latestInboundMessageBlockHash = join;
        dispute.input.lastInboundMessageBlockHeight = 1;
        assertFalse(harness.isAuditingDataOmissionAllowed(dispute));
    }

    function test_U36_missingPendingParticipantSignatureWithOmittedDataIsKilled() public {
        _seedAnchor(5);
        (, bytes32 join) = _seedJoin(bytes32(0), 1, carol);
        Dispute memory dispute =
            _dispute(_one(_thresholdRun(7, 2, genesisData.participants, _signers(ALICE_KEY, BOB_KEY))));
        dispute.input.latestInboundMessageBlockHash = join;
        dispute.input.lastInboundMessageBlockHeight = 1;
        _assertOmissionCounterVerdict(dispute, true);
    }

    function test_U37_anchorInAnEarlierMilestoneAloneDoesNotPermitOmission() public {
        _seedAnchor(5);
        Dispute memory dispute = _dispute(
            _two(
                _run(4, 3, keccak256("block 3"), _signers(ALICE_KEY)),
                _thresholdRun(8, 2, genesisData.participants, _signers(ALICE_KEY))
            )
        );
        assertFalse(harness.isAuditingDataOmissionAllowed(dispute));
        _assertOmissionCounterVerdict(dispute, true);
    }

    function test_U38_omittedDataWithoutTheRuleIsKilledByTheAvailabilityCounter() public {
        _seedAnchor(5);
        Dispute memory dispute = _dispute(_one(_thresholdRun(7, 2, genesisData.participants, _signers(ALICE_KEY))));
        _assertOmissionCounterVerdict(dispute, true);
    }

    function test_U38_postedDataIsNotCounteredByTheAvailabilityCounter() public {
        _seedAnchor(5);
        MilestoneProof memory run = _thresholdRun(7, 2, genesisData.participants, _signers(ALICE_KEY));
        (Dispute memory dispute,) = _postedDispute(
            _one(run), _entries(_snapshot(7, genesisData.participants)), _snapshot(8, genesisData.participants)
        );
        _assertOmissionCounterVerdict(dispute, false);
    }

    // ==================== U95: the committed slash list in the required set ====================

    function test_U95_slashCommittedInTheDisputeIsSubtracted() public {
        harness.seedOnChainSlash(CHANNEL, bob);
        Dispute memory dispute = _dispute(_one(_thresholdRun(7, 2, genesisData.participants, _signers(ALICE_KEY))));
        dispute.input.onChainSlashes = _set(bob);
        assertTrue(harness.isAuditingDataOmissionAllowed(dispute));
        _commit(dispute);
        // C proves nothing: B is excluded by the committed list
        _applyBy(carol, dispute, DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData, _notFinalProof());
        assertEq(harness.commitmentCount(CHANNEL, forkId), 1, "dispute stays committed");
        assertFalse(harness.isSlashed(CHANNEL, alice), "the disputer is not punished");
    }

    function test_U95_slashLandingAfterTheDisputeDoesNotChangeTheVerdict() public {
        Dispute memory dispute = _dispute(_one(_thresholdRun(7, 2, genesisData.participants, _signers(ALICE_KEY))));
        assertFalse(harness.isAuditingDataOmissionAllowed(dispute), "before the slash");
        _commit(dispute);
        vm.warp(block.timestamp + 1);
        harness.seedOnChainSlash(CHANNEL, bob);
        assertFalse(harness.isAuditingDataOmissionAllowed(dispute), "after the slash");
        _applyBy(carol, dispute, DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData, _notFinalProof());
        assertEq(harness.commitmentCount(CHANNEL, forkId), 0, "dispute killed");
        assertTrue(harness.isSlashed(CHANNEL, alice), "disputer slashed");
    }

    function test_U95_slashOmittedFromTheCommittedListKeepsTheRequirement() public {
        harness.seedOnChainSlash(CHANNEL, bob);
        vm.warp(block.timestamp + 1);
        Dispute memory dispute = _dispute(_one(_thresholdRun(7, 2, genesisData.participants, _signers(ALICE_KEY))));
        assertFalse(harness.isAuditingDataOmissionAllowed(dispute));
        _commit(dispute);
        _applyBy(carol, dispute, DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData, _notFinalProof());
        assertEq(harness.commitmentCount(CHANNEL, forkId), 0, "dispute killed");
        assertTrue(harness.isSlashed(CHANNEL, alice), "disputer slashed");
    }

    function test_U95_falselyClaimedSlashIsCounteredIndependently() public {
        Dispute memory dispute = _dispute(_one(_thresholdRun(7, 2, genesisData.participants, _signers(ALICE_KEY))));
        dispute.input.onChainSlashes = _set(bob);
        assertTrue(harness.isAuditingDataOmissionAllowed(dispute), "the false claim relaxes the omission rule");
        _commit(dispute);
        _apply(
            dispute,
            DisputeFraudProofType.DisputeOnChainSlashesNotSubset,
            abi.encode(DisputeOnChainSlashesNotSubset({__: false}))
        );
        _assertKilled(dispute);
    }

    // ==================== U112: successor fork before anchor adoption ====================

    /// the chain holds the ancestor anchor 5; the reduced successor fork's history is a genesis-linked run [0, 5]
    /// whose block 0 is signed by `zeroSigners`; returns A's dispute on the successor
    function _successorDispute(uint256[] memory zeroSigners) private returns (Dispute memory dispute) {
        _seedAnchor(5);
        SnapshotData memory successorData = genesisData;
        successorData.originForkId = forkId;
        bytes32 successorForkId = keccak256(abi.encode(successorData));
        StateSnapshot memory successorGenesis = StateSnapshot({
            snapshotData: successorData,
            forkId: successorForkId,
            blockHeight: 0,
            timestamp: harness.seedExpiredOriginWindow(CHANNEL, forkId)
        });
        MilestoneProof memory run = _run(0, 6, bytes32(0), zeroSigners);
        _onFork(run, successorForkId, keccak256(abi.encode(successorGenesis)), zeroSigners);
        dispute = _dispute(_one(run));
        dispute.input.forkId = successorForkId;
    }

    function test_U112_foreignForkAnchorDoesNotPermitOmission() public {
        Dispute memory dispute = _successorDispute(_signers(ALICE_KEY));
        assertFalse(harness.isAuditingDataOmissionAllowed(dispute));
        _assertOmissionCounterVerdict(dispute, true);
    }

    function test_U112_requiredEveryoneFinalityRemainsTheAlternative() public {
        Dispute memory dispute = _successorDispute(_signers(ALICE_KEY, BOB_KEY));
        assertTrue(harness.isAuditingDataOmissionAllowed(dispute));
    }

    // ==================== U107, U111, U120: the invalid-state-proof counter ====================

    function test_U107_omittedDataBrokenRetainedLinkIsCountered() public {
        StateSnapshot memory anchor = _seedAnchor(5);
        MilestoneProof memory run = _run(5, 4, keccak256("block 4"), _signers(ALICE_KEY));
        _breakLinkAt(run, 2);
        Dispute memory dispute = _dispute(_one(run));
        assertTrue(harness.isAuditingDataOmissionAllowed(dispute), "premise: omitted under the anchor rule");
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeInvalidStateProof, _invalidBlockStep(_entries(anchor), 0, 2));
        _assertKilled(dispute);
    }

    function test_U107_omittedDataWrongLatestStateCommitmentIsCountered() public {
        StateSnapshot memory anchor = _seedAnchor(5);
        Dispute memory dispute = _dispute(_one(_run(5, 3, keccak256("block 4"), _signers(ALICE_KEY))));
        // the dispute claims block 6's state while its last block is 7
        dispute.input.latestStateSnapshotHash = _hashAt(6);
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeInvalidStateProof, _invalidStep(_entries(anchor), 0));
        _assertKilled(dispute);
    }

    function test_U107_omittedDataValidProofIsNotCountered() public {
        StateSnapshot memory anchor = _seedAnchor(5);
        Dispute memory dispute = _dispute(_one(_run(5, 3, keccak256("block 4"), _signers(ALICE_KEY))));
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeInvalidStateProof, _invalidStep(_entries(anchor), 0));
        _assertRejected(dispute);
    }

    /// B leaves at 3 (the hop signed by `hopSigners`), then the last milestone [6, 7] everyone of {A, B} signed, so
    /// the auditing data may be omitted
    function _exitHopDispute(uint256[] memory hopSigners)
        private
        view
        returns (Dispute memory dispute, StateSnapshot[] memory entries)
    {
        entries = _entries(_snapshot(3, _set(alice)), _snapshot(6, _set(alice)));
        dispute =
            _dispute(_two(_hopRun(entries[0], 1, hopSigners), _hopRun(entries[1], 2, _signers(ALICE_KEY, BOB_KEY))));
    }

    function test_U107_omittedDataInsufficientHopSignaturesAreCountered() public {
        (Dispute memory dispute, StateSnapshot[] memory entries) = _exitHopDispute(_signers(ALICE_KEY));
        assertTrue(harness.isAuditingDataOmissionAllowed(dispute), "premise: omitted under the everyone rule");
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeInvalidStateProof, _invalidStep(entries, 0));
        _assertKilled(dispute);
    }

    function test_U107_forgedChallengerSnapshotDoesNotInvalidateAnHonestProof() public {
        (Dispute memory dispute, StateSnapshot[] memory entries) = _exitHopDispute(_signers(ALICE_KEY, BOB_KEY));
        _commit(dispute);
        // the forged entry for hop 3 adds C, who signed nothing: accepted, it would fail the honest hop
        entries[0] = _snapshot(3, _set(alice, bob, carol));
        _apply(dispute, DisputeFraudProofType.DisputeInvalidStateProof, _invalidStep(entries, 0));
        _assertRejected(dispute);
    }

    function test_U111_substitutedSnapshotForAnInvalidHopDoesNotEstablishIt() public {
        (Dispute memory dispute, StateSnapshot[] memory entries) = _exitHopDispute(_signers(ALICE_KEY));
        _commit(dispute);
        entries[0] = _snapshot(3, genesisData.participants);
        _apply(dispute, DisputeFraudProofType.DisputeInvalidStateProof, _invalidStep(entries, 0));
        _assertRejected(dispute);
    }

    function test_U120_stepPointerPastTheLastMilestoneIsRejected() public {
        (Dispute memory dispute, StateSnapshot[] memory entries) = _exitHopDispute(_signers(ALICE_KEY));
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeInvalidStateProof, _invalidStep(entries, 2));
        _assertRejected(dispute);
    }

    // ==================== U100: departure and rejoin across hops ====================

    /// From the anchor 5 {A, B}: C joins at 7 (signed by A, B, C), C leaves at 9 (signed by A, B, C), C joins again
    /// at 11 (signed by A, B, C)
    function _departureAndRejoin()
        private
        returns (MilestoneProof[] memory milestones, StateSnapshot[] memory entries, StateSnapshot memory anchor)
    {
        anchor = _seedAnchor(5);
        uint256[] memory everyone = _signers(ALICE_KEY, BOB_KEY, CAROL_KEY);
        (MessageBlock memory firstJoin, bytes32 firstJoinHash) = _seedJoin(bytes32(0), 1, carol);
        (, bytes32 secondJoinHash) = _seedJoin(keccak256(abi.encode(firstJoin)), 2, carol);
        entries = _entries(
            _snapshotAt(7, _set(alice, bob, carol), firstJoinHash, 1),
            _snapshotAt(9, genesisData.participants, firstJoinHash, 1),
            _snapshotAt(11, _set(alice, bob, carol), secondJoinHash, 2)
        );
        milestones = _three(
            _hopRun(entries[0], 1, everyone), _hopRun(entries[1], 1, everyone), _hopRun(entries[2], 1, everyone)
        );
    }

    function test_U100_departureAfterAConsumedJoinIsNotAnOmission() public {
        (MilestoneProof[] memory milestones, StateSnapshot[] memory entries,) = _departureAndRejoin();
        // the proof ends at 9: C is absent from its final snapshot
        MilestoneProof[] memory toDeparture = _two(milestones[0], milestones[1]);
        assertTrue(_walk(toDeparture, _entries(entries[0], entries[1])).valid, "honest proof");
        Dispute memory dispute = _dispute(toDeparture);
        _commit(dispute);
        // the per-hop counter at the departure hop finds no fault
        _apply(
            dispute, DisputeFraudProofType.DisputeInvalidStateProof, _invalidStep(_entries(entries[0], entries[1]), 1)
        );
        _assertRejected(dispute);
    }

    function test_U100_consumedJoinSignedByTheJoinerIsNotAnOmission() public {
        (MilestoneProof[] memory milestones, StateSnapshot[] memory entries,) = _departureAndRejoin();
        Dispute memory dispute = _dispute(milestones);
        _commit(dispute);
        // the per-hop counter at the hop consuming the first join finds no fault
        _apply(dispute, DisputeFraudProofType.DisputeInvalidStateProof, _invalidStep(entries, 0));
        _assertRejected(dispute);
    }

    function test_U100_rejoinSignedByTheJoinerIsNotAnOmission() public {
        (MilestoneProof[] memory milestones, StateSnapshot[] memory entries,) = _departureAndRejoin();
        assertTrue(_walk(milestones, entries).valid, "honest proof");
        Dispute memory dispute = _dispute(milestones);
        _commit(dispute);
        // the per-hop counter at the rejoin hop finds no fault
        _apply(dispute, DisputeFraudProofType.DisputeInvalidStateProof, _invalidStep(entries, 2));
        _assertRejected(dispute);
    }

    // ==================== U43, U44: the balance counter judges the latest state ====================

    /// A's deposit of 20 is on chain. The hop to 5 commits `fiveBalance` in its state; the unfinalized block 6 commits
    /// `sixBalance`. Returns the dispute (posted or not) and both states.
    function _balanceDispute(uint256 fiveBalance, uint256 sixBalance, bool posted)
        private
        returns (
            Dispute memory dispute,
            StateSnapshot memory five,
            bytes memory fiveState,
            StateSnapshot memory six,
            bytes memory sixState
        )
    {
        bytes32 deposit = harness.seedInboundBlock(CHANNEL, _joinBlock(bytes32(0), 1, alice, 20));
        (five, fiveState) = _balanceSnapshot(5, deposit, 20, 0, fiveBalance);
        (six, sixState) = _balanceSnapshot(6, deposit, 20, 0, sixBalance);
        MilestoneProof memory run = _hopRun(five, 2, _signers(ALICE_KEY, BOB_KEY));
        _commitAt(run, 1, keccak256(abi.encode(six)), _signers(ALICE_KEY));
        if (posted) (dispute,) = _postedDispute(_one(run), _entries(five), six);
        else dispute = _dispute(_one(run));
        assertTrue(_walk(_one(run), _entries(five)).valid, "premise: a valid proof");
    }

    function test_U43_omittedDataValidLatestBalanceIsNotCountered() public {
        (Dispute memory dispute,,, StateSnapshot memory six, bytes memory sixState) = _balanceDispute(20, 20, false);
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeInvalidBalanceInvariant, _balanceProof(six, sixState));
        _assertRejected(dispute);
    }

    function test_U43_omittedDataInvalidLatestBalanceIsCountered() public {
        (Dispute memory dispute,,, StateSnapshot memory six, bytes memory sixState) = _balanceDispute(20, 25, false);
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeInvalidBalanceInvariant, _balanceProof(six, sixState));
        _assertKilled(dispute);
    }

    function test_U43_postedDataValidLatestBalanceIsNotCountered() public {
        (Dispute memory dispute,,, StateSnapshot memory six, bytes memory sixState) = _balanceDispute(20, 20, true);
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeInvalidBalanceInvariant, _balanceProof(six, sixState));
        _assertRejected(dispute);
    }

    function test_U43_postedDataInvalidLatestBalanceIsCountered() public {
        (Dispute memory dispute,,, StateSnapshot memory six, bytes memory sixState) = _balanceDispute(20, 25, true);
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeInvalidBalanceInvariant, _balanceProof(six, sixState));
        _assertKilled(dispute);
    }

    function test_U44_finalizedPassesLatestFailsIsCountered() public {
        (
            Dispute memory dispute,
            StateSnapshot memory five,
            bytes memory fiveState,
            StateSnapshot memory six,
            bytes memory sixState
        ) = _balanceDispute(20, 25, false);
        assertTrue(harness.verifyBalanceInvariantCheckSnapshot(CHANNEL, five.snapshotData, fiveState), "final passes");
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeInvalidBalanceInvariant, _balanceProof(six, sixState));
        _assertKilled(dispute);
    }

    function test_U44_finalizedFailsLatestPassesIsNotCountered() public {
        (
            Dispute memory dispute,
            StateSnapshot memory five,
            bytes memory fiveState,
            StateSnapshot memory six,
            bytes memory sixState
        ) = _balanceDispute(25, 20, false);
        assertFalse(harness.verifyBalanceInvariantCheckSnapshot(CHANNEL, five.snapshotData, fiveState), "final fails");
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeInvalidBalanceInvariant, _balanceProof(six, sixState));
        _assertRejected(dispute);
    }

    function test_U44_failingFinalizedStateIsNotTheLatestStateAndIsNotCountered() public {
        (Dispute memory dispute, StateSnapshot memory five, bytes memory fiveState,,) = _balanceDispute(25, 20, false);
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeInvalidBalanceInvariant, _balanceProof(five, fiveState));
        _assertRejected(dispute);
    }
}
