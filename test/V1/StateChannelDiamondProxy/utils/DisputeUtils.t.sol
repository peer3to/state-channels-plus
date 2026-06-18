pragma solidity ^0.8.8;

import {Test} from "forge-std/Test.sol";
import "../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol";

contract DisputeUtilsTest is Test {
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
