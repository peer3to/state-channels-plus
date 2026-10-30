pragma solidity ^0.8.8;

import {Vm} from "forge-std/Vm.sol";
import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {RaceConditionChannelAlreadyOpen} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import "../../../contracts/V1/types/DataTypes.sol";

// test naming: test_<targetFunction>_<property>
contract StateChannelManagerProxyMulticallTest is DiamondHarness {
    event MulticallLastCallFailed(bytes revertData);

    StateChannelManagerInterface internal diamond;

    uint256 internal constant SIGNER_PK = 0xA11CE;
    uint256 internal constant SECOND_SIGNER_PK = 0xB0B;
    bytes32 internal constant CHANNEL_ID = keccak256("best-effort-multicall");
    bytes32 internal constant SECOND_CHANNEL_ID = keccak256("best-effort-multicall-second");

    function setUp() public {
        diamond = deployDiamond();
    }

    function test_multicallBestEffortLast_lastCallReverts_keepsEarlierEffectsAndEmitsRevertData() public {
        bytes[] memory calls = new bytes[](2);
        calls[0] = _openCall(CHANNEL_ID);
        calls[1] = _openCall(CHANNEL_ID);

        vm.expectEmit(address(diamond));
        emit MulticallLastCallFailed(abi.encodeWithSelector(RaceConditionChannelAlreadyOpen.selector, CHANNEL_ID));
        bytes[] memory results = diamond.multicallBestEffortLast(calls);

        assertEq(diamond.getParticipants(CHANNEL_ID).length, 2);
        assertEq(results.length, 2);
        assertEq(results[1].length, 0);
    }

    function test_multicallBestEffortLast_earlierCallReverts_revertsWhole() public {
        bytes[] memory calls = new bytes[](3);
        calls[0] = _openCall(CHANNEL_ID);
        calls[1] = _openCall(CHANNEL_ID);
        calls[2] = _openCall(SECOND_CHANNEL_ID);

        vm.expectRevert(abi.encodeWithSelector(RaceConditionChannelAlreadyOpen.selector, CHANNEL_ID));
        diamond.multicallBestEffortLast(calls);

        assertEq(diamond.getParticipants(CHANNEL_ID).length, 0);
        assertEq(diamond.getParticipants(SECOND_CHANNEL_ID).length, 0);
    }

    function test_multicallBestEffortLast_allCallsSucceed_matchesMulticall() public {
        bytes[] memory calls = new bytes[](2);
        calls[0] = _openCall(CHANNEL_ID);
        calls[1] = abi.encodeCall(StateChannelManagerInterface.getParticipants, (CHANNEL_ID));

        uint256 snapshot = vm.snapshotState();
        bytes[] memory expected = diamond.multicall(calls);
        vm.revertToState(snapshot);

        vm.recordLogs();
        bytes[] memory results = diamond.multicallBestEffortLast(calls);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(results.length, expected.length);
        for (uint256 i = 0; i < results.length; i++) {
            assertEq(results[i], expected[i]);
        }
        assertEq(abi.decode(results[1], (address[])).length, 2);
        _assertNoLastCallFailed(logs);
    }

    function test_multicallBestEffortLast_emptyList_returnsNoResultsAndEmitsNothing() public {
        vm.recordLogs();
        bytes[] memory results = diamond.multicallBestEffortLast(new bytes[](0));

        assertEq(results.length, 0);
        _assertNoLastCallFailed(vm.getRecordedLogs());
    }

    function test_multicallBestEffortLast_soleCallSucceeds_returnsItsResultAndEmitsNothing() public {
        bytes[] memory calls = new bytes[](1);
        calls[0] = _openCall(CHANNEL_ID);

        uint256 snapshot = vm.snapshotState();
        bytes[] memory expected = diamond.multicall(calls);
        vm.revertToState(snapshot);

        vm.recordLogs();
        bytes[] memory results = diamond.multicallBestEffortLast(calls);

        assertEq(results.length, 1);
        assertEq(results[0], expected[0]);
        assertEq(diamond.getParticipants(CHANNEL_ID).length, 2);
        _assertNoLastCallFailed(vm.getRecordedLogs());
    }

    function test_multicallBestEffortLast_soleCallReverts_returnsEmptyResultAndEmitsRevertData() public {
        bytes[] memory calls = new bytes[](1);
        calls[0] = _openCall(CHANNEL_ID);
        diamond.multicall(calls);

        vm.expectEmit(address(diamond));
        emit MulticallLastCallFailed(abi.encodeWithSelector(RaceConditionChannelAlreadyOpen.selector, CHANNEL_ID));
        bytes[] memory results = diamond.multicallBestEffortLast(calls);

        assertEq(results.length, 1);
        assertEq(results[0].length, 0);
        assertEq(diamond.getParticipants(CHANNEL_ID).length, 2);
    }

    function _assertNoLastCallFailed(Vm.Log[] memory logs) internal pure {
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != MulticallLastCallFailed.selector);
        }
    }

    function _openCall(bytes32 channelId) internal view returns (bytes memory) {
        uint256[] memory pks = new uint256[](2);
        pks[0] = SIGNER_PK;
        pks[1] = SECOND_SIGNER_PK;
        return abi.encodeCall(
            StateChannelManagerInterface.open, (_openChannelConfirmation(channelId, pks, new uint256[](2), true))
        );
    }
}
