pragma solidity ^0.8.8;

import {StateProofStaging} from "../harness/StateProofStaging.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/DisputeTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

// test naming: test_<canonical case in camel case>
contract StateProofWalkTest is StateProofStaging {
    function setUp() public {
        _stageGenesisChannel();
    }

    // ---- the on-chain anchor ----

    function test_anchorSnapshot_canStartFromTheOnChainSnapshotOnItsOwnForkAboveHeightZero() public {
        StateSnapshot memory anchor = _seedAnchor(ANCHOR_HEIGHT);
        (bool canUseOnChainSnapshot, StateSnapshot memory onChainSnapshot) =
            _diamond().getAnchorSnapshot(CHANNEL, forkId);
        assertTrue(canUseOnChainSnapshot);
        assertEq(keccak256(abi.encode(onChainSnapshot)), keccak256(abi.encode(anchor)));
    }

    function test_anchorSnapshot_cannotStartFromTheGenesisOrAnotherFork() public {
        // the genesis is recognized by its data, which the fork ID hashes
        (bool canUseOnChainSnapshot,) = _diamond().getAnchorSnapshot(CHANNEL, forkId);
        assertFalse(canUseOnChainSnapshot, "the on-chain snapshot is the fork genesis");
        _seedAnchor(ANCHOR_HEIGHT);
        (canUseOnChainSnapshot,) = _diamond().getAnchorSnapshot(CHANNEL, keccak256("other-fork"));
        assertFalse(canUseOnChainSnapshot, "the on-chain snapshot is on another fork");
    }

    // ---- normal anchor ----

    function test_normalAnchorInsideRunSuppliesFinalState() public {
        StateSnapshot memory anchor = _seedAnchor(ANCHOR_HEIGHT);
        // only the author signed: the anchor supplies final state and set, no threshold recount
        MilestoneProof[] memory milestones =
            _two(_run(1, 2, bytes32(0), _signers(ALICE_KEY)), _run(3, 5, keccak256("unlinked"), _signers(ALICE_KEY)));
        ProofWalkResult memory result = _walk(milestones, _entries(anchor, anchor));
        assertTrue(result.valid);
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(anchor)));
        assertEq(result.replayBlockIndex, 3);
    }

    function test_normalAnchorAtZeroDiffersFromGenesis() public {
        // block 0 committed the on-chain snapshot: height alone cannot tell it from the genesis, its data can
        StateSnapshot memory anchorAtZero = _seedAnchor(0);
        ProofWalkResult memory result =
            _walk(_one(_run(0, 2, keccak256("not the genesis link"), _signers(ALICE_KEY))), _entries(anchorAtZero));
        assertTrue(result.valid);
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(anchorAtZero)));
        assertEq(result.replayBlockIndex, 1);

        // a genesis-linked block 0 that does not commit the normal anchor is not this fork's history
        MilestoneProof memory genesisLinked = _genesisRun(2, _set(alice), _signers(ALICE_KEY, BOB_KEY));
        assertFalse(_walk(_one(genesisLinked), _entries(anchorAtZero)).valid);
    }

    function test_anchorAtFirstOffset() public {
        StateSnapshot memory anchor = _seedAnchor(ANCHOR_HEIGHT);
        // the block at the anchor height needs no predecessor: it commits the anchor
        ProofWalkResult memory result =
            _walk(_one(_run(ANCHOR_HEIGHT, 3, keccak256("unlinked"), _signers(ALICE_KEY))), _entries(anchor));
        assertTrue(result.valid);
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(anchor)));
        assertEq(result.replayBlockIndex, 1);
    }

    function test_anchorAtLastOffset() public {
        StateSnapshot memory anchor = _seedAnchor(ANCHOR_HEIGHT);
        ProofWalkResult memory result =
            _walk(_one(_run(ANCHOR_HEIGHT - 2, 3, bytes32(0), _signers(ALICE_KEY))), _entries(anchor));
        assertTrue(result.valid);
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(anchor)));
        assertEq(result.replayBlockIndex, 3, "the anchor is the latest block: no tail");
    }

    // ---- genesis block zero ----

    function test_genesisUnfinalZeroReplaysFromZero() public {
        MilestoneProof memory run = _genesisRun(3, genesisData.participants, _signers(ALICE_KEY));
        ProofWalkResult memory result = _walk(_one(run), _entries(_snapshot(0, genesisData.participants)));
        assertTrue(result.valid, "a single last unfinal zero run is valid");
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(genesis)));
        assertEq(result.replayBlockIndex, 0);
    }

    function test_genesisFinalZeroReplaysAfterZero() public {
        StateSnapshot memory zero = _snapshot(0, genesisData.participants);
        ProofWalkResult memory result =
            _walk(_one(_genesisRun(3, genesisData.participants, _signers(ALICE_KEY, BOB_KEY))), _entries(zero));
        assertTrue(result.valid);
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(zero)));
        assertEq(result.replayBlockIndex, 1);
    }

    function test_finalZeroJoinAdvancesVerifiedSet() public {
        address[] memory joined = _set(alice, bob, carol);
        uint256[] memory everyone = _signers(ALICE_KEY, BOB_KEY, CAROL_KEY);
        StateSnapshot[] memory snapshots = _entries(_snapshot(0, joined), _snapshot(3, joined));
        MilestoneProof[] memory milestones =
            _two(_genesisRun(1, joined, everyone), _thresholdRun(3, 1, joined, everyone));
        ProofWalkResult memory result = _walk(milestones, snapshots);
        assertTrue(result.valid);
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(snapshots[1])));

        // the joined set is the next hop's old set: C's signature is required there
        milestones[1] = _thresholdRun(3, 1, joined, _signers(ALICE_KEY, BOB_KEY));
        assertFalse(_walk(milestones, snapshots).valid);
    }

    function test_finalZeroExitAdvancesVerifiedSet() public {
        address[] memory exited = _set(alice);
        // B leaves at block 0: the old/new union {A, B} signs it
        StateSnapshot[] memory snapshots = _entries(_snapshot(0, exited), _snapshot(3, exited));
        MilestoneProof[] memory milestones =
            _two(_genesisRun(1, exited, _signers(ALICE_KEY, BOB_KEY)), _thresholdRun(3, 1, exited, _signers(ALICE_KEY)));
        ProofWalkResult memory result = _walk(milestones, snapshots);
        assertTrue(result.valid);
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(snapshots[1])));
        assertEq(result.replayBlockIndex, 1);

        // the exited set is the next hop's old set: without the exit at 0, B's signature is required at 3
        milestones[0] = _genesisRun(1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        snapshots[0] = _snapshot(0, genesisData.participants);
        assertFalse(_walk(milestones, snapshots).valid);
    }

    function test_missingOldSignerCannotFinalizeZero() public {
        address[] memory joined = _set(alice, bob, carol);
        // B is in the old set and did not sign
        ProofWalkResult memory result =
            _walk(_one(_genesisRun(2, joined, _signers(ALICE_KEY, CAROL_KEY))), _entries(_snapshot(0, joined)));
        assertTrue(result.valid);
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(genesis)));
        assertEq(result.replayBlockIndex, 0);
    }

    function test_missingNewSignerCannotFinalizeZero() public {
        address[] memory joined = _set(alice, bob, carol);
        // the joiner C is in the new set and did not sign
        ProofWalkResult memory result =
            _walk(_one(_genesisRun(2, joined, _signers(ALICE_KEY, BOB_KEY))), _entries(_snapshot(0, joined)));
        assertTrue(result.valid);
        assertEq(result.replayBlockIndex, 0);
    }

    // ---- the union threshold ----

    function test_pendingJoinInThresholdIntervalCounts() public {
        // C's join lands between the genesis inbound head and the milestone's resulting inbound head
        harness.seedInboundJoin(CHANNEL, keccak256("join"), carol);
        StateSnapshot memory resulting = _snapshot(3, genesisData.participants);
        resulting.snapshotData.latestInboundMessageBlockHash = keccak256("join");
        MilestoneProof memory run = _thresholdRun(3, 1, genesisData.participants, _signers(ALICE_KEY));
        _commitAt(run, 0, keccak256(abi.encode(resulting)), _signers(ALICE_KEY, BOB_KEY));
        assertFalse(_walk(_one(run), _entries(resulting)).valid, "the pending joiner C is required");

        _commitAt(run, 0, keccak256(abi.encode(resulting)), _signers(ALICE_KEY, BOB_KEY, CAROL_KEY));
        assertTrue(_walk(_one(run), _entries(resulting)).valid);
    }

    function test_onlyDistinctExpectedSignersCount() public {
        StateSnapshot[] memory snapshots = _entries(_snapshot(3, genesisData.participants));
        // the outsider C signs in place of B
        MilestoneProof memory run = _thresholdRun(3, 1, genesisData.participants, _signers(ALICE_KEY, CAROL_KEY));
        assertFalse(_walk(_one(run), snapshots).valid, "outsider");
        // A signs again; B never signs
        run = _thresholdRun(3, 1, genesisData.participants, _signers(ALICE_KEY, ALICE_KEY));
        assertFalse(_walk(_one(run), snapshots).valid, "duplicate");
    }

    function test_laterMilestoneRequiresUnionThreshold() public {
        MilestoneProof memory run = _thresholdRun(3, 1, genesisData.participants, _signers(ALICE_KEY));
        assertFalse(_walk(_one(run), _entries(_snapshot(3, genesisData.participants))).valid);
    }

    // ---- overlap and order ----

    function test_overlappingMilestonesProveDistinctStates() public {
        MilestoneProof memory first = _genesisRun(3, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        // [1, 2, 3] overlaps [0, 1, 2]; its first block 1 is proven by its own threshold
        MilestoneProof memory second =
            _run(1, 3, keccak256(first.blockConfirmations[0].signedBlock.encodedBlock), _signers(ALICE_KEY, BOB_KEY));
        StateSnapshot[] memory snapshots =
            _entries(_snapshot(0, genesisData.participants), _snapshot(1, genesisData.participants));
        ProofWalkResult memory result = _walk(_two(first, second), snapshots);
        assertTrue(result.valid);
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(snapshots[1])));
        assertEq(result.replayBlockIndex, 1);
    }

    function test_identicalFirstBlocksRemainValid() public {
        uint256[] memory both = _signers(ALICE_KEY, BOB_KEY);
        StateSnapshot memory three = _snapshot(3, genesisData.participants);
        // [3] and [3, 4] start with the same block 3; each copy proves its own threshold
        MilestoneProof memory first = _thresholdRun(3, 1, genesisData.participants, both);
        MilestoneProof memory repeat = _thresholdRun(3, 2, genesisData.participants, both);
        assertEq(
            keccak256(repeat.blockConfirmations[0].signedBlock.encodedBlock),
            keccak256(first.blockConfirmations[0].signedBlock.encodedBlock),
            "one block 3"
        );
        ProofWalkResult memory result = _walk(_two(first, repeat), _entries(three, three));
        assertTrue(result.valid);
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(three)));
        assertEq(result.replayBlockIndex, 1);

        // a repeat signed by its author alone does not keep the first copy's finality
        repeat = _thresholdRun(3, 2, genesisData.participants, _signers(ALICE_KEY));
        assertFalse(_walk(_two(first, repeat), _entries(three, three)).valid);
    }

    function test_equalHeightDifferentSnapshotCannotInheritFinality() public {
        StateSnapshot memory three = _snapshot(3, genesisData.participants);
        MilestoneProof memory proven = _thresholdRun(3, 1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        assertTrue(_walk(_one(proven), _entries(three)).valid, "control");

        // another block 3, committing another state, signed by its author only
        StateSnapshot memory other = _snapshot(3, genesisData.participants);
        other.snapshotData.stateMachineStateHash = keccak256("another state at 3");
        MilestoneProof memory weak = _thresholdRun(3, 1, genesisData.participants, _signers(ALICE_KEY));
        _commitAt(weak, 0, keccak256(abi.encode(other)), _signers(ALICE_KEY));
        assertFalse(_walk(_two(proven, weak), _entries(three, other)).valid, "its own snapshot");
        assertFalse(_walk(_two(proven, weak), _entries(three, three)).valid, "the proven snapshot");
    }

    function test_membershipChangeCannotBeOmitted() public {
        address[] memory afterJoin = _set(alice, carol);
        // B leaves at 3, C joins at 6: B never signs block 6
        MilestoneProof memory joinHop = _thresholdRun(6, 1, afterJoin, _signers(ALICE_KEY, CAROL_KEY));
        assertFalse(_walk(_one(joinHop), _entries(_snapshot(6, afterJoin))).valid, "B's exit is required evidence");

        MilestoneProof memory exitHop = _thresholdRun(3, 1, _set(alice), _signers(ALICE_KEY, BOB_KEY));
        StateSnapshot[] memory snapshots = _entries(_snapshot(3, _set(alice)), _snapshot(6, afterJoin));
        assertTrue(_walk(_two(exitHop, joinHop), snapshots).valid);
    }

    function test_unfinalZeroBesideAnotherMilestoneIsInvalid() public {
        MilestoneProof memory finalZero = _genesisRun(1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        // another block 0, committing another state, signed by its author only
        MilestoneProof memory unfinalZero = _genesisRun(1, _set(alice), _signers(ALICE_KEY));
        StateSnapshot memory finalState = _snapshot(0, genesisData.participants);
        StateSnapshot memory unfinalState = _snapshot(0, _set(alice));
        assertFalse(_walk(_two(finalZero, unfinalZero), _entries(finalState, unfinalState)).valid, "final, other");
        assertFalse(_walk(_two(unfinalZero, finalZero), _entries(unfinalState, finalState)).valid, "other, final");
    }

    function test_decreasingMilestoneFirstHeightsReject() public {
        MilestoneProof memory three = _thresholdRun(3, 1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        MilestoneProof memory two = _thresholdRun(2, 1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        StateSnapshot memory threeState = _snapshot(3, genesisData.participants);
        StateSnapshot memory twoState = _snapshot(2, genesisData.participants);
        assertFalse(_walk(_two(three, two), _entries(threeState, twoState)).valid);
        assertTrue(_walk(_two(two, three), _entries(twoState, threeState)).valid, "the ascending order is valid");
    }

    // ---- dropped, empty and kept defects ----

    function test_allDroppedProofSuppliesNoFinalBlock() public {
        StateSnapshot memory anchor = _seedAnchor(ANCHOR_HEIGHT);
        ProofWalkResult memory result = _walk(_one(_run(1, 3, bytes32(0), _signers(ALICE_KEY))), _entries(anchor));
        assertTrue(result.valid, "a proof ending below the start is accepted, not certified");
        assertEq(result.replayBlockIndex, 3, "no tail");
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(anchor)));
    }

    function test_droppedPrefixCannotInstallSnapshot() public {
        StateSnapshot memory anchor = _seedAnchor(ANCHOR_HEIGHT);
        MilestoneProof[] memory milestones = _two(
            _run(1, 2, bytes32(0), _signers(ALICE_KEY, BOB_KEY)),
            _run(ANCHOR_HEIGHT, 2, bytes32(0), _signers(ALICE_KEY))
        );
        // a forged entry for the dropped milestone, naming an outsider set
        ProofWalkResult memory result = _walk(milestones, _entries(_snapshot(1, _set(vm.addr(0x0BAD))), anchor));
        assertTrue(result.valid);
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(anchor)));
    }

    function test_emptyProofAlwaysDenotesGenesis() public {
        ProofWalkResult memory result = _walk(new MilestoneProof[](0), new StateSnapshot[](0));
        assertTrue(result.valid);
        assertEq(result.replayBlockIndex, 0, "no tail");
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(genesis)));

        // with a normal anchor on chain the empty proof still claims the genesis, never the anchor
        _seedAnchor(ANCHOR_HEIGHT);
        result = _walk(new MilestoneProof[](0), new StateSnapshot[](0));
        assertTrue(result.valid);
        assertEq(keccak256(abi.encode(result.finalizedSnapshot.snapshotData)), keccak256(abi.encode(genesisData)));
        assertEq(result.finalizedSnapshot.blockHeight, 0);
        assertEq(result.finalizedSnapshot.forkId, forkId);
    }

    function test_keptBlockDefectsAreInvalid() public {
        StateSnapshot memory anchor = _seedAnchor(ANCHOR_HEIGHT);
        MilestoneProof memory run = _run(ANCHOR_HEIGHT, 2, bytes32(0), _signers(ALICE_KEY));
        _breakLinkAt(run, 1);
        _assertInvalidAndUnlinked(run, anchor);

        run = _run(ANCHOR_HEIGHT, 2, bytes32(0), _signers(ALICE_KEY));
        Block memory skipped = _decode(run, 1);
        skipped.transaction.header.transactionCnt = ANCHOR_HEIGHT + 2;
        _replaceBlock(run, 1, skipped, _signers(ALICE_KEY));
        _assertInvalidAndUnlinked(run, anchor);

        run = _run(ANCHOR_HEIGHT, 2, bytes32(0), _signers(ALICE_KEY));
        _badAuthorAt(run, 1);
        _assertInvalidAndUnlinked(run, anchor);
    }

    function test_unusedSkippedPrefixIsNotCertified() public {
        StateSnapshot memory anchor = _seedAnchor(ANCHOR_HEIGHT);
        // [1, undecodable, 3] wholly below the start: only its bounds are read
        MilestoneProof memory dropped = _run(1, 3, bytes32(0), _signers(ALICE_KEY));
        dropped.blockConfirmations[1].signedBlock = SignedBlock({encodedBlock: hex"1234", signature: ""});
        // the anchor run's prefix [3, 4] is broken too and never checked
        MilestoneProof memory anchorRun = _run(ANCHOR_HEIGHT - 2, 4, bytes32(0), _signers(ALICE_KEY));
        _breakLinkAt(anchorRun, 1);
        ProofWalkResult memory result = _walk(_two(dropped, anchorRun), _entries(anchor, anchor));
        assertTrue(result.valid);
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(anchor)));
        assertEq(result.replayBlockIndex, 3);
        assertTrue(_isLinked(_two(dropped, anchorRun)));
    }

    // ---- genesis authentication ----

    function test_unadoptedReducedForkAcceptsAuthenticatedGenesis() public {
        // the chain stays on the origin fork; its window expired and reduced to a fork nobody adopted yet
        _seedAnchor(ANCHOR_HEIGHT);
        SnapshotData memory reducedData = genesisData;
        reducedData.originForkId = forkId;
        bytes32 reducedForkId = keccak256(abi.encode(reducedData));
        StateSnapshot memory reducedGenesis = StateSnapshot({
            snapshotData: reducedData,
            forkId: reducedForkId,
            blockHeight: 0,
            timestamp: harness.seedExpiredOriginWindow(CHANNEL, forkId)
        });
        MilestoneProof memory run = _genesisRun(2, genesisData.participants, _signers(ALICE_KEY));
        Block memory zero = _decode(run, 0);
        zero.transaction.header.forkId = reducedForkId;
        zero.previousBlockHash = keccak256(abi.encode(reducedGenesis));
        _replaceBlock(run, 0, zero, _signers(ALICE_KEY));
        Block memory one = _decode(run, 1);
        one.transaction.header.forkId = reducedForkId;
        _replaceBlock(run, 1, one, _signers(ALICE_KEY));

        ProofWalkInput memory input =
            ProofWalkInput(CHANNEL, reducedForkId, StateProof(_one(run)), reducedData, _entries(reducedGenesis));
        assertTrue(_diamond().isStateProofLinked(CHANNEL, reducedForkId, input.stateProof, reducedData));
        ProofWalkResult memory result = _diamond().verifyMilestones(input);
        assertTrue(result.valid);
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(reducedGenesis)));
        assertEq(result.replayBlockIndex, 0);
    }

    function test_wrongGenesisDataIsInvalid() public {
        // the anchor is on chain, so the empty proof's genesis comes from the input
        _seedAnchor(ANCHOR_HEIGHT);
        MilestoneProof[] memory milestones = new MilestoneProof[](0);
        SnapshotData memory wrongData = genesisData;
        wrongData.stateMachineStateHash = keccak256("another genesis");
        assertTrue(_isLinked(milestones), "control");
        assertFalse(_diamond().isStateProofLinked(CHANNEL, forkId, StateProof(milestones), wrongData));
        ProofWalkInput memory input =
            ProofWalkInput(CHANNEL, forkId, StateProof(milestones), wrongData, new StateSnapshot[](0));
        assertFalse(_diamond().verifyMilestones(input).valid);
    }

    function test_genesisOnChainNeedsNoGenesisInput() public {
        // the on-chain snapshot is the fork genesis: the walk reads it from storage, not from the input
        MilestoneProof[] memory milestones = _one(_genesisRun(2, genesisData.participants, _signers(ALICE_KEY)));
        SnapshotData memory noGenesisData;
        assertTrue(_diamond().isStateProofLinked(CHANNEL, forkId, StateProof(milestones), noGenesisData));
        ProofWalkInput memory input = ProofWalkInput(
            CHANNEL, forkId, StateProof(milestones), noGenesisData, _entries(_snapshot(0, genesisData.participants))
        );
        ProofWalkResult memory result = _diamond().verifyMilestones(input);
        assertTrue(result.valid);
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(genesis)));
        assertEq(result.replayBlockIndex, 0);
        input.stateProof.milestones = new MilestoneProof[](0);
        input.milestoneSnapshots = new StateSnapshot[](0);
        result = _diamond().verifyMilestones(input);
        assertTrue(result.valid, "the empty proof");
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(genesis)));
    }

    function test_correctGenesisWithWrongZeroLinkIsInvalid() public {
        MilestoneProof[] memory milestones =
            _one(_run(0, 2, keccak256("not the genesis"), _signers(ALICE_KEY, BOB_KEY)));
        assertFalse(_isLinked(milestones));
        assertFalse(_walk(milestones, _entries(_snapshot(0, genesisData.participants))).valid);
    }

    // ---- verifyStateProof: the dispute path over the same walk ----

    function test_verifyStateProof_genesisBuiltMilestoneProofEndingBelowANewerAnchor_passes() public {
        _seedAnchor(ANCHOR_HEIGHT);
        // built from the fork genesis before the anchor landed: every milestone ends below it
        assertTrue(_verifyStateProof(1, 3), "stale, not invalid");
    }

    function test_verifyStateProof_milestoneProofSpanningTheAnchor_passes() public {
        _seedAnchor(ANCHOR_HEIGHT);
        assertTrue(_verifyStateProof(2, ANCHOR_HEIGHT + 1));
    }

    function test_verifyStateProof_proofFromTheAnchorNeedsNoGenesisData_passes() public {
        _seedAnchor(ANCHOR_HEIGHT);
        genesisData.stateMachineStateHash = keccak256("not this fork's genesis");
        assertTrue(_verifyStateProof(ANCHOR_HEIGHT + 1, ANCHOR_HEIGHT + 2));
    }

    function test_verifyStateProof_postedFinalizedStateIsTheWalksFinalizedState() public {
        (Dispute memory dispute, DisputeAuditingData memory auditingData) =
            _postedDispute(2, 4, _signers(ALICE_KEY, BOB_KEY));
        assertTrue(_diamond().verifyStateProof(dispute, auditingData), "the state of the threshold snapshot at 4");

        // a real state of the same fork that the walk does not end at
        auditingData.latestFinalizedStateStateMachineState = _state(2, genesisData.participants);
        dispute.input.disputeAuditingDataHash = keccak256(abi.encode(auditingData));
        assertFalse(_diamond().verifyStateProof(dispute, auditingData), "the earlier milestone's state");

        auditingData.latestFinalizedStateStateMachineState = "";
        dispute.input.disputeAuditingDataHash = keccak256(abi.encode(auditingData));
        assertFalse(_diamond().verifyStateProof(dispute, auditingData), "no state");
    }

    function test_verifyStateProof_postedFinalizedStateFollowsTheChainsStart() public {
        _seedAnchor(ANCHOR_HEIGHT);
        // the run [3, 6] holds the anchor 5: the walk ends at the anchor, not at the run's first block
        MilestoneProof memory run = _thresholdRun(3, 4, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        (Dispute memory dispute, DisputeAuditingData memory auditingData) =
            _dispute(_one(run), _entries(_snapshot(3, genesisData.participants)), true);
        auditingData.latestStateSnapshot = _snapshot(6, genesisData.participants);
        dispute.input.disputeAuditingDataHash = keccak256(abi.encode(auditingData));
        assertEq(
            keccak256(auditingData.latestFinalizedStateStateMachineState),
            keccak256(_state(ANCHOR_HEIGHT, genesisData.participants)),
            "premise: the honest posting is the anchor's state"
        );
        assertTrue(_diamond().verifyStateProof(dispute, auditingData), "the anchor's state");

        // what a walk from the fork genesis ends at: the run's first block
        auditingData.latestFinalizedStateStateMachineState = _state(3, genesisData.participants);
        dispute.input.disputeAuditingDataHash = keccak256(abi.encode(auditingData));
        assertFalse(_diamond().verifyStateProof(dispute, auditingData), "the run's first block's state");
    }

    // ---- structure scan and challenge eligibility ----

    function test_firstInvalidStructureIsReportedInTheLastMilestoneOnly() public {
        uint256[] memory both = _signers(ALICE_KEY, BOB_KEY);
        // the earlier milestone's block 1 does not link to its predecessor
        MilestoneProof memory earlier = _thresholdRun(1, 3, genesisData.participants, both);
        _breakLinkAt(earlier, 1);
        MilestoneProof memory last = _thresholdRun(5, 3, genesisData.participants, both);
        (bool found,) = _diamond().findFirstInvalidBlockStructureInStateProof(StateProof(_two(earlier, last)));
        assertFalse(found, "an earlier milestone's defect is not reported");

        // the last milestone's block 2 does not link: its index in the last milestone is reported
        _breakLinkAt(last, 2);
        uint256 blockIndex;
        (found, blockIndex) = _diamond().findFirstInvalidBlockStructureInStateProof(StateProof(_two(earlier, last)));
        assertTrue(found);
        assertEq(blockIndex, 2);
    }

    function test_blockChallengeEligibilityUndecodableBlockAnswersFalse() public view {
        assertTrue(_isTailBlockEligibleWithUndecodable(type(uint256).max), "control: every block decodes");
        assertFalse(_isTailBlockEligibleWithUndecodable(2), "undecodable challenged block");
        assertFalse(_isTailBlockEligibleWithUndecodable(0), "undecodable first block");
    }

    /// whether tail block 2 of a threshold run [3, 5] is eligible after block `undecodable` is made undecodable
    function _isTailBlockEligibleWithUndecodable(uint256 undecodable) private view returns (bool) {
        MilestoneProof memory run = _thresholdRun(3, 3, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        (Dispute memory dispute,) = _dispute(_one(run), new StateSnapshot[](0), false);
        if (undecodable < 3) run.blockConfirmations[undecodable].signedBlock.encodedBlock = hex"00";
        return _isEligible(dispute, 2);
    }

    function test_verifyStateProof_milestoneAboveTheAnchorMissingASignature_fails() public {
        _seedAnchor(ANCHOR_HEIGHT);
        // the milestone below the anchor is dropped; the one above it lacks B's signature
        (Dispute memory dispute, DisputeAuditingData memory auditingData) =
            _postedDispute(2, ANCHOR_HEIGHT + 1, _signers(ALICE_KEY));
        assertFalse(_diamond().verifyStateProof(dispute, auditingData));
    }

    function test_verifyStateProof_latestStateIsTheLastBlocksCommitment() public {
        (Dispute memory dispute, DisputeAuditingData memory auditingData) =
            _postedDispute(2, 4, _signers(ALICE_KEY, BOB_KEY));
        assertTrue(_diamond().verifyStateProof(dispute, auditingData), "the last block's commitment");

        // the posted latest state is another snapshot than the one the dispute claims
        auditingData.latestStateSnapshot = _snapshot(3, genesisData.participants);
        dispute.input.disputeAuditingDataHash = keccak256(abi.encode(auditingData));
        assertFalse(_diamond().verifyStateProof(dispute, auditingData), "another posted latest state");

        // the dispute claims another state than its last block commits
        (dispute, auditingData) = _postedDispute(2, 4, _signers(ALICE_KEY, BOB_KEY));
        dispute.input.latestStateSnapshotHash = _hashAt(3);
        assertFalse(_diamond().isCorrectLatestState(dispute, genesisData), "a claim the last block does not commit");

        // a last block that does not decode supplies no commitment
        (dispute,) = _postedDispute(2, 4, _signers(ALICE_KEY, BOB_KEY));
        dispute.input.stateProof.milestones[1].blockConfirmations[0].signedBlock.encodedBlock = hex"00";
        assertFalse(_diamond().isCorrectLatestState(dispute, genesisData), "malformed last block");
    }

    function test_isCorrectLatestState_emptyProofClaimsTheGenesis() public {
        (Dispute memory dispute,) = _dispute(new MilestoneProof[](0), new StateSnapshot[](0), false);
        assertTrue(_diamond().isCorrectLatestState(dispute, genesisData), "the genesis");
        dispute.input.latestStateSnapshotHash = _hashAt(0);
        assertFalse(_diamond().isCorrectLatestState(dispute, genesisData), "block 0's state is no genesis claim");
    }

    function test_onChainSlashDoesNotChangeHistoricProofValidity() public {
        StateSnapshot[] memory snapshots = _entries(_snapshot(3, genesisData.participants));
        MilestoneProof[] memory proven =
            _one(_thresholdRun(3, 1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY)));
        MilestoneProof[] memory authorOnly = _one(_thresholdRun(3, 1, genesisData.participants, _signers(ALICE_KEY)));
        assertTrue(_walk(proven, snapshots).valid, "before the slash");
        assertFalse(_walk(authorOnly, snapshots).valid, "before the slash, B is required");

        // B is slashed later: it still counts and is still required
        harness.seedOnChainSlash(CHANNEL, bob);
        assertTrue(harness.isSlashed(CHANNEL, bob));
        assertTrue(_walk(proven, snapshots).valid, "after the slash");
        assertFalse(_walk(authorOnly, snapshots).valid, "after the slash, B is still required");
    }

    // ---- staging ----

    /// `verifyStateProof` of a posted-data dispute over one-block threshold runs at `first` and `second`
    function _verifyStateProof(uint256 first, uint256 second) private returns (bool) {
        (Dispute memory dispute, DisputeAuditingData memory auditingData) =
            _postedDispute(first, second, _signers(ALICE_KEY, BOB_KEY));
        return _diamond().verifyStateProof(dispute, auditingData);
    }

    /// a posted-data dispute over one-block threshold runs at `first` (A and B signed) and `second` (`secondSigners`)
    function _postedDispute(uint256 first, uint256 second, uint256[] memory secondSigners)
        private
        view
        returns (Dispute memory dispute, DisputeAuditingData memory auditingData)
    {
        StateSnapshot[] memory snapshots =
            _entries(_snapshot(first, genesisData.participants), _snapshot(second, genesisData.participants));
        MilestoneProof[] memory milestones = _two(
            _thresholdRun(first, 1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY)),
            _thresholdRun(second, 1, genesisData.participants, secondSigners)
        );
        (dispute, auditingData) = _dispute(milestones, snapshots, true);
        auditingData.latestStateSnapshot = snapshots[1];
        dispute.input.disputeAuditingDataHash = keccak256(abi.encode(auditingData));
    }

    function _isLinked(MilestoneProof[] memory milestones) private view returns (bool) {
        return _diamond().isStateProofLinked(CHANNEL, forkId, StateProof(milestones), genesisData);
    }

    function _assertInvalidAndUnlinked(MilestoneProof memory run, StateSnapshot memory anchor) private view {
        assertFalse(_walk(_one(run), _entries(anchor)).valid);
        assertFalse(_isLinked(_one(run)));
    }

    // ---- bad input: one row per case, each invalid ----

    uint256 private constant BAD_INPUT_CASES = 14;

    function test_badInputIsInvalid() public {
        for (uint256 c = 0; c < BAD_INPUT_CASES; c++) {
            harness.seedSnapshot(CHANNEL, genesis);
            (MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots, int256 undecodable) = _badInput(c);
            assertFalse(_walk(milestones, snapshots).valid, string.concat("case ", vm.toString(c)));
            if (undecodable < 0) continue;
            // an undecodable block fails the linkage walk and the structure check at its position
            assertFalse(_diamond().isStateProofLinked(CHANNEL, forkId, StateProof(milestones), genesisData));
            (bool found, uint256 blockIndex) =
                _diamond().findFirstInvalidBlockStructureInStateProof(StateProof(milestones));
            assertTrue(found, string.concat("structure flag, case ", vm.toString(c)));
            assertEq(blockIndex, uint256(undecodable));
        }
    }

    /// bad-input case `c`: its proof, its snapshot entries and the undecodable block index (-1 for none)
    function _badInput(uint256 c)
        internal
        returns (MilestoneProof[] memory m, StateSnapshot[] memory s, int256 undecodable)
    {
        undecodable = -1;
        uint256[] memory both = _signers(ALICE_KEY, BOB_KEY);
        if (c <= 2) {
            // anchored at 5 inside the run [3, 6]
            StateSnapshot memory anchor = _seedAnchor(ANCHOR_HEIGHT);
            (m, s) = (_one(_run(3, 4, bytes32(0), _signers(ALICE_KEY))), _entries(anchor));
            Block memory b = _decode(m[0], 2);
            if (c == 0) {
                // start offset past the run length: a two-block run claims height 6
                m[0] = _run(3, 2, bytes32(0), _signers(ALICE_KEY));
                b = _decode(m[0], 1);
                b.transaction.header.transactionCnt = 6;
                _replaceBlock(m[0], 1, b, _signers(ALICE_KEY));
            } else if (c == 1) {
                // wrong height at the start offset
                b.transaction.header.transactionCnt = 7;
                _replaceBlock(m[0], 2, b, _signers(ALICE_KEY));
            } else {
                // the anchor-height block commits another snapshot
                _commitAt(m[0], 2, keccak256("other"), _signers(ALICE_KEY));
            }
            return (m, s, undecodable);
        }
        // a final genesis zero run [0, 2]
        (m, s) =
            (_one(_genesisRun(3, genesisData.participants, both)), _entries(_snapshot(0, genesisData.participants)));
        if (c == 3) {
            m[0].blockConfirmations = new BlockConfirmation[](0);
        } else if (c <= 6) {
            // undecodable first, interior, last block
            undecodable = int256(c - 4);
            m[0].blockConfirmations[c - 4].signedBlock.encodedBlock = hex"00";
        } else if (c == 7) {
            s = new StateSnapshot[](0);
        } else if (c == 8) {
            s = _entries(s[0], s[0]);
        } else if (c == 9) {
            // a confirmation signature of the wrong length
            m[0].blockConfirmations[1].signatures = new bytes[](1);
            m[0].blockConfirmations[1].signatures[0] = new bytes(64);
        } else if (c == 10) {
            // a later hop whose entry is not its first block's commitment
            m = _two(m[0], _thresholdRun(3, 1, genesisData.participants, both));
            s = _entries(s[0], _snapshot(4, genesisData.participants));
        } else if (c == 11) {
            // no wrap at the maximum height
            m = _one(_thresholdRun(3, 2, genesisData.participants, both));
            s = _entries(_snapshot(3, genesisData.participants));
            Block memory top = _decode(m[0], 0);
            top.transaction.header.transactionCnt = type(uint256).max;
            _replaceBlock(m[0], 0, top, both);
            Block memory wrapped = _decode(m[0], 1);
            wrapped.transaction.header.transactionCnt = 0;
            _replaceBlock(m[0], 1, wrapped, _signers(ALICE_KEY));
        } else if (c == 12) {
            // an interior block on another fork
            Block memory other = _decode(m[0], 1);
            other.transaction.header.forkId = keccak256("other-fork");
            _replaceBlock(m[0], 1, other, _signers(ALICE_KEY));
        } else {
            // a confirmation signature that recovers no signer
            m[0].blockConfirmations[2].signatures = new bytes[](1);
            m[0].blockConfirmations[2].signatures[0] = new bytes(65);
        }
    }
}
