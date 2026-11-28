pragma solidity ^0.8.8;

import {Vm} from "forge-std/Vm.sol";
import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {StateChannelManagerEvents} from "../../../contracts/V1/StateChannelManagerEvents.sol";
import {MathConsumerFacet} from "../../../contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol";
import {StateChannelCommon} from "../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol";
import {MESSAGE_TYPE_EXIT} from "../../../contracts/V1/types/MessageTypeHashes.sol";
import "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// The Math consumer facet plus what a finished dispute game leaves on the channel's window: a slash record and a
/// committed reduced result, both written by the production writers. Etched over the diamond's consumer facet, so its
/// staging call reaches the diamond's storage through the proxy fallback.
contract ReducedForkStagingConsumerFacet is MathConsumerFacet, StateChannelCommon {
    function stageReducedFork(
        bytes32 channelId,
        bytes32 fromForkId,
        bytes32 toForkId,
        uint256 reductionTimestamp,
        address slashed
    ) external {
        addOnChainSlashedParticipant(channelId, slashed);
        _commitToDisputeReducedResult(
            channelId, disputeData[channelId].disputeWindowMap[fromForkId], toForkId, reductionTimestamp
        );
    }
}

/// A final close emits one zero-participant snapshot event and leaves no
/// channel-keyed slot but fallback calldata commitments; a close through an adopted fork also keeps the inbound
/// blocks above its head; dispute throttles end at every clear.
contract ChannelCleanCloseTest is DiamondHarness {
    StateChannelManagerInterface internal diamond;

    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BOB_PK = 0xB0B;
    uint256 internal constant CAROL_PK = 0xCA401;
    bytes32 internal constant CHANNEL = keccak256("channel");

    // diamond slots the recorded lifecycle wrote, deduplicated
    mapping(bytes32 slot => bool written) internal seenSlot;
    bytes32[] internal writtenSlots;
    // diamond slots the recorded top-up wrote
    mapping(bytes32 slot => bool written) internal topUpSlot;

    function setUp() public {
        vm.warp(1_000_000);
        diamond = deployDiamond();
    }

    // ---------- final close ----------

    function test_finalClose_emitsOneZeroParticipantSnapshotEvent() public {
        _openChannel(CHANNEL, _privateKeys());
        vm.recordLogs();
        bytes32 closedHead = _closeChannel(CHANNEL, _privateKeys());
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 count;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(diamond)) continue;
            if (logs[i].topics[0] != StateChannelManagerEvents.StateSnapshotUpdated.selector) continue;
            assertEq(logs[i].topics[1], CHANNEL, "event channel id");
            assertEq(abi.decode(logs[i].data, (StateSnapshot)).snapshotData.participants.length, 0, "no participants");
            count += 1;
        }
        assertEq(count, 1, "one snapshot event");
        _assertClosedAndEmpty(CHANNEL, closedHead);
    }

    function test_finalClose_repeatedCloseReverts_channelStaysEmpty() public {
        _openChannel(CHANNEL, _privateKeys());
        _deposit(CHANNEL, ALICE_PK, 5);
        // the close pays alice's deposit out -> it writes a withdrawal total and an outbound height before the delete
        MessageBlock[] memory outbound = new MessageBlock[](1);
        outbound[0].blockHeight = 1;
        outbound[0].messages = new Message[](1);
        ExitChannel memory exit = ExitChannel({participant: vm.addr(ALICE_PK), balance: Balance({amount: 5, data: ""})});
        outbound[0].messages[0] = Message({
            messageType: MESSAGE_TYPE_EXIT, participant: exit.participant, balance: exit.balance, data: abi.encode(exit)
        });
        (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) =
            _makeSameForkSnapshotWithOutbound(CHANNEL, new address[](0), _privateKeys(), outbound);
        bytes32 closedHead = diamond.getChannelBalance(CHANNEL).latestInboundMessageBlockHash;
        vm.recordLogs();
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, snapshots, outbound);
        Balance memory paid = abi.decode(
            _logData(vm.getRecordedLogs(), StateChannelManagerEvents.WithdrawalsUpdated.selector, CHANNEL), (Balance)
        );
        assertEq(paid.amount, 5, "the close paid the exit");
        _assertClosedAndEmpty(CHANNEL, closedHead);

        // the deleted snapshot leaves the chain fork at zero
        vm.expectRevert(
            abi.encodeWithSelector(
                RaceConditionSnapshotForkMismatch.selector, bytes32(0), snapshots[snapshots.length - 1].forkId
            )
        );
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, snapshots, outbound);
        _assertClosedAndEmpty(CHANNEL, closedHead);
    }

    function test_updateStateSnapshotSameFork_finalClosePrunesTheInboundHeadWithOneStorageClear() public {
        _openChannel(CHANNEL, _privateKeys());
        bytes32 openInboundHash = diamond.getChannelBalance(CHANNEL).latestInboundMessageBlockHash;
        bytes32 headInboundHash = keccak256(abi.encode(_deposit(CHANNEL, ALICE_PK, 5)));

        vm.recordLogs();
        _closeChannel(CHANNEL, _privateKeys());
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 clearCount;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] != StateChannelManagerEvents.ChannelStorageCleared.selector) continue;
            clearCount += 1;
            assertEq(abi.decode(logs[i].data, (bytes32)), headInboundHash, "the close names the snapshot head");
        }
        assertEq(clearCount, 1, "one storage clear");
        assertFalse(diamond.hasInboundMessageBlock(CHANNEL, headInboundHash), "head pruned");
        assertFalse(diamond.hasInboundMessageBlock(CHANNEL, openInboundHash), "below the head pruned");
    }

    // ---------- clean close: no channel slot left but fallback commitments ----------

    function test_cleanClose_twoSeats_leavesNoChannelSlotButCalldataCommitments() public {
        _assertCleanLifecycle(_keyRange(2));
    }

    function test_cleanClose_sixSeats_leavesNoChannelSlotButCalldataCommitments() public {
        _assertCleanLifecycle(_keyRange(6));
    }

    // ---------- throttles end with the channel's dispute data ----------

    function test_midLifeClear_endsAnUnexpiredThrottle_disputerUploadsAgainAtOnce() public {
        uint256[] memory pks = _privateKeys();
        _openChannel(CHANNEL, pks);
        _upload(CHANNEL, keccak256("disputed fork 1"), ALICE_PK, pks);
        _upload(CHANNEL, keccak256("disputed fork 1"), BOB_PK, pks);

        // step 1 - alice is throttled until upload + evidenceTime
        uint256 expiry = block.timestamp + diamond.getEvidenceTime();
        DisputeConfirmation memory throttled =
            _disputeConfirmation(CHANNEL, keccak256("disputed fork 2"), ALICE_PK, pks);
        vm.expectRevert(
            abi.encodeWithSelector(ErrorDisputeThrottled.selector, vm.addr(ALICE_PK), expiry, block.timestamp)
        );
        vm.prank(vm.addr(ALICE_PK));
        diamond.uploadDispute(throttled);

        // step 2 - a same-fork update on the undisputed current fork clears the channel's dispute data
        (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) =
            _makeSameForkSnapshot(CHANNEL, _addrs(pks), pks);
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, snapshots, new MessageBlock[](0));
        assertEq(diamond.getDisputeWindowCreationTimestamp(CHANNEL, keccak256("disputed fork 1")), 0, "window gone");

        // step 3 - still inside alice's old throttle, her next upload lands
        assertLt(block.timestamp, expiry, "old throttle not expired");
        _upload(CHANNEL, keccak256("disputed fork 2"), ALICE_PK, pks);
        _upload(CHANNEL, keccak256("disputed fork 2"), BOB_PK, pks);
    }

    function test_finalClose_endsEveryThrottle_reopenedChannelAcceptsTheOldDisputerAtOnce() public {
        uint256[] memory pks = _privateKeys();
        _openChannel(CHANNEL, pks);
        _upload(CHANNEL, keccak256("disputed fork"), ALICE_PK, pks);
        uint256 expiry = block.timestamp + diamond.getEvidenceTime();
        _deposit(CHANNEL, ALICE_PK, 5);

        bytes32 closedHead = _closeChannel(CHANNEL, pks);
        _assertClosedAndEmpty(CHANNEL, closedHead);

        _openChannel(CHANNEL, pks);
        ChannelBalance memory balance = diamond.getChannelBalance(CHANNEL);
        assertEq(balance.latestInboundMessageBlockHeight, 1, "inbound restarts at the open block");
        assertEq(balance.totalDeposits.amount, 0, "no deposit of the old incarnation");
        assertLt(block.timestamp, expiry, "old throttle not expired");
        _upload(CHANNEL, keccak256("disputed fork"), ALICE_PK, pks);
    }

    // ---------- clean close through an adopted fork ----------

    function test_forkAdoptionClose_leavesNoChannelSlotButTheInboundBlockAboveTheAdoptedHead() public {
        uint256[] memory pks = _privateKeys();
        vm.etch(address(consumerFacet), address(new ReducedForkStagingConsumerFacet()).code);

        vm.startStateDiffRecording();
        _openChannel(CHANNEL, pks);
        _collectWrittenSlots(vm.stopAndReturnStateDiff());
        StateSnapshot memory origin = diamond.getStateSnapshot(CHANNEL);
        bytes32 originForkId = origin.forkId;
        bytes32 adoptedHead = origin.snapshotData.latestInboundMessageBlockHash;

        // step 1 - a top-up lands above the inbound head the adopted fork keeps
        vm.startStateDiffRecording();
        _topUp(CHANNEL, ALICE_PK, pks);
        Vm.AccountAccess[] memory topUpAccesses = vm.stopAndReturnStateDiff();
        _collectWrittenSlots(topUpAccesses);
        _markTopUpSlots(topUpAccesses);
        bytes32 aboveHead = diamond.getChannelBalance(CHANNEL).latestInboundMessageBlockHash;

        // step 2 - two disputers upload on the current fork -> one window, two live throttles
        vm.startStateDiffRecording();
        _upload(CHANNEL, originForkId, ALICE_PK, pks);
        _upload(CHANNEL, originForkId, BOB_PK, pks);

        // step 3 - the window reduced to a zero-participant genesis that kept the open block as its inbound head,
        // one member slashed; the challenge period is over
        uint256 genesisTimestamp = block.timestamp + diamond.getEvidenceTime();
        StateSnapshot memory adopted;
        adopted.snapshotData = origin.snapshotData;
        adopted.snapshotData.participants = new address[](0);
        adopted.snapshotData.originForkId = originForkId;
        adopted.timestamp = genesisTimestamp;
        adopted.forkId = keccak256(abi.encode(adopted.snapshotData));
        vm.warp(genesisTimestamp + diamond.getEvidenceTime());
        ReducedForkStagingConsumerFacet(address(diamond))
            .stageReducedFork(CHANNEL, originForkId, adopted.forkId, genesisTimestamp, vm.addr(BOB_PK));
        assertEq(diamond.getOnChainSlashedParticipants(CHANNEL).length, 1, "slash record staged");
        assertGt(diamond.getDisputeWindowCreationTimestamp(CHANNEL, originForkId), 0, "window open");

        // step 4 - adopting the fork closes the channel
        diamond.updateStateSnapshotFork(CHANNEL, adopted, new MessageBlock[](0));
        _collectWrittenSlots(vm.stopAndReturnStateDiff());

        uint256 keptSlots;
        for (uint256 i = 0; i < writtenSlots.length; i++) {
            if (vm.load(address(diamond), writtenSlots[i]) == bytes32(0)) continue;
            assertTrue(topUpSlot[writtenSlots[i]], "only the top-up's inbound block stays");
            keptSlots += 1;
        }
        assertGt(keptSlots, 0, "the block above the adopted head stays");
        assertTrue(diamond.hasInboundMessageBlock(CHANNEL, aboveHead), "the block above the adopted head stays");
        assertEq(diamond.getOnChainSlashedParticipants(CHANNEL).length, 0, "slash record cleared");
        assertEq(diamond.getDisputeWindowCreationTimestamp(CHANNEL, originForkId), 0, "window cleared");
        _assertClosedAndEmpty(CHANNEL, adoptedHead);
    }

    // ---------- helpers ----------

    /// open, a fallback calldata post, a top-up, two disputers on another fork, a mid-life clear, a third upload,
    /// then the close: every diamond slot the lifecycle wrote reads zero but the posted commitment
    function _assertCleanLifecycle(uint256[] memory pks) internal {
        vm.startStateDiffRecording();
        _openChannel(CHANNEL, pks);

        SignedBlock memory posted =
            _makeSignedBlock(pks[0], CHANNEL, diamond.getStateSnapshot(CHANNEL).forkId, 1, block.timestamp, bytes32(0));
        vm.prank(vm.addr(pks[0]));
        diamond.postBlockCalldata(posted, block.timestamp);
        bytes32 commitment = keccak256(abi.encode(posted, block.timestamp));

        _topUp(CHANNEL, pks[0], pks);
        _upload(CHANNEL, keccak256("disputed fork 1"), pks[0], pks);
        _upload(CHANNEL, keccak256("disputed fork 1"), pks[1], pks);
        (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) =
            _makeSameForkSnapshot(CHANNEL, _addrs(pks), pks);
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, snapshots, new MessageBlock[](0));
        _upload(CHANNEL, keccak256("disputed fork 2"), pks[1], pks);
        bytes32 closedHead = _closeChannel(CHANNEL, pks);
        Vm.AccountAccess[] memory accesses = vm.stopAndReturnStateDiff();

        _collectWrittenSlots(accesses);
        uint256 commitmentSlots;
        for (uint256 i = 0; i < writtenSlots.length; i++) {
            bytes32 value = vm.load(address(diamond), writtenSlots[i]);
            if (value == bytes32(0)) continue;
            assertEq(value, commitment, "only the fallback commitment stays");
            commitmentSlots += 1;
        }
        assertEq(commitmentSlots, 1, "the commitment stays");
        assertGt(writtenSlots.length, 40, "the lifecycle wrote the channel's state");
        _assertClosedAndEmpty(CHANNEL, closedHead);
    }

    function _collectWrittenSlots(Vm.AccountAccess[] memory accesses) internal {
        for (uint256 i = 0; i < accesses.length; i++) {
            Vm.StorageAccess[] memory storageAccesses = accesses[i].storageAccesses;
            for (uint256 j = 0; j < storageAccesses.length; j++) {
                Vm.StorageAccess memory access = storageAccesses[j];
                if (access.account != address(diamond) || !access.isWrite || access.reverted) continue;
                if (seenSlot[access.slot]) continue;
                seenSlot[access.slot] = true;
                writtenSlots.push(access.slot);
            }
        }
    }

    function _markTopUpSlots(Vm.AccountAccess[] memory accesses) internal {
        for (uint256 i = 0; i < accesses.length; i++) {
            Vm.StorageAccess[] memory storageAccesses = accesses[i].storageAccesses;
            for (uint256 j = 0; j < storageAccesses.length; j++) {
                Vm.StorageAccess memory access = storageAccesses[j];
                if (access.account != address(diamond) || !access.isWrite || access.reverted) continue;
                topUpSlot[access.slot] = true;
            }
        }
    }

    /// every channel read returns zero and `closedHead`, the closing snapshot's inbound head, is pruned
    function _assertClosedAndEmpty(bytes32 channelId, bytes32 closedHead) internal view {
        (bool open,) = diamond.isChannelOpen(channelId);
        assertFalse(open, "closed");
        StateSnapshot memory empty;
        assertEq(
            keccak256(abi.encode(diamond.getStateSnapshot(channelId))), keccak256(abi.encode(empty)), "snapshot cleared"
        );
        ChannelBalance memory balance = diamond.getChannelBalance(channelId);
        assertEq(balance.latestInboundMessageBlockHash, bytes32(0), "inbound head cleared");
        assertEq(balance.latestInboundMessageBlockHeight, 0, "inbound height cleared");
        assertEq(balance.totalDeposits.amount, 0, "deposits cleared");
        assertEq(balance.totalWithdrawals.amount, 0, "withdrawals cleared");
        assertEq(balance.latestOutboundMessageBlockHeight, 0, "outbound height cleared");
        assertFalse(diamond.hasInboundMessageBlock(channelId, closedHead), "closed head pruned");
    }

    /// closes through a zero-participant same-fork update; returns the inbound head it consumed
    function _closeChannel(bytes32 channelId, uint256[] memory pks) internal returns (bytes32 closedHead) {
        closedHead = diamond.getChannelBalance(channelId).latestInboundMessageBlockHash;
        (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) =
            _makeSameForkSnapshot(channelId, new address[](0), pks);
        diamond.updateStateSnapshotSameFork(channelId, proofs, snapshots, new MessageBlock[](0));
        (bool open,) = diamond.isChannelOpen(channelId);
        assertFalse(open);
    }

    function _deposit(bytes32 channelId, uint256 pk, uint256 amount)
        internal
        returns (MessageBlock memory messageBlock)
    {
        JoinChannel[] memory joins = new JoinChannel[](1);
        joins[0] = JoinChannel({
            channelId: channelId,
            participant: vm.addr(pk),
            deadlineTimestamp: block.timestamp + 1 days,
            balance: Balance({amount: amount, data: ""})
        });
        vm.prank(address(diamond));
        (messageBlock,) = diamond.depositAssetsComposable(joins);
    }

    function _topUp(bytes32 channelId, uint256 participantPk, uint256[] memory signerPks) internal {
        JoinChannel memory join = JoinChannel({
            channelId: channelId,
            participant: vm.addr(participantPk),
            deadlineTimestamp: block.timestamp + 120,
            balance: Balance({amount: 7, data: ""})
        });
        StateSnapshot memory snapshot = diamond.getStateSnapshot(channelId);
        JoinChannelConfirmation memory confirmation = _joinConfirmation(join, participantPk, signerPks);
        vm.prank(vm.addr(participantPk));
        diamond.topUpBalance(confirmation, keccak256(abi.encode(snapshot)), snapshot.forkId);
    }

    /// `disputerPk` uploads a dispute on `forkId` at the chain's inbound head, its milestone signed by `pks`
    function _upload(bytes32 channelId, bytes32 forkId, uint256 disputerPk, uint256[] memory pks) internal {
        DisputeConfirmation memory confirmation = _disputeConfirmation(channelId, forkId, disputerPk, pks);
        vm.prank(vm.addr(disputerPk));
        diamond.uploadDispute(confirmation);
    }

    function _disputeConfirmation(bytes32 channelId, bytes32 forkId, uint256 disputerPk, uint256[] memory pks)
        internal
        view
        returns (DisputeConfirmation memory confirmation)
    {
        ChannelBalance memory head = diamond.getChannelBalance(channelId);
        Dispute memory dispute;
        dispute.input.channelId = channelId;
        dispute.input.forkId = forkId;
        dispute.input.disputer = vm.addr(disputerPk);
        dispute.input.latestInboundMessageBlockHash = head.latestInboundMessageBlockHash;
        dispute.input.lastInboundMessageBlockHeight = head.latestInboundMessageBlockHeight;
        dispute.input.stateProof.milestones = new MilestoneProof[](1);
        dispute.input.stateProof.milestones[0] = _milestone(channelId, forkId, pks);
        confirmation.signedDispute =
            SignedDispute({encodedDispute: abi.encode(dispute), signature: _sign(disputerPk, abi.encode(dispute))});
    }

    function _privateKeys() internal pure returns (uint256[] memory pks) {
        pks = new uint256[](2);
        pks[0] = ALICE_PK;
        pks[1] = BOB_PK;
    }

    function _keyRange(uint256 n) internal pure returns (uint256[] memory pks) {
        pks = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            pks[i] = CAROL_PK + i;
        }
    }

    function _addrs(uint256[] memory pks) internal pure returns (address[] memory addresses) {
        addresses = new address[](pks.length);
        for (uint256 i = 0; i < pks.length; i++) {
            addresses[i] = vm.addr(pks[i]);
        }
    }
}
