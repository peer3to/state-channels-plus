pragma solidity ^0.8.8;

import {console} from "../../../lib/forge-std/src/console.sol";
import {StateProofStaging} from "../harness/StateProofStaging.sol";
import {DisputeInvalidStateProof} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/DisputeTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// The invalid-state-proof counter judged on one step of the walk (plan "Omitted inbound joiner and the per-hop
/// invalid-state-proof counter", U99/E38): the challenger points at a milestone, and at one of its blocks for a
/// per-block fault. Each step rule kills at the failing step; a valid step of an invalid proof is rejected and its
/// challenger slashed. The omitted-joiner cases are killed by the hop's own step. The step's cost does not grow with the
/// milestones before it beyond copying them.
// test naming: test_<plan case>_<scenario>
contract InvalidStateProofStepTest is StateProofStaging {
    struct Staged {
        Dispute dispute;
        DisputeAuditingData auditingData;
        StateSnapshot anchor;
        StateSnapshot[] entries;
        MessageBlock join;
        /// the milestone whose hop consumes C's JOIN
        uint256 joinHop;
    }

    function setUp() public {
        _stageGenesisChannel();
    }

    /// blocks 5..8 from the anchor 5, each authored by A: the run holding the anchor
    function _anchorRun() private returns (MilestoneProof memory run, StateSnapshot memory anchor) {
        anchor = _seedAnchor(5);
        run = _run(5, 4, keccak256("block 4"), _signers(ALICE_KEY));
    }

    function _applyStep(Dispute memory dispute, bytes memory proof) private {
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeInvalidStateProof, proof);
    }

    // ==================== step rules: each kills at the failing step ====================

    function test_U99_skippedMilestoneAfterAKeptOneKillsAtThatStep() public {
        (MilestoneProof memory run, StateSnapshot memory anchor) = _anchorRun();
        // wholly below the anchor 5, after the kept run
        MilestoneProof memory below = _run(2, 2, keccak256("block 1"), _signers(ALICE_KEY, BOB_KEY));
        Dispute memory dispute = _dispute(_two(run, below));
        assertFalse(_walk(dispute.input.stateProof.milestones, _entries(anchor, anchor)).valid, "invalid proof");
        _applyStep(dispute, _invalidStep(_entries(anchor, anchor), 1));
        _assertKilled(dispute);
    }

    function test_U99_validFirstStepOfAProofWithASkipAfterAKeptMilestoneIsRejected() public {
        (MilestoneProof memory run, StateSnapshot memory anchor) = _anchorRun();
        MilestoneProof memory below = _run(2, 2, keccak256("block 1"), _signers(ALICE_KEY, BOB_KEY));
        Dispute memory dispute = _dispute(_two(run, below));
        _applyStep(dispute, _invalidStep(_entries(anchor, anchor), 0));
        _assertRejected(dispute);
    }

    function test_U99_anchorBlockCommittingAnotherSnapshotKillsTheAnchorRunStep() public {
        (MilestoneProof memory run, StateSnapshot memory anchor) = _anchorRun();
        _commitAt(run, 0, keccak256("not the anchor"), _signers(ALICE_KEY));
        // the run no longer holds the anchor: its data must be posted
        (Dispute memory dispute, DisputeAuditingData memory auditingData) =
            _postedDispute(_one(run), _entries(anchor), _snapshot(8, genesisData.participants));
        _applyStep(dispute, _postedInvalidStep(auditingData, 0));
        _assertKilled(dispute);
    }

    function test_U99_genesisBlockZeroNotLinkedToTheGenesisKillsItsStep() public {
        MilestoneProof memory run = _run(0, 2, keccak256("not the genesis"), _signers(ALICE_KEY, BOB_KEY));
        Dispute memory dispute = _dispute(_one(run));
        _applyStep(dispute, _invalidStep(_entries(_snapshot(0, genesisData.participants)), 0));
        _assertKilled(dispute);
    }

    function test_U99_missingThresholdKillsThroughTheMilestonePointer() public {
        _seedAnchor(5);
        StateSnapshot[] memory entries = _entries(_snapshot(7, genesisData.participants));
        // the hop to 7 needs A and B; only A signed, so its data must be posted
        (Dispute memory dispute, DisputeAuditingData memory auditingData) = _postedDispute(
            _one(_hopRun(entries[0], 2, _signers(ALICE_KEY))), entries, _snapshot(8, genesisData.participants)
        );
        _applyStep(dispute, _postedInvalidStep(auditingData, 0));
        _assertKilled(dispute);
    }

    function test_U99_hopWhoseInboundRunTheChainDoesNotHoldKillsItsStep() public {
        _seedAnchor(5);
        StateSnapshot[] memory entries =
            _entries(_snapshotAt(7, genesisData.participants, keccak256("an inbound block never posted"), 1));
        Dispute memory dispute = _dispute(_one(_hopRun(entries[0], 1, _signers(ALICE_KEY, BOB_KEY))));
        _applyStep(dispute, _invalidStep(entries, 0));
        _assertKilled(dispute);
    }

    function test_U99_milestoneStartingBelowThePreviousOneKillsItsStep() public {
        _seedAnchor(5);
        uint256[] memory both = _signers(ALICE_KEY, BOB_KEY);
        StateSnapshot[] memory entries =
            _entries(_snapshot(9, genesisData.participants), _snapshot(7, genesisData.participants));
        Dispute memory dispute = _dispute(_two(_hopRun(entries[0], 1, both), _hopRun(entries[1], 1, both)));
        _applyStep(dispute, _invalidStep(entries, 1));
        _assertKilled(dispute);
    }

    function test_U99_postedSnapshotItsBlockDoesNotCommitKillsThatStep() public {
        _seedAnchor(5);
        StateSnapshot memory hop = _snapshot(7, genesisData.participants);
        MilestoneProof memory run = _hopRun(hop, 1, _signers(ALICE_KEY, BOB_KEY));
        StateSnapshot memory committedWrong = _snapshot(7, _set(alice));
        (Dispute memory dispute, DisputeAuditingData memory auditingData) =
            _postedDispute(_one(run), _entries(committedWrong), hop);
        _applyStep(dispute, _postedInvalidStep(auditingData, 0));
        _assertKilled(dispute);
    }

    function test_U99_postedHonestProofIsNotKilledAtAnyStep() public {
        _seedAnchor(5);
        StateSnapshot memory hop = _snapshot(7, genesisData.participants);
        MilestoneProof memory run = _hopRun(hop, 1, _signers(ALICE_KEY, BOB_KEY));
        (Dispute memory dispute, DisputeAuditingData memory auditingData) =
            _postedDispute(_one(run), _entries(hop), hop);
        _applyStep(dispute, _postedInvalidStep(auditingData, 0));
        _assertRejected(dispute);
    }

    // ==================== block pointers: one per per-block fault ====================

    function test_U99_undecodableBlockKillsThroughTheBlockPointer() public {
        (MilestoneProof memory run, StateSnapshot memory anchor) = _anchorRun();
        run.blockConfirmations[2].signedBlock.encodedBlock = hex"deadbeef";
        Dispute memory dispute = _dispute(_one(run));
        _applyStep(dispute, _invalidBlockStep(_entries(anchor), 0, 2));
        _assertKilled(dispute);
    }

    function test_U99_brokenLinkKillsThroughTheBlockPointer() public {
        (MilestoneProof memory run, StateSnapshot memory anchor) = _anchorRun();
        _breakLinkAt(run, 2);
        Dispute memory dispute = _dispute(_one(run));
        _applyStep(dispute, _invalidBlockStep(_entries(anchor), 0, 2));
        _assertKilled(dispute);
    }

    function test_U99_blockOnAnotherForkKillsThroughTheBlockPointer() public {
        (MilestoneProof memory run, StateSnapshot memory anchor) = _anchorRun();
        _otherForkAt(run, 2);
        Dispute memory dispute = _dispute(_one(run));
        _applyStep(dispute, _invalidBlockStep(_entries(anchor), 0, 2));
        _assertKilled(dispute);
    }

    function test_U99_blockOnAnotherChannelKillsThroughTheBlockPointer() public {
        (MilestoneProof memory run, StateSnapshot memory anchor) = _anchorRun();
        Block memory b = _decode(run, 2);
        b.transaction.header.channelId = keccak256("another channel");
        _replaceBlock(run, 2, b, _signers(ALICE_KEY));
        Dispute memory dispute = _dispute(_one(run));
        _applyStep(dispute, _invalidBlockStep(_entries(anchor), 0, 2));
        _assertKilled(dispute);
    }

    function test_U99_wrongAuthorSignatureKillsThroughTheBlockPointer() public {
        (MilestoneProof memory run, StateSnapshot memory anchor) = _anchorRun();
        _badAuthorAt(run, 2);
        Dispute memory dispute = _dispute(_one(run));
        _applyStep(dispute, _invalidBlockStep(_entries(anchor), 0, 2));
        _assertKilled(dispute);
    }

    function test_U99_unrecoverableConfirmationSignatureKillsThroughTheBlockPointer() public {
        (MilestoneProof memory run, StateSnapshot memory anchor) = _anchorRun();
        run.blockConfirmations[2].signatures = new bytes[](1);
        run.blockConfirmations[2].signatures[0] = hex"0badc0de";
        Dispute memory dispute = _dispute(_one(run));
        _applyStep(dispute, _invalidBlockStep(_entries(anchor), 0, 2));
        _assertKilled(dispute);
    }

    function test_U99_validBlockOfARunWithABrokenLinkIsRejected() public {
        (MilestoneProof memory run, StateSnapshot memory anchor) = _anchorRun();
        _breakLinkAt(run, 2);
        Dispute memory dispute = _dispute(_one(run));
        _applyStep(dispute, _invalidBlockStep(_entries(anchor), 0, 1));
        _assertRejected(dispute);
    }

    function test_U99_brokenLinkBelowTheAnchorBlockIsNoFault() public {
        StateSnapshot memory anchor = _seedAnchor(5);
        // blocks 3..6: the anchor block is at position 2, history before it is not checked
        MilestoneProof memory run = _run(3, 4, keccak256("block 2"), _signers(ALICE_KEY));
        _breakLinkAt(run, 1);
        Dispute memory dispute = _dispute(_one(run));
        assertTrue(_walk(_one(run), _entries(anchor)).valid, "the walk skips history before the anchor block");
        _applyStep(dispute, _invalidBlockStep(_entries(anchor), 0, 1));
        _assertRejected(dispute);
    }

    // ==================== U111: substituted challenger evidence ====================
    // Existing pairs: StateProofChallenges test_U107_forgedChallengerSnapshotDoesNotInvalidateAnHonestProof and
    // test_U111_substitutedSnapshotForAnInvalidHopDoesNotEstablishIt (a substituted resulting snapshot, with
    // test_U107_omittedDataInsufficientHopSignaturesAreCountered as the genuine kill).

    /// From the anchor 5 {A, B}: hop 7 {A, B} signed by A and B, hop 9 {A} signed by A alone (B's signature is
    /// required), and a last milestone 11 {A} everyone signed, so the auditing data may be omitted
    function _invalidMiddleHop() private returns (Dispute memory dispute, StateSnapshot[] memory entries) {
        _seedAnchor(5);
        uint256[] memory both = _signers(ALICE_KEY, BOB_KEY);
        entries =
            _entries(_snapshot(7, genesisData.participants), _snapshot(9, _set(alice)), _snapshot(11, _set(alice)));
        dispute = _dispute(
            _three(
                _hopRun(entries[0], 1, both), _hopRun(entries[1], 1, _signers(ALICE_KEY)), _hopRun(entries[2], 1, both)
            )
        );
        assertTrue(harness.isAuditingDataOmissionAllowed(dispute), "premise: omitted under the everyone rule");
    }

    function test_U111_genuinePreviousSnapshotOfTheMiddleHopKills() public {
        (Dispute memory dispute, StateSnapshot[] memory entries) = _invalidMiddleHop();
        _applyStep(dispute, _invalidStep(entries, 1));
        _assertKilled(dispute);
    }

    function test_U111_substitutedPreviousSnapshotOfTheMiddleHopIsRejected() public {
        // an honest proof: hops 7, 9 and 11, each {A, B} signed by A and B
        _seedAnchor(5);
        uint256[] memory both = _signers(ALICE_KEY, BOB_KEY);
        StateSnapshot[] memory entries = _entries(
            _snapshot(7, genesisData.participants),
            _snapshot(9, genesisData.participants),
            _snapshot(11, genesisData.participants)
        );
        Dispute memory dispute =
            _dispute(_three(_hopRun(entries[0], 1, both), _hopRun(entries[1], 1, both), _hopRun(entries[2], 1, both)));
        assertTrue(_walk(dispute.input.stateProof.milestones, entries).valid, "premise: an honest proof");
        // a previous point with a larger set {A, B, C} would make C's missing signature a fault at hop 9; it is not
        // the snapshot milestone 0's first block commits to
        entries[0] = _snapshot(7, _set(alice, bob, carol));
        _applyStep(dispute, _invalidStep(entries, 1));
        _assertRejected(dispute);
    }

    /// A hop from the anchor 5 {A, B} to 7, signed by A and B. With `consumesJoin` its committed snapshot consumes
    /// D's on-chain JOIN while leaving D out; otherwise the JOIN lands after the hop's inbound interval.
    function _hopAroundDaveJoin(bool consumesJoin)
        private
        returns (Dispute memory dispute, StateSnapshot memory committed, StateSnapshot memory claimed)
    {
        _seedAnchor(5);
        (, bytes32 joinHash) = _seedJoin(bytes32(0), 1, dave);
        claimed = _snapshotAt(7, genesisData.participants, joinHash, 1);
        committed = consumesJoin ? claimed : _snapshot(7, genesisData.participants);
        MilestoneProof memory run = _hopRun(committed, 1, _signers(ALICE_KEY, BOB_KEY));
        StateSnapshot memory latest = _snapshot(8, genesisData.participants);
        _commitAt(run, 0, keccak256(abi.encode(committed)), _signers(ALICE_KEY, BOB_KEY));
        (dispute,) = _postedDispute(_one(run), _entries(committed), latest);
        // omitted data: the challenger supplies the step's snapshots
        dispute.postedAuditingData = false;
        dispute.input.disputeAuditingDataHash = bytes32(0);
        dispute.input.latestStateSnapshotHash = keccak256(abi.encode(committed));
    }

    function test_U111_joinInsideTheHopsInboundIntervalWithoutTheJoinersSignatureKills() public {
        (Dispute memory dispute, StateSnapshot memory committed,) = _hopAroundDaveJoin(true);
        // the genuine committed evidence: the hop's snapshot consumes D's JOIN
        (Dispute memory posted, DisputeAuditingData memory auditingData) =
            _postedDispute(dispute.input.stateProof.milestones, _entries(committed), committed);
        _applyStep(posted, _postedInvalidStep(auditingData, 0));
        _assertKilled(posted);
    }

    function test_U111_joinAfterTheHopsInboundIntervalCannotBeClaimedWithASubstitutedSnapshot() public {
        (Dispute memory dispute,, StateSnapshot memory claimed) = _hopAroundDaveJoin(false);
        assertTrue(harness.isAuditingDataOmissionAllowed(dispute), "premise: the honest hop may omit its data");
        // the challenger claims the hop consumed D's JOIN: that snapshot is not the hop's commitment
        _applyStep(dispute, _invalidStep(_entries(claimed), 0));
        _assertRejected(dispute);
    }

    function test_U111_substitutedPreviousSnapshotWideningTheInboundIntervalIsRejected() public {
        // C joined and left before the anchor 5 {A, B}, whose inbound head is C's JOIN; hops 7 and 9 keep it
        (, bytes32 joinHash) = _seedJoin(bytes32(0), 1, carol);
        harness.seedSnapshot(CHANNEL, _snapshotAt(5, genesisData.participants, joinHash, 1));
        uint256[] memory both = _signers(ALICE_KEY, BOB_KEY);
        StateSnapshot[] memory entries = _entries(
            _snapshotAt(7, genesisData.participants, joinHash, 1), _snapshotAt(9, genesisData.participants, joinHash, 1)
        );
        Dispute memory dispute = _dispute(_two(_hopRun(entries[0], 1, both), _hopRun(entries[1], 1, both)));
        assertTrue(_walk(dispute.input.stateProof.milestones, entries).valid, "premise: an honest proof");
        // a previous point before C's JOIN would make hop 9 consume it and require C's signature
        entries[0] = _snapshot(7, genesisData.participants);
        _applyStep(dispute, _invalidStep(entries, 1));
        _assertRejected(dispute);
    }

    // ==================== per-step paths ====================

    function test_U99_stepAfterTheAnchorRunWithTheAnchorMidMilestoneStartsAtTheAnchor() public {
        StateSnapshot memory anchor = _seedAnchor(5);
        // the anchor run 3..6 holds the anchor mid-milestone; the hop to 8 {A} lacks B's signature
        MilestoneProof memory run = _run(3, 4, keccak256("block 2"), _signers(ALICE_KEY));
        StateSnapshot memory hop = _snapshot(8, _set(alice));
        (Dispute memory dispute, DisputeAuditingData memory auditingData) =
            _postedDispute(_two(run, _hopRun(hop, 1, _signers(ALICE_KEY))), _entries(anchor, hop), hop);
        _applyStep(dispute, _postedInvalidStep(auditingData, 1));
        _assertKilled(dispute);
    }

    function test_U99_stepAfterAWhollySkippedMilestoneStartsAtTheAnchor() public {
        StateSnapshot memory anchor = _seedAnchor(5);
        // wholly below the anchor (judged by its last block 3): its first block's bytes are never read
        MilestoneProof memory below = _run(2, 2, keccak256("block 1"), _signers(ALICE_KEY));
        below.blockConfirmations[0].signedBlock.encodedBlock = hex"deadbeef";
        StateSnapshot memory hop = _snapshot(7, genesisData.participants);
        (Dispute memory dispute, DisputeAuditingData memory auditingData) =
            _postedDispute(_two(below, _hopRun(hop, 1, _signers(ALICE_KEY))), _entries(anchor, hop), hop);
        _applyStep(dispute, _postedInvalidStep(auditingData, 1));
        _assertKilled(dispute);
    }

    function test_U99_blockPointerIntoAWhollySkippedMilestoneIsNoFault() public {
        StateSnapshot memory anchor = _seedAnchor(5);
        MilestoneProof memory below = _run(1, 3, keccak256("block 0"), _signers(ALICE_KEY));
        _breakLinkAt(below, 1);
        MilestoneProof memory run = _run(5, 3, keccak256("block 4"), _signers(ALICE_KEY));
        Dispute memory dispute = _dispute(_two(below, run));
        assertTrue(_walk(dispute.input.stateProof.milestones, _entries(anchor, anchor)).valid, "premise: valid walk");
        _applyStep(dispute, _invalidBlockStep(_entries(anchor, anchor), 0, 0));
        _assertRejected(dispute);
    }

    function test_U99_blockPointerPastTheMilestoneIsNoFault() public {
        (MilestoneProof memory run, StateSnapshot memory anchor) = _anchorRun();
        Dispute memory dispute = _dispute(_one(run));
        // the walk is valid; the pointer names no block: the challenger pays, nothing reverts
        _applyStep(dispute, _invalidBlockStep(_entries(anchor), 0, 9));
        _assertRejected(dispute);
    }

    /// From the anchor 5 {A, B}: hop 7, hop 9 whose third block (11) does not link, and a final last hop 13, all
    /// signed by A and B, so the auditing data may be omitted
    function _brokenLinkInTheMiddleMilestone()
        private
        returns (Dispute memory dispute, StateSnapshot[] memory entries)
    {
        _seedAnchor(5);
        uint256[] memory both = _signers(ALICE_KEY, BOB_KEY);
        entries = _entries(
            _snapshot(7, genesisData.participants),
            _snapshot(9, genesisData.participants),
            _snapshot(13, genesisData.participants)
        );
        MilestoneProof memory middle = _hopRun(entries[1], 3, both);
        _breakLinkAt(middle, 2);
        dispute = _dispute(_three(_hopRun(entries[0], 1, both), middle, _hopRun(entries[2], 1, both)));
        assertTrue(harness.isAuditingDataOmissionAllowed(dispute), "premise: omitted under the everyone rule");
    }

    function test_U99_blockPointerAtTheSecondMilestoneWithItsGenuinePreviousSnapshotKills() public {
        (Dispute memory dispute, StateSnapshot[] memory entries) = _brokenLinkInTheMiddleMilestone();
        _applyStep(dispute, _invalidBlockStep(entries, 1, 2));
        _assertKilled(dispute);
    }

    function test_U99_blockPointerAtTheSecondMilestoneWithASubstitutedPreviousSnapshotIsRejected() public {
        (Dispute memory dispute, StateSnapshot[] memory entries) = _brokenLinkInTheMiddleMilestone();
        entries[0] = _snapshot(7, _set(alice));
        _applyStep(dispute, _invalidBlockStep(entries, 1, 2));
        _assertRejected(dispute);
    }

    function test_U99_omittedDataDisputeThatMayNotOmitIsKilledByTheInvalidStep() public {
        _seedAnchor(5);
        StateSnapshot[] memory entries = _entries(_snapshot(7, genesisData.participants));
        // the only milestone is a hop A alone signed: its data may not be omitted, and the hop is invalid
        Dispute memory dispute = _dispute(_one(_hopRun(entries[0], 1, _signers(ALICE_KEY))));
        assertFalse(harness.isAuditingDataOmissionAllowed(dispute), "premise: the data may not be omitted");
        _applyStep(dispute, _invalidStep(entries, 0));
        _assertKilled(dispute);
    }

    function test_U120_postedExcessSnapshotEntriesAreKilledByTheStepCounter() public {
        _seedAnchor(5);
        StateSnapshot memory hop = _snapshot(7, genesisData.participants);
        MilestoneProof memory run = _hopRun(hop, 1, _signers(ALICE_KEY, BOB_KEY));
        // an honest hop, but the committed data holds two snapshots for one milestone
        (Dispute memory dispute, DisputeAuditingData memory auditingData) =
            _postedDispute(_one(run), _entries(hop, hop), hop);
        _applyStep(dispute, _postedInvalidStep(auditingData, 0));
        _assertKilled(dispute);
    }

    // ==================== omitted-data genesis on a successor fork ====================

    /// a successor fork of this fork, {A, B}, whose chain snapshot stays on the ancestor; `dated` opens and expires
    /// the ancestor's window, which dates the successor genesis
    function _successorGenesisRun(bool dated)
        private
        returns (Dispute memory dispute, SnapshotData memory successorData)
    {
        successorData = abi.decode(abi.encode(genesisData), (SnapshotData));
        successorData.originForkId = forkId;
        bytes32 successorForkId = keccak256(abi.encode(successorData));
        StateSnapshot memory successorGenesis;
        successorGenesis.snapshotData = successorData;
        successorGenesis.forkId = successorForkId;
        if (dated) successorGenesis.timestamp = harness.seedExpiredOriginWindow(CHANNEL, forkId);
        MilestoneProof memory run = _run(0, 2, keccak256("unused"), _signers(ALICE_KEY, BOB_KEY));
        _onFork(run, successorForkId, keccak256(abi.encode(successorGenesis)), _signers(ALICE_KEY, BOB_KEY));
        dispute = _dispute(_one(run));
        dispute.input.forkId = successorForkId;
    }

    function test_U102_challengersGenesisDataOfAnotherForkIsRejected() public {
        (Dispute memory dispute,) = _successorGenesisRun(true);
        // the ancestor's genesis data does not hash to the successor fork
        _applyStep(dispute, _invalidStep(new StateSnapshot[](0), 0));
        _assertRejected(dispute);
    }

    function test_U102_undatedSuccessorGenesisIsAFaultOfTheFirstStep() public {
        (Dispute memory dispute, SnapshotData memory successorData) = _successorGenesisRun(false);
        DisputeInvalidStateProof memory proof;
        proof.auditingData.genesisStateSnapshotData = successorData;
        _applyStep(dispute, abi.encode(proof));
        _assertKilled(dispute);
    }

    // ==================== the omitted-joiner cases, through the hop's step ====================

    /// The chain anchor 5 is {A, B} and C's JOIN is on chain. A's posted-data dispute carries `honestHops` honest
    /// {A, B} hops, then a hop that consumes C's JOIN with `joinHopParticipants`, signed by `joinHopSigners`, then a
    /// last hop with no inbound change (and an unfinalized tail block).
    function _stage(uint256 honestHops, address[] memory joinHopParticipants, uint256[] memory joinHopSigners)
        private
        returns (Staged memory staged)
    {
        staged.anchor = _seedAnchor(5);
        bytes32 joinHash;
        (staged.join, joinHash) = _seedJoin(bytes32(0), 1, carol);
        uint256 count = honestHops + 2;
        MilestoneProof[] memory milestones = new MilestoneProof[](count);
        staged.entries = new StateSnapshot[](count);
        for (uint256 i = 0; i < honestHops; i++) {
            staged.entries[i] = _snapshot(7 + 2 * i, genesisData.participants);
            milestones[i] = _hopRun(staged.entries[i], 1, _signers(ALICE_KEY, BOB_KEY));
        }
        staged.joinHop = honestHops;
        uint256 height = 7 + 2 * honestHops;
        staged.entries[honestHops] = _snapshotAt(height, joinHopParticipants, joinHash, 1);
        milestones[honestHops] = _hopRun(staged.entries[honestHops], 1, joinHopSigners);
        staged.entries[honestHops + 1] = _snapshotAt(height + 2, joinHopParticipants, joinHash, 1);
        StateSnapshot memory latest = _snapshotAt(height + 3, joinHopParticipants, joinHash, 1);
        MilestoneProof memory last = _hopRun(staged.entries[honestHops + 1], 2, _signers(ALICE_KEY, BOB_KEY));
        _commitAt(last, 1, keccak256(abi.encode(latest)), _signers(ALICE_KEY));
        milestones[honestHops + 1] = last;
        (staged.dispute, staged.auditingData) = _postedDispute(milestones, staged.entries, latest);
        staged.dispute.input.latestInboundMessageBlockHash = joinHash;
        staged.dispute.input.lastInboundMessageBlockHeight = 1;
        staged.auditingData.inboundMessageBlocks = _inbound(staged.join);
        staged.dispute.input.disputeAuditingDataHash = keccak256(abi.encode(staged.auditingData));
    }

    /// the join hop consumes C's JOIN but leaves C out, signed by A and B only
    function _lieOverTheLastTwoMilestones(uint256 honestHops) private returns (Staged memory) {
        return _stage(honestHops, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
    }

    function test_U99_joinHopLeavingTheJoinerOutIsKilledAtThatHop() public {
        Staged memory staged = _lieOverTheLastTwoMilestones(0);
        // the required set includes the pending joiner C, who signed nothing
        assertFalse(_diamond().isAuditingDataOmissionAllowed(staged.dispute), "auditing data may not be omitted");
        _applyStep(staged.dispute, _postedInvalidStep(staged.auditingData, staged.joinHop));
        _assertKilled(staged.dispute);
    }

    function test_U99_lastHopAfterTheJoinHopIsAValidStepAndIsRejected() public {
        Staged memory staged = _lieOverTheLastTwoMilestones(0);
        // the last hop consumes nothing: its union is {A, B}, who signed it
        _applyStep(staged.dispute, _postedInvalidStep(staged.auditingData, staged.joinHop + 1));
        _assertRejected(staged.dispute);
    }

    function test_U99_listedButUnsignedJoinerIsKilledAtTheJoinHop() public {
        Staged memory staged = _stage(0, _set(alice, bob, carol), _signers(ALICE_KEY, BOB_KEY));
        _applyStep(staged.dispute, _postedInvalidStep(staged.auditingData, staged.joinHop));
        _assertKilled(staged.dispute);
    }

    /// a block authored and signed by C at the height after the join hop, linked to `previousBlockHash`
    function _carolBlock(Staged memory staged, bytes32 previousBlockHash)
        private
        view
        returns (BlockConfirmation memory)
    {
        uint256 height = staged.entries[staged.joinHop].blockHeight + 1;
        Block memory b = _block(height, previousBlockHash, _hashAt(height));
        b.transaction.header.participant = carol;
        return _blockConfirmation(abi.encode(b), _signers(CAROL_KEY));
    }

    /// appends `confirmation` to the join hop's milestone
    function _spliceIntoTheJoinHop(Staged memory staged, BlockConfirmation memory confirmation) private pure {
        MilestoneProof memory hop = staged.dispute.input.stateProof.milestones[staged.joinHop];
        BlockConfirmation[] memory spliced = new BlockConfirmation[](hop.blockConfirmations.length + 1);
        for (uint256 i = 0; i < hop.blockConfirmations.length; i++) {
            spliced[i] = hop.blockConfirmations[i];
        }
        spliced[hop.blockConfirmations.length] = confirmation;
        hop.blockConfirmations = spliced;
    }

    function test_U99_joinerBlockSplicedFromAnotherRunIsKilledThroughTheBlockPointer() public {
        Staged memory staged = _lieOverTheLastTwoMilestones(0);
        _spliceIntoTheJoinHop(staged, _carolBlock(staged, keccak256("another run")));
        DisputeInvalidStateProof memory proof;
        proof.milestoneIndex = staged.joinHop;
        proof.hasBlockIndex = true;
        proof.blockIndex = 1;
        proof.auditingData = staged.auditingData;
        _applyStep(staged.dispute, abi.encode(proof));
        _assertKilled(staged.dispute);
    }

    function test_U99_control_linkedJoinerBlockMakesTheJoinHopAValidStep() public {
        Staged memory staged = _lieOverTheLastTwoMilestones(0);
        bytes memory joinHopBlock =
            staged.dispute.input.stateProof.milestones[staged.joinHop].blockConfirmations[0].signedBlock.encodedBlock;
        _spliceIntoTheJoinHop(staged, _carolBlock(staged, keccak256(joinHopBlock)));
        assertTrue(_chainAcceptsPostedProof(staged.dispute, staged.auditingData), "the linked proof passes the walk");
        _applyStep(staged.dispute, _postedInvalidStep(staged.auditingData, staged.joinHop));
        _assertRejected(staged.dispute);
    }

    // ==================== the pointed step's cost ====================

    function _measure(uint256 honestHops) private returns (uint256 gasUsed) {
        Staged memory staged = _lieOverTheLastTwoMilestones(honestHops);
        _commit(staged.dispute);
        bytes memory proof = _postedInvalidStep(staged.auditingData, staged.joinHop);
        uint256 before = gasleft();
        _apply(staged.dispute, DisputeFraudProofType.DisputeInvalidStateProof, proof);
        gasUsed = before - gasleft();
        _assertKilled(staged.dispute);
        console.log("hops before the join hop", honestHops);
        console.log("  pointed DisputeInvalidStateProof gas", gasUsed);
    }

    function test_U99_pointedStepStaysBoundedAsHopsBeforeItGrow() public {
        // every measurement stages its JOIN and dispute on the fresh channel, so each kill check is its own
        uint256 fresh = vm.snapshotState();
        uint256 eightHops = _measure(8);
        vm.revertToState(fresh);
        uint256 thirtyTwoHops = _measure(32);
        vm.revertToState(fresh);
        // 24 more hops only add copying and hashing of the larger dispute, far less than walking them
        uint256 fullWalkOfThirtyTwo = _fullWalkGas(32);
        console.log("  full walk gas with 32 hops before", fullWalkOfThirtyTwo);
        assertLt(thirtyTwoHops - eightHops, (fullWalkOfThirtyTwo - eightHops) / 2, "the step does not walk the hops");
    }

    function _measureOmittedFinalRun(uint256 length) private returns (uint256 applyGas, uint256 finalRunGas) {
        _seedAnchor(5);
        StateSnapshot[] memory entries =
            _entries(_snapshot(7, genesisData.participants), _snapshot(20, genesisData.participants));
        MilestoneProof memory fault = _hopRun(entries[0], 1, _signers(ALICE_KEY));
        MilestoneProof memory finalRun = _hopRun(entries[1], length, _signers(ALICE_KEY, BOB_KEY));
        Dispute memory dispute = _dispute(_two(fault, finalRun));
        _commit(dispute);
        bytes memory proof = _invalidStep(entries, 0);
        uint256 before = gasleft();
        _apply(dispute, DisputeFraudProofType.DisputeInvalidStateProof, proof);
        applyGas = before - gasleft();
        _assertKilled(dispute);
        before = gasleft();
        (bool isFinal,) = _diamond().isMilestoneFinal(forkId, genesisData, finalRun);
        finalRunGas = before - gasleft();
        assertTrue(isFinal, "the unrelated final run really is final");
    }

    function test_PO1_omittedDataStepDoesNotWalkTheUnrelatedFinalRun() public {
        uint256 fresh = vm.snapshotState();
        (uint256 shortApply, uint256 shortWalk) = _measureOmittedFinalRun(8);
        vm.revertToState(fresh);
        (uint256 longApply, uint256 longWalk) = _measureOmittedFinalRun(32);
        // The payload still grows; its copying/hash cost must exclude the unrelated semantic walk.
        assertLt(
            longApply - shortApply,
            (longWalk - shortWalk) / 2,
            "unrelated signature and link checks leaked into the step"
        );
    }

    /// the gas of the full walk of the 32-hop proof (what a whole-proof counter pays)
    function _fullWalkGas(uint256 honestHops) private returns (uint256 gasUsed) {
        Staged memory staged = _lieOverTheLastTwoMilestones(honestHops);
        uint256 before = gasleft();
        assertFalse(_chainAcceptsPostedProof(staged.dispute, staged.auditingData), "the posted proof fails the walk");
        gasUsed = before - gasleft();
    }
}
