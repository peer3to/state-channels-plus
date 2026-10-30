pragma solidity ^0.8.8;

import {StateProofStaging} from "../harness/StateProofStaging.sol";
import {_getLatestSignedBlock} from "../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/DisputeTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// The one state-proof walk (`verifyMilestones`) and the proof shape, from the fork genesis or the same-fork
/// on-chain anchor. Plan 35 cases U01-U21, U78-U80, U86, U110, U120 and U123 (contract side).
// test naming: test_<plan case>_<scenario>
contract StateProofWalkTest is StateProofStaging {
    function setUp() public {
        _stageGenesisChannel();
    }

    // ---- U01-U04: proof shape, empty proof, anchor state ----

    function test_U01_proofCarriesOnlyMilestonesAndItsLastBlockIsTheLatestState() public view {
        uint256[] memory both = _signers(ALICE_KEY, BOB_KEY);
        MilestoneProof[] memory milestones =
            _two(_genesisRun(2, genesisData.participants, both), _thresholdRun(5, 3, genesisData.participants, both));
        StateProof memory decoded = abi.decode(abi.encode(StateProof(milestones)), (StateProof));
        assertEq(keccak256(abi.encode(decoded)), keccak256(abi.encode(StateProof(milestones))), "round trip");
        assertEq(decoded.milestones.length, 2);

        (bool hasBlock, SignedBlock memory latest) = _getLatestSignedBlock(decoded);
        assertTrue(hasBlock);
        assertEq(latest.encodedBlock, milestones[1].blockConfirmations[2].signedBlock.encodedBlock, "last block");
        Dispute memory dispute = _dispute(decoded.milestones);
        assertEq(dispute.input.latestStateSnapshotHash, _hashAt(7));
        assertTrue(_diamond().isCorrectLatestState(dispute, genesisData), "the latest state is representable");
        _assertFinalized(
            _walk(milestones, _entries(_snapshot(0, genesisData.participants), _snapshot(5, genesisData.participants))),
            _snapshot(5, genesisData.participants),
            1
        );
    }

    function test_U02_emptyProofAtGenesisRepresentsTheGenesis() public view {
        _assertFinalized(_walk(new MilestoneProof[](0), new StateSnapshot[](0)), genesis, 0);
        assertTrue(_diamond().isCorrectLatestState(_dispute(new MilestoneProof[](0)), genesisData), "genesis claim");
    }

    function test_U03_emptyProofWithANonGenesisAnchorStillRepresentsTheGenesis() public {
        _seedAnchor(50);
        ProofWalkResult memory result = _walk(new MilestoneProof[](0), new StateSnapshot[](0));
        assertTrue(result.valid);
        assertEq(keccak256(abi.encode(result.finalizedSnapshot.snapshotData)), keccak256(abi.encode(genesisData)));
        assertEq(result.finalizedSnapshot.forkId, forkId);
        assertEq(result.finalizedSnapshot.blockHeight, 0, "never the anchor");
        assertTrue(
            _diamond().isStateProofBelowOnChainAnchor(_dispute(new MilestoneProof[](0))),
            "judged separately by the below-anchor rule"
        );
    }

    function test_U04_anchorBlockAloneRepresentsTheAnchorState() public {
        StateSnapshot memory anchor = _seedAnchor(50);
        MilestoneProof[] memory milestones = _one(_run(50, 1, keccak256("block 49"), _signers(ALICE_KEY)));
        _assertFinalized(_walk(milestones, _entries(anchor)), anchor, 1);
        Dispute memory dispute = _dispute(milestones);
        assertEq(dispute.input.latestStateSnapshotHash, keccak256(abi.encode(anchor)));
        assertTrue(_diamond().isCorrectLatestState(dispute, genesisData), "the anchor state");
        assertFalse(_diamond().isStateProofBelowOnChainAnchor(dispute), "not below the anchor");
    }

    // ---- U05-U07: genesis-linked block zero and the block-zero anchor ----

    function test_U05_unfinalizedGenesisZeroAloneReplaysFromZero() public view {
        MilestoneProof memory run = _genesisRun(1, genesisData.participants, _signers(ALICE_KEY));
        _assertFinalized(_walk(_one(run), _entries(_snapshot(0, genesisData.participants))), genesis, 0);
    }

    function test_U05_unfinalizedGenesisZeroWithLinkedTailReplaysFromZero() public view {
        MilestoneProof memory run = _genesisRun(3, genesisData.participants, _signers(ALICE_KEY));
        _assertFinalized(_walk(_one(run), _entries(_snapshot(0, genesisData.participants))), genesis, 0);
    }

    function test_U06_thresholdFinalGenesisZeroReplaysOnlyLaterBlocks() public view {
        StateSnapshot memory zero = _snapshot(0, genesisData.participants);
        MilestoneProof memory run = _genesisRun(3, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        _assertFinalized(_walk(_one(run), _entries(zero)), zero, 1);
    }

    function test_U07_blockZeroAnchorIsFinalWithoutAThreshold() public {
        StateSnapshot memory anchorAtZero = _seedAnchor(0);
        assertTrue(keccak256(abi.encode(anchorAtZero.snapshotData)) != forkId, "premise: not the genesis");
        // only the author signed block 0: the anchor makes it final
        MilestoneProof memory run = _genesisRun(3, genesisData.participants, _signers(ALICE_KEY));
        _assertFinalized(_walk(_one(run), _entries(anchorAtZero)), anchorAtZero, 1);
    }

    function test_U07_blockZeroAnchorIsNotConfusedWithTheGenesis() public {
        StateSnapshot memory anchorAtZero = _seedAnchor(0);
        // a threshold-signed genesis-linked block 0 committing another height-0 snapshot is not this fork's history
        MilestoneProof memory other = _genesisRun(2, _set(alice), _signers(ALICE_KEY, BOB_KEY));
        assertFalse(_walk(_one(other), _entries(anchorAtZero)).valid);
        assertFalse(_walk(_one(other), _entries(_snapshot(0, _set(alice)))).valid, "with its own entry");
    }

    // ---- U08-U12: the anchor inside a milestone, hops above it ----

    function test_U08_anchorAtTheFirstBlockOfTheMilestone() public {
        StateSnapshot memory anchor = _seedAnchor(50);
        MilestoneProof memory run = _run(50, 3, keccak256("block 49"), _signers(ALICE_KEY));
        _assertFinalized(_walk(_one(run), _entries(anchor)), anchor, 1);
    }

    function test_U08_anchorAtAMiddleBlockOfTheMilestone() public {
        StateSnapshot memory anchor = _seedAnchor(50);
        MilestoneProof memory run = _run(49, 3, keccak256("block 48"), _signers(ALICE_KEY));
        _assertFinalized(_walk(_one(run), _entries(anchor)), anchor, 2);
    }

    function test_U08_anchorAtTheLastBlockOfTheMilestone() public {
        StateSnapshot memory anchor = _seedAnchor(50);
        MilestoneProof memory run = _run(48, 3, keccak256("block 47"), _signers(ALICE_KEY));
        _assertFinalized(_walk(_one(run), _entries(anchor)), anchor, 3);
    }

    function test_U09_blockAtTheAnchorHeightCommittingAnotherSnapshotDoesNotMatch() public {
        StateSnapshot memory anchor = _seedAnchor(50);
        StateSnapshot memory other = _snapshot(50, genesisData.participants);
        other.snapshotData.stateMachineStateHash = keccak256("another state at 50");
        MilestoneProof memory run = _run(49, 3, keccak256("block 48"), _signers(ALICE_KEY));
        _commitAt(run, 1, keccak256(abi.encode(other)), _signers(ALICE_KEY));
        ProofWalkResult memory result = _walk(_one(run), _entries(anchor));
        assertFalse(result.valid);
        assertFalse(result.snapshotMismatch, "an invalid proof, not forged evidence");
    }

    function test_U10_firstMilestoneAboveTheAnchorProvesItsHopWithoutTheAnchorBlock() public {
        _seedAnchor(50);
        StateSnapshot memory hop = _snapshot(51, genesisData.participants);
        MilestoneProof memory run = _thresholdRun(51, 2, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        _assertFinalized(_walk(_one(run), _entries(hop)), hop, 1);
    }

    function test_U11_firstMilestoneAboveTheAnchorWithoutTheThresholdIsInvalid() public {
        _seedAnchor(50);
        MilestoneProof memory run = _thresholdRun(51, 2, genesisData.participants, _signers(ALICE_KEY));
        assertFalse(_walk(_one(run), _entries(_snapshot(51, genesisData.participants))).valid);
    }

    function test_U11_unfinalizedExtensionMustIncludeTheAnchorBlock() public {
        StateSnapshot memory anchor = _seedAnchor(50);
        // the same author-only blocks 51 and 52, extended from the anchor block 50
        MilestoneProof memory run = _run(50, 3, keccak256("block 49"), _signers(ALICE_KEY));
        _assertFinalized(_walk(_one(run), _entries(anchor)), anchor, 1);
    }

    function test_U12_linkedUnfinalizedTailDoesNotBecomeFinal() public {
        StateSnapshot memory anchor = _seedAnchor(50);
        MilestoneProof memory run = _run(50, 4, keccak256("block 49"), _signers(ALICE_KEY));
        // the tail 51-53 is replayed from the anchor; the finalized point stays the anchor
        _assertFinalized(_walk(_one(run), _entries(anchor)), anchor, 1);
    }

    // ---- U13-U15: wrong links, skipped history, anchor movement ----

    function test_U13_brokenRetainedLinkAfterTheAnchorIsInvalid() public {
        StateSnapshot memory anchor = _seedAnchor(50);
        MilestoneProof memory run = _run(50, 3, keccak256("block 49"), _signers(ALICE_KEY));
        _breakLinkAt(run, 2);
        assertFalse(_walk(_one(run), _entries(anchor)).valid);
    }

    function test_U13_wrongGenesisLinkOfBlockZeroIsInvalid() public view {
        MilestoneProof memory run = _genesisRun(2, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        Block memory zero = _decode(run, 0);
        zero.previousBlockHash = keccak256("not the genesis");
        _replaceBlock(run, 0, zero, _signers(ALICE_KEY, BOB_KEY));
        assertFalse(_walk(_one(run), _entries(_snapshot(0, genesisData.participants))).valid);
    }

    function test_U14_milestonesBeforeTheAnchorAreSkippedAndTheCrossingMilestoneIsProcessedFromIt() public {
        StateSnapshot memory anchor = _seedAnchor(50);
        // [40, junk, 42] and an unproven hop at 45 lie wholly below the anchor: never checked
        MilestoneProof memory junk = _run(40, 3, keccak256("block 39"), _signers(ALICE_KEY));
        junk.blockConfirmations[1].signedBlock = SignedBlock({encodedBlock: hex"1234", signature: ""});
        MilestoneProof memory unproven = _thresholdRun(45, 2, genesisData.participants, _signers(ALICE_KEY));
        // the crossing run [48, 51]: its prefix before the anchor is broken and never checked
        MilestoneProof memory crossing = _run(48, 4, keccak256("block 47"), _signers(ALICE_KEY));
        _breakLinkAt(crossing, 1);
        // forged entries for the skipped milestones name an outsider set
        StateSnapshot memory forged = _snapshot(45, _set(dave));
        _assertFinalized(_walk(_three(junk, unproven, crossing), _entries(forged, forged, anchor)), anchor, 3);
    }

    function test_U14_crossingMilestoneFirstBlockOnAnotherForkBelowTheAnchorIsSkipped() public {
        StateSnapshot memory anchor = _seedAnchor(50);
        // the crossing run [48, 51]: its first block 48, before the anchor block 50, names another fork
        MilestoneProof memory crossing = _run(48, 4, keccak256("block 47"), _signers(ALICE_KEY));
        Block memory first = _decode(crossing, 0);
        first.transaction.header.forkId = keccak256("other-fork");
        _replaceBlock(crossing, 0, first, _signers(ALICE_KEY));
        _assertFinalized(_walk(_one(crossing), _entries(anchor)), anchor, 3);
    }

    /// a genesis-built proof: the threshold-final run [0, 3], then the hop [5, 7]
    function _genesisBuiltProof() private view returns (MilestoneProof[] memory, StateSnapshot[] memory) {
        uint256[] memory both = _signers(ALICE_KEY, BOB_KEY);
        return (
            _two(_genesisRun(4, genesisData.participants, both), _thresholdRun(5, 3, genesisData.participants, both)),
            _entries(_snapshot(0, genesisData.participants), _snapshot(5, genesisData.participants))
        );
    }

    function test_U15_anchorAdvancedToTheProofStartKeepsItValid() public {
        (MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots) = _genesisBuiltProof();
        _assertFinalized(_walk(milestones, snapshots), snapshots[1], 1);
        _seedAnchor(0);
        _assertFinalized(_walk(milestones, snapshots), snapshots[1], 1);
    }

    function test_U15_anchorAdvancedIntoTheProofInteriorKeepsItValid() public {
        (MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots) = _genesisBuiltProof();
        StateSnapshot memory anchor = _seedAnchor(6);
        _assertFinalized(_walk(milestones, snapshots), anchor, 2);
    }

    function test_U15_anchorAdvancedToTheProofEndpointKeepsItValid() public {
        (MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots) = _genesisBuiltProof();
        StateSnapshot memory anchor = _seedAnchor(7);
        _assertFinalized(_walk(milestones, snapshots), anchor, 3);
    }

    function test_U15_anchorAdvancedBeyondTheProofEndpointLeavesNothingToCheck() public {
        (MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots) = _genesisBuiltProof();
        StateSnapshot memory anchor = _seedAnchor(9);
        // nothing is left to check: valid, and only the anchor is final
        _assertFinalized(_walk(milestones, snapshots), anchor, 3);
    }

    // ---- U16-U21: participant-change hops ----

    function test_U16_additionHopIsFinalWithTheOldAndNewUnion() public {
        _seedAnchor(50);
        (, bytes32 join) = _seedJoin(bytes32(0), 1, carol);
        StateSnapshot memory added = _snapshotAt(51, _set(alice, bob, carol), join, 1);
        MilestoneProof memory hop = _hopRun(added, 1, _signers(ALICE_KEY, BOB_KEY, CAROL_KEY));
        _assertFinalized(_walk(_one(hop), _entries(added)), added, 1);
    }

    function test_U16_removalHopIsFinalWithTheOldAndNewUnion() public {
        _seedAnchor(50);
        StateSnapshot memory removed = _snapshot(51, _set(alice));
        MilestoneProof memory hop = _hopRun(removed, 1, _signers(ALICE_KEY, BOB_KEY));
        _assertFinalized(_walk(_one(hop), _entries(removed)), removed, 1);
    }

    function test_U17_successiveChangesAreEachProvenByTheirOwnUnion() public {
        _seedAnchor(50);
        // B leaves at 55 ({A, B} signs), then C joins at 70 ({A} and {A, C}: B is not required any more)
        StateSnapshot memory exited = _snapshot(55, _set(alice));
        (, bytes32 join) = _seedJoin(bytes32(0), 1, carol);
        StateSnapshot memory joined = _snapshotAt(70, _set(alice, carol), join, 1);
        MilestoneProof[] memory milestones =
            _two(_hopRun(exited, 1, _signers(ALICE_KEY, BOB_KEY)), _hopRun(joined, 1, _signers(ALICE_KEY, CAROL_KEY)));
        _assertFinalized(_walk(milestones, _entries(exited, joined)), joined, 1);
    }

    function test_U17_laterChangeWithoutTheEarlierHopNeedsTheAnchorSet() public {
        _seedAnchor(50);
        (, bytes32 join) = _seedJoin(bytes32(0), 1, carol);
        StateSnapshot memory joined = _snapshotAt(70, _set(alice, carol), join, 1);
        // without B's exit at 55, the hop from 50 still needs B's signature
        MilestoneProof memory hop = _hopRun(joined, 1, _signers(ALICE_KEY, CAROL_KEY));
        assertFalse(_walk(_one(hop), _entries(joined)).valid);
    }

    function test_U18_directSignaturesOnOneBlockEstablishTheHop() public {
        _seedAnchor(50);
        StateSnapshot memory hop = _snapshot(51, genesisData.participants);
        MilestoneProof memory run = _thresholdRun(51, 1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        _assertFinalized(_walk(_one(run), _entries(hop)), hop, 1);
    }

    function test_U18_indirectVotingOverLinkedBlocksEstablishesTheHop() public {
        _seedAnchor(50);
        StateSnapshot memory hop = _snapshot(51, genesisData.participants);
        // A authors 51 alone; B authors the linked 52, which votes for 51
        MilestoneProof memory run = _thresholdRun(51, 2, genesisData.participants, _signers(ALICE_KEY));
        _authorAt(run, 1, _signers(BOB_KEY));
        _assertFinalized(_walk(_one(run), _entries(hop)), hop, 1);
    }

    function test_U18_directAndIndirectEvidenceTogetherEstablishTheHop() public {
        _seedAnchor(50);
        StateSnapshot memory hop = _snapshot(51, genesisData.participants);
        MilestoneProof memory run = _thresholdRun(51, 2, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        _authorAt(run, 1, _signers(BOB_KEY));
        _assertFinalized(_walk(_one(run), _entries(hop)), hop, 1);
    }

    function test_U19_evidenceBelowTheThresholdDoesNotEstablishTheHop() public {
        _seedAnchor(50);
        MilestoneProof memory run = _thresholdRun(51, 1, genesisData.participants, _signers(ALICE_KEY));
        assertFalse(_walk(_one(run), _entries(_snapshot(51, genesisData.participants))).valid);
    }

    function test_U19_evidenceExactlyAtTheThresholdEstablishesTheHop() public {
        _seedAnchor(50);
        StateSnapshot memory hop = _snapshot(51, genesisData.participants);
        MilestoneProof memory run = _thresholdRun(51, 1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        _assertFinalized(_walk(_one(run), _entries(hop)), hop, 1);
    }

    function test_U19_evidenceAboveTheThresholdEstablishesTheHop() public {
        _seedAnchor(50);
        StateSnapshot memory hop = _snapshot(51, genesisData.participants);
        // D outside the required set also signed
        MilestoneProof memory run =
            _thresholdRun(51, 1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY, DAVE_KEY));
        _assertFinalized(_walk(_one(run), _entries(hop)), hop, 1);
    }

    function test_U20_removalHopMissingTheOldSideIsInvalid() public {
        _seedAnchor(50);
        StateSnapshot memory removed = _snapshot(51, _set(alice));
        // the leaver B is in the old set and did not sign
        MilestoneProof memory hop = _hopRun(removed, 1, _signers(ALICE_KEY));
        assertFalse(_walk(_one(hop), _entries(removed)).valid);
    }

    function test_U20_additionHopMissingTheNewSideIsInvalid() public {
        _seedAnchor(50);
        (, bytes32 join) = _seedJoin(bytes32(0), 1, carol);
        StateSnapshot memory added = _snapshotAt(51, _set(alice, bob, carol), join, 1);
        // the joiner C is in the new set and did not sign
        MilestoneProof memory hop = _hopRun(added, 1, _signers(ALICE_KEY, BOB_KEY));
        assertFalse(_walk(_one(hop), _entries(added)).valid);
    }

    /// C joins at 55, D joins at 56, C leaves at 57: the snapshots after the anchor 50
    function _unfinalizedChanges() private returns (StateSnapshot memory, StateSnapshot memory, StateSnapshot memory) {
        (MessageBlock memory first, bytes32 firstHash) = _seedJoin(bytes32(0), 1, carol);
        (, bytes32 secondHash) = _seedJoin(keccak256(abi.encode(first)), 2, dave);
        assertEq(firstHash, keccak256(abi.encode(first)));
        return (
            _snapshotAt(55, _set(alice, bob, carol), firstHash, 1),
            _snapshotAt(56, _set(alice, bob, carol, dave), secondHash, 2),
            _snapshotAt(57, _set(alice, bob, dave), secondHash, 2)
        );
    }

    function test_U21_unfinalizedChangesStayInOneReplayTail() public {
        StateSnapshot memory anchor = _seedAnchor(50);
        (StateSnapshot memory s55, StateSnapshot memory s56, StateSnapshot memory s57) = _unfinalizedChanges();
        MilestoneProof memory run = _run(50, 8, keccak256("block 49"), _signers(ALICE_KEY));
        _commitAt(run, 5, keccak256(abi.encode(s55)), _signers(ALICE_KEY));
        _commitAt(run, 6, keccak256(abi.encode(s56)), _signers(ALICE_KEY));
        _commitAt(run, 7, keccak256(abi.encode(s57)), _signers(ALICE_KEY));
        _assertFinalized(_walk(_one(run), _entries(anchor)), anchor, 1);
    }

    function test_U21_unfinalizedChangesCannotBecomeFinalizedHops() public {
        _seedAnchor(50);
        (StateSnapshot memory s55, StateSnapshot memory s56, StateSnapshot memory s57) = _unfinalizedChanges();
        MilestoneProof[] memory milestones = _three(
            _hopRun(s55, 1, _signers(ALICE_KEY)),
            _hopRun(s56, 1, _signers(ALICE_KEY)),
            _hopRun(s57, 1, _signers(ALICE_KEY))
        );
        assertFalse(_walk(milestones, _entries(s55, s56, s57)).valid);
    }

    // ---- U78-U80: signature counting and the supplied snapshot ----

    function test_U78_duplicateSignerCannotReplaceAMissingMember() public {
        _seedAnchor(50);
        MilestoneProof memory run = _thresholdRun(51, 1, genesisData.participants, _signers(ALICE_KEY, ALICE_KEY));
        assertFalse(_walk(_one(run), _entries(_snapshot(51, genesisData.participants))).valid);
    }

    function test_U78_outsideSignerCannotReplaceAMissingMember() public {
        _seedAnchor(50);
        MilestoneProof memory run = _thresholdRun(51, 1, genesisData.participants, _signers(ALICE_KEY, DAVE_KEY));
        assertFalse(_walk(_one(run), _entries(_snapshot(51, genesisData.participants))).valid);
    }

    function test_U79_blockZeroAdditionIsFinalWithTheOldAndNewUnion() public {
        (, bytes32 join) = _seedJoin(bytes32(0), 1, carol);
        StateSnapshot memory zero = _snapshotAt(0, _set(alice, bob, carol), join, 1);
        MilestoneProof memory run = _genesisRunTo(zero, 2, _signers(ALICE_KEY, BOB_KEY, CAROL_KEY));
        _assertFinalized(_walk(_one(run), _entries(zero)), zero, 1);
    }

    function test_U79_blockZeroRemovalIsFinalWithTheOldAndNewUnion() public view {
        StateSnapshot memory zero = _snapshot(0, _set(alice));
        MilestoneProof memory run = _genesisRunTo(zero, 2, _signers(ALICE_KEY, BOB_KEY));
        _assertFinalized(_walk(_one(run), _entries(zero)), zero, 1);
    }

    function test_U79_blockZeroRemovalMissingTheOldSideStaysUnfinalized() public view {
        StateSnapshot memory zero = _snapshot(0, _set(alice));
        // the leaver B did not sign: zero is not final, the whole run is replayed from the genesis
        MilestoneProof memory run = _genesisRunTo(zero, 2, _signers(ALICE_KEY));
        _assertFinalized(_walk(_one(run), _entries(zero)), genesis, 0);
    }

    function test_U79_blockZeroAdditionMissingTheNewSideStaysUnfinalized() public {
        (, bytes32 join) = _seedJoin(bytes32(0), 1, carol);
        StateSnapshot memory zero = _snapshotAt(0, _set(alice, bob, carol), join, 1);
        MilestoneProof memory run = _genesisRunTo(zero, 2, _signers(ALICE_KEY, BOB_KEY));
        _assertFinalized(_walk(_one(run), _entries(zero)), genesis, 0);
    }

    function test_U80_snapshotTheBlockDoesNotCommitCannotBeItsProvenState() public {
        _seedAnchor(50);
        MilestoneProof memory run = _thresholdRun(51, 1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        ProofWalkResult memory result = _walk(_one(run), _entries(_snapshot(52, genesisData.participants)));
        assertFalse(result.valid);
        assertTrue(result.snapshotMismatch, "forged evidence");
    }

    function test_U80_sameHeightSubstitutedSnapshotCannotBeItsProvenState() public {
        _seedAnchor(50);
        MilestoneProof memory run = _thresholdRun(51, 1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        StateSnapshot memory substituted = _snapshot(51, genesisData.participants);
        substituted.snapshotData.stateMachineStateHash = keccak256("another state at 51");
        ProofWalkResult memory result = _walk(_one(run), _entries(substituted));
        assertFalse(result.valid);
        assertTrue(result.snapshotMismatch, "forged evidence");
    }

    // ---- U86: validity survives a later on-chain slash ----

    function test_U86_laterOnChainSlashDoesNotChangeAValidProof() public {
        StateSnapshot[] memory snapshots = _entries(_snapshot(3, genesisData.participants));
        MilestoneProof[] memory proven =
            _one(_thresholdRun(3, 1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY)));
        MilestoneProof[] memory authorOnly = _one(_thresholdRun(3, 1, genesisData.participants, _signers(ALICE_KEY)));
        assertTrue(_walk(proven, snapshots).valid, "before the slash");

        harness.seedOnChainSlash(CHANNEL, bob);
        assertTrue(harness.isSlashed(CHANNEL, bob));
        assertTrue(_walk(proven, snapshots).valid, "after the slash");
        assertFalse(_walk(authorOnly, snapshots).valid, "B is still required");
    }

    // ---- U110, U120: malformed required material and the snapshot envelope ----

    function test_U110_emptyMilestoneCannotEstablishAValidProof() public view {
        MilestoneProof memory empty;
        ProofWalkResult memory result = _walk(_one(empty), _entries(_snapshot(1, genesisData.participants)));
        assertFalse(result.valid);
        assertFalse(result.snapshotMismatch, "an invalid proof, not forged evidence");
    }

    function test_U110_missingSnapshotEntriesCannotVerifyTheProof() public view {
        MilestoneProof memory run = _thresholdRun(3, 1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        ProofWalkResult memory result = _walk(_one(run), new StateSnapshot[](0));
        assertFalse(result.valid);
        assertTrue(result.snapshotMismatch, "the envelope does not fit the proof");
    }

    function test_U120_excessSnapshotEntriesAreRejected() public view {
        StateSnapshot memory three = _snapshot(3, genesisData.participants);
        MilestoneProof memory run = _thresholdRun(3, 1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        ProofWalkResult memory result = _walk(_one(run), _entries(three, three));
        assertFalse(result.valid);
        assertTrue(result.snapshotMismatch, "the envelope does not fit the proof");
    }

    function test_U120_exactSnapshotEntriesControl() public view {
        StateSnapshot memory three = _snapshot(3, genesisData.participants);
        MilestoneProof memory run = _thresholdRun(3, 1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        _assertFinalized(_walk(_one(run), _entries(three)), three, 1);
    }

    // ---- U123: milestones overlapping at one block ----

    /// the anchor run [60, 70] and the run [70, 71] share block 70; the first copy carries B's confirmation, the
    /// second proves 70 by A's block signature and B's block 71
    function _overlappingProof() private returns (MilestoneProof[] memory milestones, StateSnapshot[] memory entries) {
        StateSnapshot memory anchor = _seedAnchor(60);
        MilestoneProof memory first = _run(60, 11, keccak256("block 59"), _signers(ALICE_KEY));
        SignedBlock memory seventy = first.blockConfirmations[10].signedBlock;
        first.blockConfirmations[10].signatures = new bytes[](1);
        first.blockConfirmations[10].signatures[0] = _sign(BOB_KEY, seventy.encodedBlock);

        MilestoneProof memory second = _run(70, 2, keccak256("unused"), _signers(ALICE_KEY));
        second.blockConfirmations[0] = BlockConfirmation({signedBlock: seventy, signatures: new bytes[](0)});
        Block memory seventyOne = _decode(second, 1);
        seventyOne.previousBlockHash = keccak256(seventy.encodedBlock);
        seventyOne.transaction.header.participant = bob;
        second.blockConfirmations[1] = _blockConfirmation(abi.encode(seventyOne), _signers(BOB_KEY));
        return (_two(first, second), _entries(anchor, _snapshot(70, genesisData.participants)));
    }

    function test_U123_overlappingMilestonesWithComplementarySignaturesVerifyOnChain() public {
        (MilestoneProof[] memory milestones, StateSnapshot[] memory entries) = _overlappingProof();
        _assertFinalized(_walk(milestones, entries), entries[1], 1);
    }

    function test_U123_conflictingBlockContentsAreNotTheSameAuthenticatedBlock() public {
        (MilestoneProof[] memory milestones, StateSnapshot[] memory entries) = _overlappingProof();
        // the second copy of 70 commits another state: B's confirmation on the first copy and B's block 71 (linked to
        // the first copy) do not vote for it
        StateSnapshot memory other = _snapshot(70, genesisData.participants);
        other.snapshotData.stateMachineStateHash = keccak256("another state at 70");
        Block memory conflicting = _decode(milestones[1], 0);
        conflicting.stateSnapshotHash = keccak256(abi.encode(other));
        milestones[1].blockConfirmations[0] = _blockConfirmation(abi.encode(conflicting), _signers(ALICE_KEY));
        entries[1] = other;
        ProofWalkResult memory result = _walk(milestones, entries);
        assertFalse(result.valid);
        assertFalse(result.snapshotMismatch, "the entry is the conflicting block's own commitment");
    }

    // ==================== D6: atomic join and exit in one hop ====================

    /// From the anchor 5 {A, B}: C's JOIN is on chain, and the hop to 7 consumes it while C exits in the same hop,
    /// so C is in neither snapshot; the hop is signed by `signers`
    function _atomicJoinAndExitHop(uint256[] memory signers)
        private
        returns (MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots)
    {
        _seedAnchor(5);
        (, bytes32 joinHash) = _seedJoin(bytes32(0), 1, carol);
        snapshots = _entries(_snapshotAt(7, genesisData.participants, joinHash, 1));
        milestones = _one(_hopRun(snapshots[0], 1, signers));
    }

    function test_D6_atomicJoinAndExitHopWithoutTheJoinersSignatureIsInvalid() public {
        (MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots) =
            _atomicJoinAndExitHop(_signers(ALICE_KEY, BOB_KEY));
        ProofWalkResult memory result = _walk(milestones, snapshots);
        assertFalse(result.valid, "the consumed joiner must sign the hop");
        assertFalse(result.snapshotMismatch, "the evidence fits the proof");
    }

    function test_D6_atomicJoinAndExitHopWithTheJoinersSignatureIsValid() public {
        (MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots) =
            _atomicJoinAndExitHop(_signers(ALICE_KEY, BOB_KEY, CAROL_KEY));
        _assertFinalized(_walk(milestones, snapshots), snapshots[0], 1);
    }
}
