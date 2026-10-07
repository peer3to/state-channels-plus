pragma solidity ^0.8.8;

import {Test} from "../../../lib/forge-std/src/Test.sol";
import {JoinChannelFacetHarness} from "./JoinChannelFacet.t.sol";
import {RaceConditionJoinChannelSnapshotMismatch} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import "../../../contracts/V1/types/DataTypes.sol";

/// U115: the join transaction's snapshot parameter must name the current
/// on-chain snapshot. A matching target passes the guard (the join then runs
/// its other checks and deposits); any other target reverts with the
/// snapshot race-condition guard before any deposit.
// test naming: test_<targetFunction>_<property>
contract JoinChannelSnapshotGuardTest is Test {
    JoinChannelFacetHarness internal harness;

    uint256 internal constant PARTICIPANT_A_PK = 0xA11CE;
    uint256 internal constant PARTICIPANT_B_PK = 0xB0B;
    uint256 internal constant JOINER_PK = 0xCAFE;
    bytes32 internal constant CHANNEL_ID = keccak256("join-snapshot-guard");
    bytes32 internal constant FORK_ID = keccak256("join-snapshot-guard-fork");

    function setUp() public {
        harness = new JoinChannelFacetHarness();
        address[] memory participants = new address[](2);
        participants[0] = vm.addr(PARTICIPANT_A_PK);
        participants[1] = vm.addr(PARTICIPANT_B_PK);
        // participant B is slashed, so A alone is the threshold set
        harness.seedChannel(CHANNEL_ID, FORK_ID, participants, participants[1]);
    }

    function test_joinChannel_matchingSnapshotTargetPassesGuard() public {
        (JoinChannelConfirmation memory confirmation, address joiner) = _joinConfirmation();
        bytes32 current = keccak256(abi.encode(harness.getStateSnapshot(CHANNEL_ID)));

        vm.prank(joiner);
        harness.joinChannel(confirmation, current, FORK_ID);

        assertTrue(harness.depositCalled());
        assertEq(harness.depositedParticipant(), joiner);
    }

    function test_joinChannel_differentSnapshotTargetRevertsWithSnapshotMismatch() public {
        (JoinChannelConfirmation memory confirmation, address joiner) = _joinConfirmation();
        bytes32 current = keccak256(abi.encode(harness.getStateSnapshot(CHANNEL_ID)));
        // same fork, another state of it: a snapshot the join was prepared against
        StateSnapshot memory other = harness.getStateSnapshot(CHANNEL_ID);
        other.blockHeight += 1;
        other.timestamp += 1;
        bytes32 target = keccak256(abi.encode(other));
        assertTrue(target != current);

        vm.expectRevert(abi.encodeWithSelector(RaceConditionJoinChannelSnapshotMismatch.selector, current, target));
        vm.prank(joiner);
        harness.joinChannel(confirmation, target, FORK_ID);

        assertFalse(harness.depositCalled());
    }

    function _joinConfirmation() internal view returns (JoinChannelConfirmation memory confirmation, address joiner) {
        joiner = vm.addr(JOINER_PK);
        JoinChannel memory joinChannel = JoinChannel({
            channelId: CHANNEL_ID,
            participant: joiner,
            deadlineTimestamp: block.timestamp + 120,
            balance: Balance({amount: 500, data: ""})
        });
        bytes memory encoded = abi.encode(joinChannel);
        confirmation.signedJoinChannel =
            SignedJoinChannel({encodedJoinChannel: encoded, signature: _sign(JOINER_PK, encoded)});
        confirmation.signatures = new bytes[](1);
        confirmation.signatures[0] = _sign(PARTICIPANT_A_PK, encoded);
    }

    function _sign(uint256 privateKey, bytes memory encodedData) internal pure returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(encodedData)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
