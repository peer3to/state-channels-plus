pragma solidity ^0.8.8;

import {StateProofStaging} from "../harness/StateProofStaging.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/DisputeTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// The conflict counter (plan "Dispute that conflicts with a final state"): a dispute whose proof holds a block at the
/// height of a threshold-final state F of the same fork that commits another snapshot is killed and its submitter
/// slashed. The chain anchor is 5 {A, B}; the challenger's final proof hops to F = 7 signed by A and B. A's dispute
/// carries the run 5..8 from the anchor. Controls that do not kill: the same snapshot at F's height, a block above F,
/// a final proof on another fork, an invalid final proof, the fork genesis as the final point, and a block the
/// dispute's walk does not check.
// test naming: test_<plan case>_<scenario>
contract DisputeConflictsWithFinalStateTest is StateProofStaging {
    function setUp() public {
        _stageGenesisChannel();
    }

    /// the challenger's final proof to F = 7, its hop signed by `signers`, naming `proofForkId`
    function _finalAtSeven(bytes32 proofForkId, uint256[] memory signers)
        internal
        view
        returns (ProofWalkInput memory)
    {
        StateSnapshot[] memory snapshots = _entries(_snapshot(7, genesisData.participants));
        return _finalProof(proofForkId, _one(_hopRun(snapshots[0], 1, signers)), snapshots);
    }

    /// A's dispute: the run 5..8 from the anchor 5; with `forked` its block 7 commits another snapshot (and 8 follows)
    function _anchorRunDispute(bool forked) internal returns (Dispute memory dispute) {
        _seedAnchor(5);
        MilestoneProof memory run = _run(5, 4, keccak256("block 4"), _signers(ALICE_KEY));
        if (forked) _commitAt(run, 2, keccak256("a forked state at 7"), _signers(ALICE_KEY));
        dispute = _dispute(_one(run));
        _commit(dispute);
    }

    function test_conflictWithFinalState_blockAtTheFinalHeightCommittingAnotherSnapshotKillsTheDispute() public {
        Dispute memory dispute = _anchorRunDispute(true);
        ProofWalkInput memory finalProof = _finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY));
        assertEq(_diamond().verifyMilestones(finalProof).finalizedSnapshot.blockHeight, 7, "F is block 7");

        _apply(dispute, DisputeFraudProofType.DisputeConflictsWithFinalState, _conflictProof(finalProof, 0, 2));

        _assertKilled(dispute);
    }

    function test_conflictWithFinalState_sameSnapshotAtTheFinalHeightDoesNotKill() public {
        Dispute memory dispute = _anchorRunDispute(false);

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(_finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 0, 2)
        );

        _assertRejected(dispute);
    }

    function test_conflictWithFinalState_blockAboveTheFinalHeightDoesNotKill() public {
        Dispute memory dispute = _anchorRunDispute(true);

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(_finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 0, 3)
        );

        _assertRejected(dispute);
    }

    function test_conflictWithFinalState_finalProofOnAnotherForkDoesNotKill() public {
        Dispute memory dispute = _anchorRunDispute(true);

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(_finalAtSeven(keccak256("another fork"), _signers(ALICE_KEY, BOB_KEY)), 0, 2)
        );

        _assertRejected(dispute);
    }

    function test_conflictWithFinalState_invalidFinalProofDoesNotKill() public {
        Dispute memory dispute = _anchorRunDispute(true);
        // the hop to 7 needs A and B; only A signed
        ProofWalkInput memory finalProof = _finalAtSeven(forkId, _signers(ALICE_KEY));
        assertFalse(_diamond().verifyMilestones(finalProof).valid, "the final proof does not walk");

        _apply(dispute, DisputeFraudProofType.DisputeConflictsWithFinalState, _conflictProof(finalProof, 0, 2));

        _assertRejected(dispute);
    }

    function test_conflictWithFinalState_forkGenesisAsTheFinalPointDoesNotKill() public {
        // no anchor: the dispute's block 0 commits a snapshot, never the genesis itself
        Dispute memory dispute = _dispute(_one(_genesisRun(2, genesisData.participants, _signers(ALICE_KEY, BOB_KEY))));
        _commit(dispute);
        ProofWalkInput memory finalProof = _finalProof(forkId, new MilestoneProof[](0), new StateSnapshot[](0));
        assertTrue(_diamond().verifyMilestones(finalProof).valid, "the empty proof walks to the genesis");

        _apply(dispute, DisputeFraudProofType.DisputeConflictsWithFinalState, _conflictProof(finalProof, 0, 0));

        _assertRejected(dispute);
    }

    function test_conflictWithFinalState_blockOfHistoryBelowTheAnchorDoesNotKill() public {
        _seedAnchor(5);
        // a milestone wholly below the anchor (judged by its last block, 4) whose first block claims height 7
        MilestoneProof memory below = _run(3, 2, keccak256("block 2"), _signers(ALICE_KEY));
        Block memory b = _decode(below, 0);
        b.transaction.header.transactionCnt = 7;
        b.stateSnapshotHash = keccak256("a forked state at 7");
        below.blockConfirmations[0] = _blockConfirmation(abi.encode(b), _signers(ALICE_KEY));
        MilestoneProof memory run = _run(5, 2, keccak256("block 4"), _signers(ALICE_KEY));
        Dispute memory dispute = _dispute(_two(below, run));
        _commit(dispute);

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(_finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 0, 0)
        );

        _assertRejected(dispute);
    }

    // ==================== boundaries ====================

    function test_conflictWithFinalState_realFinalStateOnAnotherForkDoesNotKill() public {
        ProofWalkInput memory finalProof = _otherForkFinalAtSeven(keccak256("another fork"));
        // this fork's dispute walks from its genesis; its block 7 commits this fork's snapshot
        Dispute memory dispute = _dispute(_one(_genesisRun(8, genesisData.participants, _signers(ALICE_KEY, BOB_KEY))));
        _commit(dispute);

        _apply(dispute, DisputeFraudProofType.DisputeConflictsWithFinalState, _conflictProof(finalProof, 0, 7));

        _assertRejected(dispute);
    }

    function test_conflictWithFinalState_conflictingBlockNamingAnotherForkDoesNotKill() public {
        _seedAnchor(5);
        MilestoneProof memory run = _run(5, 4, keccak256("block 4"), _signers(ALICE_KEY));
        // block 7 names another fork and commits another snapshot
        _otherForkAt(run, 2);
        _commitAt(run, 2, keccak256("a forked state at 7"), _signers(ALICE_KEY));
        Dispute memory dispute = _dispute(_one(run));
        _commit(dispute);

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(_finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 0, 2)
        );

        _assertRejected(dispute);
    }

    function test_conflictWithFinalState_blockBeforeTheAnchorBlockInTheRunIsNoConflict() public {
        _seedAnchor(5);
        // the run 3..8 holds the anchor at position 2; position 1, history the walk does not check, claims height 7
        MilestoneProof memory run = _run(3, 6, keccak256("block 2"), _signers(ALICE_KEY));
        Block memory b = _decode(run, 1);
        b.transaction.header.transactionCnt = 7;
        b.stateSnapshotHash = keccak256("a forked state at 7");
        _replaceBlock(run, 1, b, _signers(ALICE_KEY));
        Dispute memory dispute = _dispute(_one(run));
        _commit(dispute);

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(_finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 0, 1)
        );

        _assertRejected(dispute);
    }

    function test_conflictWithFinalState_anchorRunAsTheFinalProofProvesTheAnchor() public {
        StateSnapshot memory anchor = _seedAnchor(5);
        // the final proof is the anchor run alone: F is the anchor
        ProofWalkInput memory finalProof =
            _finalProof(forkId, _one(_run(5, 2, keccak256("block 4"), _signers(ALICE_KEY))), _entries(anchor));
        assertEq(_diamond().verifyMilestones(finalProof).finalizedSnapshot.blockHeight, 5, "premise: F = anchor");
        // the dispute's block 5 commits another snapshot than the anchor
        MilestoneProof memory run = _run(5, 3, keccak256("block 4"), _signers(ALICE_KEY));
        _commitAt(run, 0, keccak256("a forked state at 5"), _signers(ALICE_KEY));
        Dispute memory dispute = _dispute(_one(run));
        _commit(dispute);

        _apply(dispute, DisputeFraudProofType.DisputeConflictsWithFinalState, _conflictProof(finalProof, 0, 0));

        _assertKilled(dispute);
    }

    function test_conflictWithFinalState_conflictingFirstBlockOfASecondHopMilestoneKills() public {
        _seedAnchor(5);
        // the anchor run [5, 6], then a hop to 7 committing another snapshot than F
        MilestoneProof memory hop = _hopRun(_snapshot(7, _set(alice)), 1, _signers(ALICE_KEY, BOB_KEY));
        Dispute memory dispute = _dispute(_two(_run(5, 2, keccak256("block 4"), _signers(ALICE_KEY)), hop));
        _commit(dispute);

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(_finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 1, 0)
        );

        _assertKilled(dispute);
    }

    function test_conflictWithFinalState_staleFinalProofBelowAnAdvancedAnchorProvesTheAnchor() public {
        ProofWalkInput memory finalProof = _finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY));
        // the chain anchor moves past F = 7: the proof's milestone is skipped, its final point is the anchor 8
        _seedAnchor(8);
        assertEq(_diamond().verifyMilestones(finalProof).finalizedSnapshot.blockHeight, 8, "F is the chain anchor");
        MilestoneProof memory run = _run(8, 2, keccak256("block 7"), _signers(ALICE_KEY));
        _commitAt(run, 0, keccak256("a forked state at 8"), _signers(ALICE_KEY));
        Dispute memory dispute = _dispute(_one(run));
        _commit(dispute);

        _apply(dispute, DisputeFraudProofType.DisputeConflictsWithFinalState, _conflictProof(finalProof, 0, 0));

        _assertKilled(dispute);
    }
}
