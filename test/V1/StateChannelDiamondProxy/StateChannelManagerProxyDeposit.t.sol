pragma solidity ^0.8.8;

import {Vm} from "forge-std/Vm.sol";
import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerEvents} from "../../../contracts/V1/StateChannelManagerEvents.sol";
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
        JoinChannelConfirmation memory confirmation = _joinConfirmation(join, JOINER_PK, _participantPrivateKeys());

        StateSnapshot memory snapshot = diamond.getStateSnapshot(JOIN_CHANNEL_ID);
        // the facet submits this single join as index 0 of the batch
        vm.expectRevert(abi.encodeWithSelector(ErrorJoinChannelAtomicFailure.selector, uint256(0), join.participant));
        vm.prank(join.participant);
        diamond.joinChannel(confirmation, keccak256(abi.encode(snapshot)), snapshot.forkId);

        assertEq(_depositCount(), 0);
    }

    // the join's record carries the joiner as pending, keyed by the hash of the full emitted block
    function test_joinChannel_recordsJoinerAsPendingUnderTheFullBlockHash() public {
        vm.recordLogs();
        JoinChannel memory join = _joinOutsider();
        MessageBlock memory joinBlock = abi.decode(
            _logData(
                vm.getRecordedLogs(), StateChannelManagerEvents.InboundMessagesProcessed.selector, JOIN_CHANNEL_ID
            ),
            (MessageBlock)
        );

        assertTrue(
            diamond.hasInboundMessageBlock(JOIN_CHANNEL_ID, keccak256(abi.encode(joinBlock))), "join record not stored"
        );
        address[] memory pending = diamond.getPendingParticipants(JOIN_CHANNEL_ID);
        assertEq(pending.length, 1, "pending count");
        assertEq(pending[0], join.participant, "joiner not pending");
        assertFalse(diamond.isUncommittedInboundMessageBlock(JOIN_CHANNEL_ID, joinBlock), "genuine block uncommitted");
        // the record keeps no message data, but its key still covers it
        joinBlock.messages[0].data = abi.encode(keccak256("altered join data"));
        assertTrue(diamond.isUncommittedInboundMessageBlock(JOIN_CHANNEL_ID, joinBlock), "altered block found");
    }

    // a join stores only the small inbound record, not the full message block
    function test_joinChannel_writesSevenFreshSlots() public {
        vm.startStateDiffRecording();
        _joinOutsider();
        // 5 for the inbound record (link, height+timestamp, deposit total, joiners length, joiner); the other 2
        // are this suite's consumer deposit counter and the channel's first nonzero deposit total
        assertEq(_freshSlotsOf(address(diamond), vm.stopAndReturnStateDiff()), 7, "fresh slots");
    }

    // a nonzero join by the outsider JOINER_PK against the current snapshot
    function _joinOutsider() internal returns (JoinChannel memory join) {
        join = JoinChannel({
            channelId: JOIN_CHANNEL_ID,
            participant: vm.addr(JOINER_PK),
            deadlineTimestamp: block.timestamp + 120,
            balance: Balance({amount: 100, data: ""})
        });
        StateSnapshot memory snapshot = diamond.getStateSnapshot(JOIN_CHANNEL_ID);
        vm.prank(join.participant);
        diamond.joinChannel(
            _joinConfirmation(join, JOINER_PK, _participantPrivateKeys()),
            keccak256(abi.encode(snapshot)),
            snapshot.forkId
        );
    }

    // distinct slots of `account` written from zero to nonzero
    function _freshSlotsOf(address account, Vm.AccountAccess[] memory accesses) internal pure returns (uint256 count) {
        bytes32[] memory seen = new bytes32[](256);
        for (uint256 i = 0; i < accesses.length; i++) {
            Vm.StorageAccess[] memory storageAccesses = accesses[i].storageAccesses;
            for (uint256 j = 0; j < storageAccesses.length; j++) {
                Vm.StorageAccess memory access = storageAccesses[j];
                if (access.account != account || !access.isWrite || access.reverted) continue;
                if (access.previousValue != 0 || access.newValue == 0) continue;
                bool counted;
                for (uint256 k = 0; k < count; k++) {
                    if (seen[k] == access.slot) counted = true;
                }
                if (!counted) seen[count++] = access.slot;
            }
        }
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
