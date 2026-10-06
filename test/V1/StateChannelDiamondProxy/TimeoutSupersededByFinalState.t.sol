pragma solidity ^0.8.8;

import {StateProofStaging} from "../harness/StateProofStaging.sol";
import {TimeoutSupersededByFinalState} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/DisputeTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// The timeout-superseded counter (plan: false timeout naming the wrong next author after compact sync): any threshold-final state on the dispute's fork at or above
/// the timeout height kills the timeout dispute and slashes its submitter. A's dispute ends at block 0 and times out
/// B at height 1. Controls that do not kill: a final point below the height, a proof naming another fork, a hop
/// without its required signature, a dispute without a timeout, and the fork genesis as the final point.
// test naming: test_<plan case>_<scenario>
contract TimeoutSupersededByFinalStateTest is StateProofStaging {
    function setUp() public {
        _stageGenesisChannel();
    }

    /// A's dispute ending at block 0 that times out `timedOut` at height 1
    function _timeoutDispute(address timedOut) internal view returns (Dispute memory dispute) {
        dispute = _dispute(_one(_genesisRun(1, genesisData.participants, _signers(ALICE_KEY, BOB_KEY))));
        dispute.input.timeout.participant = timedOut;
        dispute.input.timeout.blockHeight = 1;
    }

    /// a proof whose final point is block 5: block 0 and block 5 each proven by A and B
    function _finalAtFive()
        internal
        view
        returns (MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots)
    {
        uint256[] memory both = _signers(ALICE_KEY, BOB_KEY);
        milestones =
            _two(_genesisRun(2, genesisData.participants, both), _thresholdRun(5, 3, genesisData.participants, both));
        snapshots = _entries(_snapshot(0, genesisData.participants), _snapshot(5, genesisData.participants));
    }

    function test_timeoutSuperseded_finalStateAboveTheTimeoutHeightKillsTheTimeout() public {
        Dispute memory dispute = _timeoutDispute(bob);
        _commit(dispute);
        (MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots) = _finalAtFive();
        assertEq(_walk(milestones, snapshots).finalizedSnapshot.blockHeight, 5, "the final point is block 5");

        _apply(
            dispute,
            DisputeFraudProofType.TimeoutSupersededByFinalState,
            _supersededProof(forkId, milestones, snapshots)
        );

        _assertKilled(dispute);
    }

    function test_timeoutSuperseded_finalStateAtTheTimeoutHeightKillsTheTimeout() public {
        Dispute memory dispute = _timeoutDispute(bob);
        _commit(dispute);
        uint256[] memory both = _signers(ALICE_KEY, BOB_KEY);
        MilestoneProof[] memory milestones =
            _two(_genesisRun(1, genesisData.participants, both), _thresholdRun(1, 2, genesisData.participants, both));
        StateSnapshot[] memory snapshots =
            _entries(_snapshot(0, genesisData.participants), _snapshot(1, genesisData.participants));
        assertEq(_walk(milestones, snapshots).finalizedSnapshot.blockHeight, 1, "the final point is the timeout height");

        _apply(
            dispute,
            DisputeFraudProofType.TimeoutSupersededByFinalState,
            _supersededProof(forkId, milestones, snapshots)
        );

        _assertKilled(dispute);
    }

    function test_timeoutSuperseded_sameForkChainAnchorAboveTheTimeoutHeightKillsWithAnEmptyProof() public {
        _seedAnchor(5);
        Dispute memory dispute = _timeoutDispute(bob);
        _commit(dispute);

        _apply(
            dispute,
            DisputeFraudProofType.TimeoutSupersededByFinalState,
            _supersededProof(forkId, new MilestoneProof[](0), new StateSnapshot[](0))
        );

        _assertKilled(dispute);
    }

    function test_timeoutSuperseded_finalStateBelowTheTimeoutHeightDoesNotKill() public {
        Dispute memory dispute = _timeoutDispute(bob);
        _commit(dispute);
        MilestoneProof[] memory milestones =
            _one(_genesisRun(3, genesisData.participants, _signers(ALICE_KEY, BOB_KEY)));
        StateSnapshot[] memory snapshots = _entries(_snapshot(0, genesisData.participants));
        assertEq(_walk(milestones, snapshots).finalizedSnapshot.blockHeight, 0, "the final point is block 0");

        _apply(
            dispute,
            DisputeFraudProofType.TimeoutSupersededByFinalState,
            _supersededProof(forkId, milestones, snapshots)
        );

        _assertRejected(dispute);
    }

    function test_timeoutSuperseded_proofNamingAnotherForkDoesNotKill() public {
        Dispute memory dispute = _timeoutDispute(bob);
        _commit(dispute);
        (MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots) = _finalAtFive();

        _apply(
            dispute,
            DisputeFraudProofType.TimeoutSupersededByFinalState,
            _supersededProof(keccak256("another fork"), milestones, snapshots)
        );

        _assertRejected(dispute);
    }

    function test_timeoutSuperseded_hopMissingARequiredSignatureDoesNotKill() public {
        Dispute memory dispute = _timeoutDispute(bob);
        _commit(dispute);
        MilestoneProof[] memory milestones = _two(
            _genesisRun(2, genesisData.participants, _signers(ALICE_KEY, BOB_KEY)),
            _thresholdRun(5, 3, genesisData.participants, _signers(ALICE_KEY))
        );
        StateSnapshot[] memory snapshots =
            _entries(_snapshot(0, genesisData.participants), _snapshot(5, genesisData.participants));
        assertFalse(_walk(milestones, snapshots).valid, "the hop to block 5 lacks B's signature");

        _apply(
            dispute,
            DisputeFraudProofType.TimeoutSupersededByFinalState,
            _supersededProof(forkId, milestones, snapshots)
        );

        _assertRejected(dispute);
    }

    function test_timeoutSuperseded_disputeWithoutATimeoutIsNotKilled() public {
        Dispute memory dispute = _timeoutDispute(address(0));
        _commit(dispute);
        (MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots) = _finalAtFive();

        _apply(
            dispute,
            DisputeFraudProofType.TimeoutSupersededByFinalState,
            _supersededProof(forkId, milestones, snapshots)
        );

        _assertRejected(dispute);
    }

    function test_timeoutSuperseded_forkGenesisIsNoFinalStateAtTheTimeoutHeight() public {
        Dispute memory dispute = _dispute(new MilestoneProof[](0));
        dispute.input.timeout.participant = bob;
        dispute.input.timeout.blockHeight = 0;
        _commit(dispute);
        assertEq(
            _walk(new MilestoneProof[](0), new StateSnapshot[](0)).finalizedSnapshot.blockHeight,
            0,
            "the empty proof walks to the genesis at height 0"
        );

        _apply(
            dispute,
            DisputeFraudProofType.TimeoutSupersededByFinalState,
            _supersededProof(forkId, new MilestoneProof[](0), new StateSnapshot[](0))
        );

        _assertRejected(dispute);
    }

    function test_timeoutSuperseded_anchorOnAnotherForkAboveTheTimeoutHeightDoesNotKill() public {
        StateSnapshot memory other = _snapshot(10, genesisData.participants);
        other.forkId = keccak256("another fork");
        harness.seedSnapshot(CHANNEL, other);
        Dispute memory dispute = _timeoutDispute(bob);
        _commit(dispute);

        _apply(
            dispute,
            DisputeFraudProofType.TimeoutSupersededByFinalState,
            _supersededProof(forkId, new MilestoneProof[](0), new StateSnapshot[](0))
        );

        _assertRejected(dispute);
    }

    function test_timeoutSuperseded_sameForkAnchorAtTheTimeoutHeightKills() public {
        _seedAnchor(1);
        Dispute memory dispute = _timeoutDispute(bob);
        _commit(dispute);

        _apply(
            dispute,
            DisputeFraudProofType.TimeoutSupersededByFinalState,
            _supersededProof(forkId, new MilestoneProof[](0), new StateSnapshot[](0))
        );

        _assertKilled(dispute);
    }

    function test_timeoutSuperseded_realFinalStateOnAnotherForkDoesNotKill() public {
        ProofWalkInput memory finalProof = _otherForkFinalAtSeven(keccak256("another fork"));
        Dispute memory dispute = _timeoutDispute(bob);
        _commit(dispute);

        _apply(
            dispute,
            DisputeFraudProofType.TimeoutSupersededByFinalState,
            abi.encode(TimeoutSupersededByFinalState(finalProof))
        );

        _assertRejected(dispute);
    }
}
