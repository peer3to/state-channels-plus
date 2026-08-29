pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {AConsumerFacet} from "../../../contracts/V1/StateChannelDiamondProxy/AConsumerFacet.sol";
import {
    ErrorJoinChannelAtomicFailure,
    ErrorNoJoinChannelProvided,
    ErrorNoSuccessfulJoinChannel
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import "../../../contracts/V1/types/DataTypes.sol";

contract SelectiveDepositConsumerFacet is AConsumerFacet {
    bytes32 private constant DEPOSIT_COUNT_SLOT = keccak256("state-channels-plus.test.deposit-count");

    function openChannelGenesis(JoinChannel[] memory, bytes memory)
        external
        pure
        override
        returns (bytes memory encodedGenesisState, address[] memory participants)
    {
        participants = new address[](0);
        return (encodedGenesisState, participants);
    }

    function deposit(JoinChannel memory joinChannel) external override returns (bool) {
        if (joinChannel.balance.amount == 0) return false;

        bytes32 slot = DEPOSIT_COUNT_SLOT;
        assembly {
            sstore(slot, add(sload(slot), 1))
        }
        return true;
    }

    function withdraw(ExitChannel memory) external pure override returns (bool) {
        return true;
    }

    function depositCount() external view returns (uint256 count) {
        bytes32 slot = DEPOSIT_COUNT_SLOT;
        assembly {
            count := sload(slot)
        }
    }
}

// test naming: test_<targetFunction>_<property>
contract StateChannelManagerProxyDepositTest is DiamondHarness {
    StateChannelManagerInterface internal diamond;

    bytes32 internal constant CHANNEL_ID = keccak256("composable-deposit");

    function setUp() public {
        diamond = deployDiamond();

        SelectiveDepositConsumerFacet selectiveConsumer = new SelectiveDepositConsumerFacet();
        vm.etch(address(consumerFacet), address(selectiveConsumer).code);
    }

    function test_depositAssetsComposable_atomicFailureRollsBack() public {
        JoinChannel[] memory joins = _joins(100, 0);

        vm.expectRevert(ErrorJoinChannelAtomicFailure.selector);
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

    function _joins(uint256 firstAmount, uint256 secondAmount) internal view returns (JoinChannel[] memory joins) {
        joins = new JoinChannel[](2);
        joins[0] = JoinChannel({
            channelId: CHANNEL_ID,
            participant: vm.addr(0xA11CE),
            deadlineTimestamp: block.timestamp + 120,
            balance: Balance({amount: firstAmount, data: ""})
        });
        joins[1] = JoinChannel({
            channelId: CHANNEL_ID,
            participant: vm.addr(0xB0B),
            deadlineTimestamp: block.timestamp + 120,
            balance: Balance({amount: secondAmount, data: ""})
        });
    }

    function _depositCount() internal view returns (uint256) {
        return SelectiveDepositConsumerFacet(address(diamond)).depositCount();
    }
}
