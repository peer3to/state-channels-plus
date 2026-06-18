pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerProxy} from "../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol";
import "../../../contracts/V1/types/DataTypes.sol";

// test naming: test_<targetFunction>_<property>
contract DisputeVerificationFacetTest is DiamondHarness {
    StateChannelManagerProxy internal diamond;

    bytes32 internal constant CHANNEL_ID = keccak256("dv-channel");
    bytes32 internal constant FORK_ID = keccak256("dv-fork");

    function setUp() public {
        diamond = deployDiamond();
    }

    // reduce() must not OOB-panic when dispute.input.onChainSlashes.length exceeds
    // participants + pending (maxSlashCount).
    function test_reduce_oversizedOnChainSlashes_doesNotPanic() public {
        Dispute[] memory disputes = new Dispute[](1);
        disputes[0].input.channelId = CHANNEL_ID;
        disputes[0].input.forkId = FORK_ID;

        address[] memory fakeSlashes = new address[](20);
        for (uint256 i = 0; i < 20; i++) {
            fakeSlashes[i] = address(uint160(i + 1));
        }
        disputes[0].input.onChainSlashes = fakeSlashes;

        // maxSlashCount = 0 (no channel open → no participants) → extra slashes are skipped
        ReduceOutput memory out = diamond.reduce(disputes);
        assertEq(out.slashedParticipants.length, 0);
    }

    // slashedParticipants in the output must never exceed participants + pending,
    // regardless of what a dispute claims in onChainSlashes.
    function testFuzz_reduce_slashedParticipantsNeverExceedsMaxSlashCount(uint8 slashCount) public {
        vm.assume(slashCount > 0);

        Dispute[] memory disputes = new Dispute[](1);
        disputes[0].input.channelId = CHANNEL_ID;
        disputes[0].input.forkId = FORK_ID;

        address[] memory fakeSlashes = new address[](slashCount);
        for (uint256 i = 0; i < slashCount; i++) {
            fakeSlashes[i] = address(uint160(i + 1));
        }
        disputes[0].input.onChainSlashes = fakeSlashes;

        ReduceOutput memory out = diamond.reduce(disputes);
        // no open channel → maxSlashCount = 0; output must always be within that bound
        assertEq(out.slashedParticipants.length, 0);
    }
}
