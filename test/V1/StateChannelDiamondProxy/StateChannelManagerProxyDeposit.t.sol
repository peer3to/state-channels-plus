pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {SelectiveDepositConsumerFacet} from "../harness/SelectiveDepositConsumerFacet.sol";
import {
    ErrorJoinChannelAtomicFailure,
    ErrorNoJoinChannelProvided,
    ErrorNoSuccessfulJoinChannel
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import "../../../contracts/V1/types/DataTypes.sol";

// test naming: test_<targetFunction>_<property>
contract StateChannelManagerProxyDepositTest is DiamondHarness {
    StateChannelManagerInterface internal diamond;

    bytes32 internal constant CHANNEL_ID = keccak256("composable-deposit");
    bytes32 internal constant JOIN_CHANNEL_ID = keccak256("composable-deposit-join");

    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BOB_PK = 0xB0B;
    uint256 internal constant JOINER_PK = 0xCAFE;

    function setUp() public {
        diamond = deployDiamond();
        // opened while the real consumer is still installed, so the join path
        // starts from an open channel with a two-address threshold set
        _openChannel(JOIN_CHANNEL_ID, _participantPrivateKeys());

        SelectiveDepositConsumerFacet selectiveConsumer = new SelectiveDepositConsumerFacet();
        vm.etch(address(consumerFacet), address(selectiveConsumer).code);
    }

    function test_depositAssetsComposable_atomicFailureRollsBack() public {
        JoinChannel[] memory joins = _joins(100, 0);

        // the zero-amount join is the second one, so index 1 is what fails
        vm.expectRevert(abi.encodeWithSelector(ErrorJoinChannelAtomicFailure.selector, uint256(1), vm.addr(BOB_PK)));
        vm.prank(address(diamond));
        diamond.depositAssetsComposable(joins, true);

        assertEq(_depositCount(), 0);
        ChannelBalance memory channelBalance = diamond.getChannelBalance(CHANNEL_ID);
        assertEq(channelBalance.latestInboundMessageBlockHeight, 0);
        assertEq(channelBalance.totalDeposits.amount, 0);
    }

    function test_depositAssetsComposable_nonAtomicFiltersFailedDeposit() public {
        JoinChannel[] memory joins = _joins(100, 0);

        vm.prank(address(diamond));
        (MessageBlock memory messageBlock, Balance memory totalDeposits, JoinChannel[] memory successfulJoins) =
            diamond.depositAssetsComposable(joins, false);

        assertEq(successfulJoins.length, 1);
        assertEq(successfulJoins[0].participant, joins[0].participant);
        assertEq(messageBlock.messages.length, 1);
        assertEq(messageBlock.messages[0].participant, joins[0].participant);
        assertEq(messageBlock.blockHeight, 1);
        assertEq(totalDeposits.amount, 100);
        assertEq(_depositCount(), 1);

        ChannelBalance memory channelBalance = diamond.getChannelBalance(CHANNEL_ID);
        assertEq(channelBalance.latestInboundMessageBlockHeight, 1);
        assertEq(channelBalance.totalDeposits.amount, 100);
    }

    function test_depositAssetsComposable_allFailedRejected() public {
        JoinChannel[] memory joins = _joins(0, 0);

        vm.expectRevert(ErrorNoSuccessfulJoinChannel.selector);
        vm.prank(address(diamond));
        diamond.depositAssetsComposable(joins, false);

        assertEq(_depositCount(), 0);
        ChannelBalance memory channelBalance = diamond.getChannelBalance(CHANNEL_ID);
        assertEq(channelBalance.latestInboundMessageBlockHeight, 0);
        assertEq(channelBalance.totalDeposits.amount, 0);
    }

    function test_depositAssetsComposable_emptyBatchRejected() public {
        JoinChannel[] memory joins = new JoinChannel[](0);

        vm.expectRevert(ErrorNoJoinChannelProvided.selector);
        vm.prank(address(diamond));
        diamond.depositAssetsComposable(joins, false);

        assertEq(_depositCount(), 0);
    }

    function test_depositAssetsComposable_directCallerRejected() public {
        JoinChannel[] memory joins = _joins(100, 100);

        vm.expectRevert("Only self (facet) can call this (diamond) function");
        diamond.depositAssetsComposable(joins, false);

        assertEq(_depositCount(), 0);
    }

    /// The join reaches the real deposit loop through the deployed diamond, so
    /// the failing index and participant come from an actual failing iteration.
    function test_joinChannel_atomicDepositFailure_revertsNamingTheFailingJoin() public {
        // the consumer rejects a zero-amount deposit, so this join genuinely
        // fails inside the proxy's atomic loop
        JoinChannel memory join = JoinChannel({
            channelId: JOIN_CHANNEL_ID,
            participant: vm.addr(JOINER_PK),
            deadlineTimestamp: block.timestamp + 120,
            balance: Balance({amount: 0, data: ""})
        });
        bytes memory encodedJoin = abi.encode(join);

        JoinChannelConfirmation memory confirmation;
        confirmation.signedJoinChannel =
            SignedJoinChannel({encodedJoinChannel: encodedJoin, signature: _sign(JOINER_PK, encodedJoin)});
        confirmation.signatures = new bytes[](2);
        confirmation.signatures[0] = _sign(ALICE_PK, encodedJoin);
        confirmation.signatures[1] = _sign(BOB_PK, encodedJoin);

        StateSnapshot memory snapshot = diamond.getStateSnapshot(JOIN_CHANNEL_ID);
        // the facet submits this single join as index 0 of the batch
        vm.expectRevert(abi.encodeWithSelector(ErrorJoinChannelAtomicFailure.selector, uint256(0), join.participant));
        vm.prank(join.participant);
        diamond.joinChannel(confirmation, keccak256(abi.encode(snapshot)), snapshot.forkId);

        assertEq(_depositCount(), 0);
    }

    function _participantPrivateKeys() internal pure returns (uint256[] memory pks) {
        pks = new uint256[](2);
        pks[0] = ALICE_PK;
        pks[1] = BOB_PK;
    }

    function _joins(uint256 firstAmount, uint256 secondAmount) internal view returns (JoinChannel[] memory joins) {
        joins = new JoinChannel[](2);
        joins[0] = JoinChannel({
            channelId: CHANNEL_ID,
            participant: vm.addr(ALICE_PK),
            deadlineTimestamp: block.timestamp + 120,
            balance: Balance({amount: firstAmount, data: ""})
        });
        joins[1] = JoinChannel({
            channelId: CHANNEL_ID,
            participant: vm.addr(BOB_PK),
            deadlineTimestamp: block.timestamp + 120,
            balance: Balance({amount: secondAmount, data: ""})
        });
    }

    function _depositCount() internal view returns (uint256) {
        return SelectiveDepositConsumerFacet(address(diamond)).depositCount();
    }
}
