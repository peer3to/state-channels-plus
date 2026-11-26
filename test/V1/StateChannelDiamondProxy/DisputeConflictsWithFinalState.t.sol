pragma solidity ^0.8.8;

import {StateProofStaging} from "../harness/StateProofStaging.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/DisputeTypes.sol";
import "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// The conflict counter (plan "Dispute that conflicts with a final state"): a dispute whose proof holds a block at the
/// height of a threshold-final state F of the same fork that commits another snapshot is killed. The kill slashes S:
/// the members of F's finality signer set whose own signature is on that block when it is a final point of the
/// dispute (the first block of a milestone); a tail block, or F as the anchor, slashes nobody, not even the disputer.
/// The chain anchor is 5 {A, B}; the challenger's final proof hops to F = 7 signed by A and B. A's dispute carries the
/// run 5..8 from the anchor. Controls that do not kill: the same snapshot at F's height, a block above F, a final proof
/// on another fork, an invalid final proof, the fork genesis as the final point, and a block the dispute's walk does
/// not check.
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

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(finalProof, 0, 2, _snapshot(5, genesisData.participants))
        );

        // block 7 is a tail block of the anchor run, no final point of the dispute: S is empty
        _assertConflictKilled(dispute, _none());
    }

    function test_conflictWithFinalState_sameSnapshotAtTheFinalHeightDoesNotKill() public {
        Dispute memory dispute = _anchorRunDispute(false);

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(
                _finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 0, 2, _snapshot(5, genesisData.participants)
            )
        );

        _assertRejected(dispute);
    }

    function test_conflictWithFinalState_blockAboveTheFinalHeightDoesNotKill() public {
        Dispute memory dispute = _anchorRunDispute(true);

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(
                _finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 0, 3, _snapshot(5, genesisData.participants)
            )
        );

        _assertRejected(dispute);
    }

    function test_conflictWithFinalState_finalProofOnAnotherForkDoesNotKill() public {
        Dispute memory dispute = _anchorRunDispute(true);

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(
                _finalAtSeven(keccak256("another fork"), _signers(ALICE_KEY, BOB_KEY)),
                0,
                2,
                _snapshot(5, genesisData.participants)
            )
        );

        _assertRejected(dispute);
    }

    function test_conflictWithFinalState_invalidFinalProofDoesNotKill() public {
        Dispute memory dispute = _anchorRunDispute(true);
        // the hop to 7 needs A and B; only A signed
        ProofWalkInput memory finalProof = _finalAtSeven(forkId, _signers(ALICE_KEY));
        assertFalse(_diamond().verifyMilestones(finalProof).valid, "the final proof does not walk");

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(finalProof, 0, 2, _snapshot(5, genesisData.participants))
        );

        _assertRejected(dispute);
    }

    function test_conflictWithFinalState_forkGenesisAsTheFinalPointDoesNotKill() public {
        // no anchor: the dispute's block 0 commits a snapshot, never the genesis itself
        Dispute memory dispute = _dispute(_one(_genesisRun(2, genesisData.participants, _signers(ALICE_KEY, BOB_KEY))));
        _commit(dispute);
        ProofWalkInput memory finalProof = _finalProof(forkId, new MilestoneProof[](0), new StateSnapshot[](0));
        assertTrue(_diamond().verifyMilestones(finalProof).valid, "the empty proof walks to the genesis");

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(finalProof, 0, 0, _snapshot(0, genesisData.participants))
        );

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
            _conflictProof(
                _finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 0, 0, _snapshot(5, genesisData.participants)
            )
        );

        _assertRejected(dispute);
    }

    // ==================== boundaries ====================

    function test_conflictWithFinalState_realFinalStateOnAnotherForkDoesNotKill() public {
        ProofWalkInput memory finalProof = _otherForkFinalAtSeven(keccak256("another fork"));
        // this fork's dispute walks from its genesis; its block 7 commits this fork's snapshot
        Dispute memory dispute = _dispute(_one(_genesisRun(8, genesisData.participants, _signers(ALICE_KEY, BOB_KEY))));
        _commit(dispute);

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(finalProof, 0, 7, _snapshot(0, genesisData.participants))
        );

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
            _conflictProof(
                _finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 0, 2, _snapshot(5, genesisData.participants)
            )
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
            _conflictProof(
                _finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 0, 1, _snapshot(5, genesisData.participants)
            )
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

        _apply(dispute, DisputeFraudProofType.DisputeConflictsWithFinalState, _conflictProof(finalProof, 0, 0, anchor));

        // the anchor's signers are not on chain: F as the anchor slashes nobody
        _assertConflictKilled(dispute, _none());
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
            _conflictProof(_finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 1, 0, _snapshot(7, _set(alice)))
        );

        // A and B signed both hops to 7: the challenger B is slashed with A
        _assertConflictKilled(dispute, _set(alice, bob));
    }

    function test_CN3_finalProofWhoseHopSnapshotNamesAnotherHeightDoesNotKill() public {
        // A's honest run 5..8: its block 7 commits the snapshot at 7
        Dispute memory dispute = _anchorRunDispute(false);
        // the challenger's "F = 7" is block 6 committing a snapshot that names height 7, signed by A and B
        StateSnapshot memory misHeighted = _snapshot(7, _set(alice));
        MilestoneProof memory hop = _thresholdRun(6, 1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        _commitAt(hop, 0, keccak256(abi.encode(misHeighted)), _signers(ALICE_KEY, BOB_KEY));
        ProofWalkInput memory finalProof = _finalProof(forkId, _one(hop), _entries(misHeighted));
        bytes memory proof = _conflictProof(finalProof, 0, 2, _snapshot(5, genesisData.participants));
        assertFalse(_diamond().verifyMilestones(finalProof).valid, "F's hop proves no state at another height");

        _apply(dispute, DisputeFraudProofType.DisputeConflictsWithFinalState, proof);

        _assertRejected(dispute);
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

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(finalProof, 0, 0, _snapshot(8, genesisData.participants))
        );

        _assertConflictKilled(dispute, _none());
    }

    // ==================== the slash set S ====================

    function test_case1_honestJoinersDisputeKilledByASideFinalPointSlashesOnlyTheDoubleSigners() public {
        _seedAnchor(5);
        // X: the anchor run [5, 6], the hop to 7 signed by A and B, then the tail 8 and 9, which C (the pending joiner
        // L) co-signs
        MilestoneProof memory hop = _hopRun(_snapshot(7, _set(alice)), 3, _signers(ALICE_KEY, BOB_KEY));
        _coSignByCarol(hop, 1);
        _coSignByCarol(hop, 2);
        Dispute memory dispute = _disputeBy(carol, _two(_run(5, 2, keccak256("block 4"), _signers(ALICE_KEY)), hop));
        _commit(dispute);

        // A proves the side chain's F' = 7, also signed by A and B
        _applyBy(
            alice,
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(_finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 1, 0, _snapshot(7, _set(alice)))
        );

        // C signed only X's tail and is outside F's signer set
        _assertConflictKilledBy(dispute, alice, _set(alice, bob));
        assertFalse(harness.isSlashed(CHANNEL, carol), "the joiner who signed only the tail is not slashed");
    }

    function test_case2_victimsSideChainDisputeKilledAtATailBlockSlashesNobody() public {
        // D (the victim M) synced only the side chain: its anchor run 5..8 forks at the tail block 7
        _seedAnchor(5);
        MilestoneProof memory run = _run(5, 4, keccak256("block 4"), _signers(ALICE_KEY));
        _commitAt(run, 2, keccak256("a forked state at 7"), _signers(ALICE_KEY, BOB_KEY));
        Dispute memory dispute = _disputeBy(dave, _one(run));
        _commit(dispute);

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(
                _finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 0, 2, _snapshot(5, genesisData.participants)
            )
        );

        // block 7 is no final point of the dispute: nobody is slashed, not A and B, not the victim
        _assertConflictKilled(dispute, _none());
    }

    function test_CN5_replacementAfterAKillThatSlashesNobodyIsNotKillableByInvalidDisputeReason() public {
        Dispute memory replacement = _replacementAfterAnEmptyConflictKill(true);

        _apply(replacement, DisputeFraudProofType.InvalidDisputeReason, _reasonProof());

        // the replacement lists no slash, but it needs the open window: that is its reason
        _assertRejected(replacement);
    }

    function test_CN5_replacementWithoutTheWindowReasonAfterAKillThatSlashesNobodyIsKilled() public {
        Dispute memory replacement = _replacementAfterAnEmptyConflictKill(false);

        _apply(replacement, DisputeFraudProofType.InvalidDisputeReason, _reasonProof());

        _assertKilled(replacement);
    }

    function test_slashSet_singleSignatureOverlapSlashesOnlyThatSigner() public {
        _seedAnchor(5);
        // A, after a sync to the other history, signs its hop to 7 once, with C (outside F's signer set)
        MilestoneProof memory hop = _hopRun(_snapshot(7, _set(alice)), 1, _signers(ALICE_KEY, CAROL_KEY));
        Dispute memory dispute = _disputeBy(carol, _two(_run(5, 2, keccak256("block 4"), _signers(ALICE_KEY)), hop));
        _commit(dispute);

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(_finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 1, 0, _snapshot(7, _set(alice)))
        );

        _assertConflictKilled(dispute, _set(alice));
    }

    function test_slashSet_membershipTurnoverGivesAnEmptySetAndStillKills() public {
        _seedAnchor(5);
        // the dispute's hop to 7 is signed only by C and D, none of F's signers A and B
        MilestoneProof memory hop = _hopRun(_snapshot(7, _set(carol, dave)), 1, _signers(CAROL_KEY, DAVE_KEY));
        Dispute memory dispute = _disputeBy(carol, _two(_run(5, 2, keccak256("block 4"), _signers(ALICE_KEY)), hop));
        _commit(dispute);

        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(_finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 1, 0, _snapshot(7, _set(carol, dave)))
        );

        _assertConflictKilled(dispute, _none());
    }

    function test_slashSet_firstOfTwoAcceptedCountersDecidesTheSlashSet() public {
        _seedAnchor(5);
        // the dispute's hop to 7 (signed by A and B) and its tail block 8, which commits another state than F = 8
        MilestoneProof memory hop = _hopRun(_snapshot(7, _set(alice)), 2, _signers(ALICE_KEY, BOB_KEY));
        _commitAt(hop, 1, keccak256("a forked state at 8"), _signers(ALICE_KEY));
        Dispute memory dispute = _dispute(_two(_run(5, 2, keccak256("block 4"), _signers(ALICE_KEY)), hop));
        _commit(dispute);
        // two accepted counters: F = 8 against the tail block (S empty), F = 7 against the hop (S = {A, B})
        bytes memory tailCounter =
            _conflictProof(_finalAt(8, _signers(ALICE_KEY, BOB_KEY)), 1, 1, _snapshot(7, _set(alice)));
        bytes memory hopCounter =
            _conflictProof(_finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 1, 0, _snapshot(7, _set(alice)));
        (bool tailKills, address[] memory tailSlashes) = _diamond()
            .isDisputeConflictingWithFinalState(dispute, abi.decode(tailCounter, (DisputeConflictsWithFinalState)));
        (bool hopKills, address[] memory hopSlashes) = _diamond()
            .isDisputeConflictingWithFinalState(dispute, abi.decode(hopCounter, (DisputeConflictsWithFinalState)));
        assertTrue(tailKills && hopKills, "premise: both counters are accepted");
        assertEq(tailSlashes.length, 0, "premise: the tail counter slashes nobody");
        assertEq(hopSlashes.length, 2, "premise: the hop counter slashes A and B");

        DisputeFraudProof[] memory proofs = new DisputeFraudProof[](2);
        proofs[0] = DisputeFraudProof(
            DisputeFraudProofType.DisputeConflictsWithFinalState, dispute.input.disputer, dispute, tailCounter
        );
        proofs[1] = DisputeFraudProof(
            DisputeFraudProofType.DisputeConflictsWithFinalState, dispute.input.disputer, dispute, hopCounter
        );
        vm.prank(bob);
        harness.applyDisputeFraudProofs(proofs);

        // the first kill removes the dispute; the second counter is a no-op that slashes nobody
        _assertConflictKilled(dispute, _none());
    }

    /// the challenger's final proof to F at `height`: one hop from the anchor 5, signed by `signers`
    function _finalAt(uint256 height, uint256[] memory signers) internal view returns (ProofWalkInput memory) {
        StateSnapshot[] memory snapshots = _entries(_snapshot(height, genesisData.participants));
        return _finalProof(forkId, _one(_hopRun(snapshots[0], 1, signers)), snapshots);
    }

    /// re-signs block `blockIndex` of `milestone` by its author A with C's confirmation, keeping its content
    function _coSignByCarol(MilestoneProof memory milestone, uint256 blockIndex) internal view {
        Block memory b = _decode(milestone, blockIndex);
        milestone.blockConfirmations[blockIndex] = _blockConfirmation(abi.encode(b), _signers(ALICE_KEY, CAROL_KEY));
    }

    /// case 2's kill (S empty), then C's replacement over the final history 5..7, listing no slash; it needs the
    /// existing window when `requireExistingDisputeWindow`
    function _replacementAfterAnEmptyConflictKill(bool requireExistingDisputeWindow)
        internal
        returns (Dispute memory replacement)
    {
        _seedAnchor(5);
        MilestoneProof memory run = _run(5, 4, keccak256("block 4"), _signers(ALICE_KEY));
        _commitAt(run, 2, keccak256("a forked state at 7"), _signers(ALICE_KEY, BOB_KEY));
        Dispute memory dispute = _disputeBy(dave, _one(run));
        _commit(dispute);
        _apply(
            dispute,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(
                _finalAtSeven(forkId, _signers(ALICE_KEY, BOB_KEY)), 0, 2, _snapshot(5, genesisData.participants)
            )
        );
        _assertConflictKilled(dispute, _none());

        replacement = _disputeBy(carol, _one(_run(5, 3, keccak256("block 4"), _signers(ALICE_KEY))));
        replacement.input.requireExistingDisputeWindow = requireExistingDisputeWindow;
        _commit(replacement);
    }

    /// the InvalidDisputeReason proof against a replacement whose latest block is 7
    function _reasonProof() internal view returns (bytes memory) {
        return abi.encode(InvalidDisputeReason({latestStateSnapshot: _snapshot(7, genesisData.participants)}));
    }
}
