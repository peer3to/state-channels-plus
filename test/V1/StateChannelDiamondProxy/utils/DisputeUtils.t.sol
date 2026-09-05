pragma solidity ^0.8.8;

import {Test} from "forge-std/Test.sol";
import "../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol";

contract DisputeUtilsTest is Test {
    function test_reason_falseWithoutEvidenceIsNotAReason() public pure {
        DisputeInput memory input;
        StateSnapshot memory snapshot;
        assertFalse(_hasDisputeReason(input, snapshot));
    }

    function test_reason_trueIsSufficientWithoutSelfRemoval() public pure {
        DisputeInput memory input;
        StateSnapshot memory snapshot;
        input.requireExistingDisputeWindow = true;
        assertTrue(_hasDisputeReason(input, snapshot));
        assertFalse(input.selfRemoval);
    }

    function test_reason_falsePreservesTimeout() public pure {
        DisputeInput memory input;
        StateSnapshot memory snapshot;
        input.timeout.participant = address(1);
        assertTrue(_hasDisputeReason(input, snapshot));
    }

    function test_reason_falsePreservesSelfRemoval() public pure {
        DisputeInput memory input;
        StateSnapshot memory snapshot;
        input.selfRemoval = true;
        assertTrue(_hasDisputeReason(input, snapshot));
    }

    function test_reason_falsePreservesForcedInbound() public pure {
        DisputeInput memory input;
        StateSnapshot memory snapshot;
        input.lastInboundMessageBlockHeight = 1;
        assertTrue(_hasDisputeReason(input, snapshot));
    }

    function test_reason_falseRequiresEverySlashToBeEligible() public pure {
        DisputeInput memory input;
        StateSnapshot memory snapshot;
        snapshot.snapshotData.participants = new address[](1);
        snapshot.snapshotData.participants[0] = address(1);
        input.onChainSlashes = new address[](1);
        input.onChainSlashes[0] = address(1);
        assertTrue(_hasDisputeReason(input, snapshot));
        input.onChainSlashes[0] = address(2);
        assertFalse(_hasDisputeReason(input, snapshot));
        input.requireExistingDisputeWindow = true;
        assertTrue(_hasDisputeReason(input, snapshot));
    }

    function _stateProofWithLastMilestone(uint256 confirmations) internal pure returns (StateProof memory sp) {
        sp.milestones = new MilestoneProof[](1);
        sp.milestones[0].blockConfirmations = new BlockConfirmation[](confirmations);
    }

    function test_unfinalized_emptyLastMilestone_returnsEmpty() public {
        StateProof memory sp = _stateProofWithLastMilestone(0);
        BlockConfirmation[] memory res = _getUnfinalizedBlockConfirmationsFromStateProof(sp);
        assertEq(res.length, 0, "empty last milestone -> no unfinalized blocks");
    }

    function test_unfinalized_skipsFirstFinalizedBlock() public {
        StateProof memory sp = _stateProofWithLastMilestone(3);
        BlockConfirmation[] memory res = _getUnfinalizedBlockConfirmationsFromStateProof(sp);
        assertEq(res.length, 2, "3 confirmations -> 2 unfinalized");
    }

    function testFuzz_unfinalized_neverReverts(uint8 n) public {
        StateProof memory sp = _stateProofWithLastMilestone(n);
        BlockConfirmation[] memory res = _getUnfinalizedBlockConfirmationsFromStateProof(sp);
        assertEq(res.length, n == 0 ? 0 : uint256(n) - 1, "n confirmations -> max(0, n-1) unfinalized");
    }
}
