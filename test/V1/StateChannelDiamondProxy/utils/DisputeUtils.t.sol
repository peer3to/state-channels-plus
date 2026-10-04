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
    }

    function test_reason_timeoutStillCountsWhenFlagFalse() public pure {
        DisputeInput memory input;
        StateSnapshot memory snapshot;
        input.timeout.participant = address(1);
        assertTrue(_hasDisputeReason(input, snapshot));
    }

    function test_reason_selfRemovalStillCountsWhenFlagFalse() public pure {
        DisputeInput memory input;
        StateSnapshot memory snapshot;
        input.selfRemoval = true;
        assertTrue(_hasDisputeReason(input, snapshot));
    }

    function test_reason_forcedInboundStillCountsWhenFlagFalse() public pure {
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
        sp.milestones = new MilestoneProof[](2);
        sp.milestones[0].blockConfirmations = new BlockConfirmation[](1);
        sp.milestones[0].blockConfirmations[0].signedBlock.encodedBlock = "earlier milestone";
        sp.milestones[1].blockConfirmations = new BlockConfirmation[](confirmations);
        for (uint256 i = 0; i < confirmations; i++) {
            sp.milestones[1].blockConfirmations[i].signedBlock.encodedBlock = abi.encode("last milestone block", i);
        }
    }

    function test_latestSignedBlock_emptyProof_hasNoBlock() public pure {
        StateProof memory sp;
        (bool hasBlock,) = _getLatestSignedBlock(sp);
        assertFalse(hasBlock, "the empty proof is the fork genesis");
    }

    function testFuzz_latestSignedBlock_neverReverts(uint8 n) public pure {
        (bool hasBlock, SignedBlock memory latest) = _getLatestSignedBlock(_stateProofWithLastMilestone(n));
        assertEq(hasBlock, n != 0, "n confirmations -> a latest block unless n is 0");
        if (hasBlock) assertEq(latest.encodedBlock, abi.encode("last milestone block", uint256(n) - 1));
    }
}
