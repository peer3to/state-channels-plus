pragma solidity ^0.8.8;

import {Vm} from "forge-std/Vm.sol";
import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {StateChannelManagerEvents} from "../../../contracts/V1/StateChannelManagerEvents.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

contract StateSnapshotFacetOpenChannelRegistryTest is DiamondHarness {
    StateChannelManagerInterface internal diamond;

    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BOB_PK = 0xB0B;
    bytes32 internal constant CHANNEL_A = keccak256("registry-channel-a");
    bytes32 internal constant CHANNEL_B = keccak256("registry-channel-b");
    bytes32 internal constant CHANNEL_C = keccak256("registry-channel-c");

    function setUp() public {
        diamond = deployDiamond();
    }

    function test_updateStateSnapshotSameFork_finalCloseRemovesFirstAndRepairsMovedIndex() public {
        _openThreeChannels();

        _closeChannel(CHANNEL_A);
        _assertRegistry(_twoIds(CHANNEL_C, CHANNEL_B));
        _closeChannel(CHANNEL_C);
        _assertRegistry(_oneId(CHANNEL_B));
    }

    function test_updateStateSnapshotSameFork_finalCloseRemovesMiddle() public {
        _openThreeChannels();

        _closeChannel(CHANNEL_B);

        _assertRegistry(_twoIds(CHANNEL_A, CHANNEL_C));
    }

    function test_updateStateSnapshotSameFork_finalCloseRemovesLast() public {
        _openThreeChannels();

        _closeChannel(CHANNEL_C);

        _assertRegistry(_twoIds(CHANNEL_A, CHANNEL_B));
    }

    function test_updateStateSnapshotSameFork_repeatedFinalCloseDoesNotChangeRegistry() public {
        _openChannel(CHANNEL_A, _privateKeys());
        (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) =
            _makeFinalCloseSnapshot(CHANNEL_A, _participants(), _privateKeys());
        MessageBlock[] memory outbound = new MessageBlock[](0);
        diamond.updateStateSnapshotSameFork(CHANNEL_A, proofs, snapshots, outbound);

        (bool open,) = diamond.isChannelOpen(CHANNEL_A);
        assertFalse(open);
        assertEq(diamond.getOpenChannelCount(), 0);

        vm.expectRevert();
        diamond.updateStateSnapshotSameFork(CHANNEL_A, proofs, snapshots, outbound);
        assertEq(diamond.getOpenChannelCount(), 0);
    }

    function test_open_afterFinalCloseAppendsChannelExactlyOnce() public {
        _openChannel(CHANNEL_A, _privateKeys());
        _closeChannel(CHANNEL_A);

        _openChannel(CHANNEL_A, _privateKeys());

        _assertRegistry(_oneId(CHANNEL_A));
        (bool open,) = diamond.isChannelOpen(CHANNEL_A);
        assertTrue(open);
    }

    function test_lifecycleEvents_reconstructPagedOpenChannelRegistry() public {
        vm.recordLogs();
        _openThreeChannels();
        _closeChannel(CHANNEL_B);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32[] memory live = new bytes32[](3);
        uint256 liveCount;
        bytes32 openedTopic = StateChannelManagerEvents.ChannelOpened.selector;
        bytes32 snapshotTopic = StateChannelManagerEvents.StateSnapshotUpdated.selector;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length < 2) continue;
            bytes32 channelId = logs[i].topics[1];
            if (logs[i].topics[0] == openedTopic) {
                live[liveCount] = channelId;
                liveCount += 1;
            } else if (logs[i].topics[0] == snapshotTopic) {
                StateSnapshot memory snapshot = abi.decode(logs[i].data, (StateSnapshot));
                if (snapshot.snapshotData.participants.length == 0) {
                    for (uint256 j = 0; j < liveCount; j++) {
                        if (live[j] != channelId) continue;
                        live[j] = live[liveCount - 1];
                        liveCount -= 1;
                        break;
                    }
                }
            }
        }

        bytes32[] memory registry = diamond.getOpenChannelIds(0, type(uint256).max);
        assertEq(registry.length, liveCount);
        for (uint256 i = 0; i < liveCount; i++) {
            assertEq(registry[i], live[i]);
        }
    }

    function _openThreeChannels() internal {
        uint256[] memory pks = _privateKeys();
        _openChannel(CHANNEL_A, pks);
        _openChannel(CHANNEL_B, pks);
        _openChannel(CHANNEL_C, pks);
    }

    function _closeChannel(bytes32 channelId) internal {
        (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) =
            _makeFinalCloseSnapshot(channelId, _participants(), _privateKeys());
        diamond.updateStateSnapshotSameFork(channelId, proofs, snapshots, new MessageBlock[](0));
        (bool open,) = diamond.isChannelOpen(channelId);
        assertFalse(open);
    }

    function _assertRegistry(bytes32[] memory expected) internal view {
        assertEq(diamond.getOpenChannelCount(), expected.length);
        bytes32[] memory actual = diamond.getOpenChannelIds(0, type(uint256).max);
        assertEq(actual.length, expected.length);
        for (uint256 i = 0; i < expected.length; i++) {
            assertEq(actual[i], expected[i]);
        }
    }

    function _privateKeys() internal pure returns (uint256[] memory pks) {
        pks = new uint256[](2);
        pks[0] = ALICE_PK;
        pks[1] = BOB_PK;
    }

    function _participants() internal pure returns (address[] memory participants) {
        participants = new address[](2);
        participants[0] = vm.addr(ALICE_PK);
        participants[1] = vm.addr(BOB_PK);
    }

    function _oneId(bytes32 a) internal pure returns (bytes32[] memory ids) {
        ids = new bytes32[](1);
        ids[0] = a;
    }

    function _twoIds(bytes32 a, bytes32 b) internal pure returns (bytes32[] memory ids) {
        ids = new bytes32[](2);
        ids[0] = a;
        ids[1] = b;
    }
}
