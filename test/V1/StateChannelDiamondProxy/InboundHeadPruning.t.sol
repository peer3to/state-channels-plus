pragma solidity ^0.8.8;

import {Test} from "forge-std/Test.sol";
import {DisputeFraudProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol";
import {DisputeVerificationFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol";
import {StateProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol";
import {StateSnapshotFacet} from "../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import {StateChannelManagerEvents} from "../../../contracts/V1/StateChannelManagerEvents.sol";
import {MathStateMachine} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import {InboundSeeding} from "../harness/InboundSeeding.sol";
import {MathState} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import {ErrorInboundMessageBlockNotStored} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import "../../../contracts/V1/types/DataTypes.sol";

contract InboundHeadPruningHarness is
    DisputeFraudProofFacet,
    DisputeVerificationFacet,
    StateSnapshotFacet,
    InboundSeeding
{
    constructor() {
        evidenceTime = 10;
        utilityFacetAddress = address(new UtilityFacet());
        stateProofFacetAddress = address(new StateProofFacet());
        disputeVerificationFacetAddress = address(this);
        stateMachineImplementation = new MathStateMachine(3_000_000, 32);
    }

    /// what a landed `_updateStateSnapshot` writes for the participant set and inbound head
    function landSnapshot(bytes32 channelId, address[] memory participants, bytes32 inboundHash, uint256 inboundHeight)
        external
    {
        SnapshotData storage data = stateSnapshots[channelId].snapshotData;
        delete data.participants;
        for (uint256 i = 0; i < participants.length; i++) {
            data.participants.push(participants[i]);
        }
        data.latestInboundMessageBlockHash = inboundHash;
        data.latestInboundMessageBlockHeight = inboundHeight;
    }

    /// an expired dispute window on `forkId`, as `uploadDispute` opens it
    function seedWindow(bytes32 channelId, bytes32 forkId) external {
        seedWindowAt(channelId, forkId, block.timestamp);
    }

    /// a dispute window on `forkId` opened at `timestamp`
    function seedWindowAt(bytes32 channelId, bytes32 forkId, uint256 timestamp) public {
        DisputeWindow storage window = disputeData[channelId].disputeWindowMap[forkId];
        window.forkId = forkId;
        window.evidence.creationTimestamp = timestamp;
        window.evidence.lastEvidenceSubmissionTimestamp = timestamp;
        disputeData[channelId].disputedForks.push(forkId);
    }

    function clearStorage(bytes32 channelId, bytes32 snapshotInboundHash, bool isChannelClosed) external {
        _clearStorage(channelId, snapshotInboundHash, isChannelClosed);
    }

    function hasInboundBlock(bytes32 channelId, bytes32 hash) external view returns (bool) {
        return _hasInboundMessageBlock(channelId, hash);
    }

    function inboundBlockHeight(bytes32 channelId, bytes32 hash) external view returns (uint256) {
        return inboundMessageBlockMap[channelId][hash].blockHeight;
    }

    function historicThresholdSet(Dispute memory dispute) external view returns (address[] memory) {
        return _getHistoricThresholdSet(dispute);
    }

    /// persists an inbound block with deposit total `amount` under `hash` at the current time; it becomes the
    /// channel's inbound head
    function seedDeposit(bytes32 channelId, bytes32 hash, bytes32 previous, uint256 height, uint256 amount) external {
        MessageBlock memory inbound;
        inbound.previousBlockHash = previous;
        inbound.blockHeight = height;
        inbound.timestamp = block.timestamp;
        inbound.totalBalance.amount = amount;
        _seedInboundBlock(channelId, hash, inbound);
    }

    /// the deposit total a landed snapshot records for its own inbound head
    function landSnapshotDeposits(bytes32 channelId, uint256 amount) external {
        stateSnapshots[channelId].snapshotData.totalDeposits.amount = amount;
    }

    /// the deposit read of a snapshot update that pays out no outbound block
    function applyNoOutboundMessageBlocks(bytes32 channelId, SnapshotData memory newSnapshotData) external {
        _applyOutboundMessageBlocks(channelId, new MessageBlock[](0), newSnapshotData);
    }

    /// what `_killDispute` writes for a slashed disputer
    function slashOnChain(bytes32 channelId, address participant) external {
        addOnChainSlashedParticipant(channelId, participant);
    }

    function onChainSlashes(bytes32 channelId) external view returns (address[] memory) {
        return _getOnChainSlashedParticipants(channelId);
    }
}

/// An open channel's prune keeps the snapshot's inbound head, so a later reduction, a dispute anchored at it and
/// the next inbound block all read its real height. Closing the channel prunes the head too.
contract InboundHeadPruningTest is Test, StateChannelManagerEvents {
    bytes32 internal constant CHANNEL_ID = keccak256("inbound-head-pruning");
    bytes32 internal constant FORK_ID = keccak256("inbound-head-pruning-fork");
    bytes32 internal constant H1 = keccak256("inbound 1");
    bytes32 internal constant H2 = keccak256("inbound 2");
    bytes32 internal constant H3 = keccak256("inbound 3");

    address internal a = address(0xA11CE);
    address internal b = address(0xB0B);
    address internal c = address(0xC0FFEE);

    InboundHeadPruningHarness internal harness;

    function setUp() public {
        vm.warp(1_000_000);
        harness = new InboundHeadPruningHarness();
        harness.seedInboundJoins(CHANNEL_ID, H1, bytes32(0), 1, block.timestamp, _addresses(a));
        harness.seedInboundJoins(CHANNEL_ID, H2, H1, 2, block.timestamp, _addresses(b));
    }

    function test_clearStorage_openChannel_keepsTheSnapshotInboundHeadAndPrunesTheBlocksBelow() public {
        harness.seedInboundJoins(CHANNEL_ID, H3, H2, 3, block.timestamp, _addresses(c));

        vm.expectEmit(address(harness));
        emit ChannelStorageCleared(CHANNEL_ID, H1);
        harness.clearStorage(CHANNEL_ID, H2, false);

        assertFalse(harness.hasInboundBlock(CHANNEL_ID, H1), "below the head pruned");
        assertTrue(harness.hasInboundBlock(CHANNEL_ID, H2), "snapshot head kept");
        assertEq(harness.inboundBlockHeight(CHANNEL_ID, H2), 2, "snapshot head keeps its height");
        assertTrue(harness.hasInboundBlock(CHANNEL_ID, H3), "above the head kept");
    }

    function test_clearStorage_closedChannel_prunesTheSnapshotInboundHeadToo() public {
        vm.expectEmit(address(harness));
        emit ChannelStorageCleared(CHANNEL_ID, H2);
        harness.clearStorage(CHANNEL_ID, H2, true);

        assertFalse(harness.hasInboundBlock(CHANNEL_ID, H1));
        assertFalse(harness.hasInboundBlock(CHANNEL_ID, H2));
    }

    function test_clearStorage_openChannel_nextPrunePrunesThePreviouslyKeptHead() public {
        harness.clearStorage(CHANNEL_ID, H2, false);
        harness.seedInboundJoins(CHANNEL_ID, H3, H2, 3, block.timestamp, _addresses(c));

        harness.clearStorage(CHANNEL_ID, H3, false);

        assertFalse(harness.hasInboundBlock(CHANNEL_ID, H2), "the earlier kept head pruned");
        assertTrue(harness.hasInboundBlock(CHANNEL_ID, H3), "the new snapshot head kept");
    }

    function test_clearStorage_openChannel_sameHeadTwice_keepsTheHead() public {
        harness.clearStorage(CHANNEL_ID, H2, false);

        vm.expectEmit(address(harness));
        emit ChannelStorageCleared(CHANNEL_ID, H1);
        harness.clearStorage(CHANNEL_ID, H2, false);

        assertTrue(harness.hasInboundBlock(CHANNEL_ID, H2), "snapshot head kept");
        assertEq(harness.inboundBlockHeight(CHANNEL_ID, H2), 2, "snapshot head keeps its height");
    }

    function test_clearStorage_openChannelWithoutInboundBlocks_prunesNothing() public {
        bytes32 emptyChannel = keccak256("no inbound blocks");

        vm.expectEmit(address(harness));
        emit ChannelStorageCleared(emptyChannel, bytes32(0));
        harness.clearStorage(emptyChannel, bytes32(0), false);
    }

    /// The reduction after a prune used to read height 0 from the deleted head, so the reduced fork could chain no
    /// later inbound block.
    function test_reduce_afterOpenChannelPrune_readsTheSnapshotInboundHeadHeight() public {
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b), H2, 2);
        harness.clearStorage(CHANNEL_ID, H2, false);
        vm.warp(block.timestamp + 5);
        harness.seedWindow(CHANNEL_ID, FORK_ID);

        Dispute[] memory disputes = new Dispute[](1);
        disputes[0].input.channelId = CHANNEL_ID;
        disputes[0].input.forkId = FORK_ID;
        ReduceOutput memory out = harness.reduce(disputes);

        assertEq(out.latestInboundMessageBlockHash, H2);
        assertEq(out.latestInboundMessageBlockHeight, 2);
    }

    /// A dispute anchored at a pruned snapshot's head below the chain head claims the head's real height.
    function test_isDisputeInboundHashValid_afterOpenChannelPrune_acceptsTheSnapshotHeadAtItsHeight() public {
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b), H2, 2);
        harness.clearStorage(CHANNEL_ID, H2, false);
        harness.seedInboundJoins(CHANNEL_ID, H3, H2, 3, block.timestamp, _addresses(c));

        Dispute memory dispute = _disputeAt(H2, 2);
        assertTrue(harness.isDisputeInboundHashValid(dispute), "real height accepted");
        dispute.input.lastInboundMessageBlockHeight = 0;
        assertFalse(harness.isDisputeInboundHashValid(dispute), "zero height refused");
    }

    /// The kept head's JOINs are consumed by the snapshot: a joiner who left since is not counted as pending.
    function test_historicThresholdSet_afterOpenChannelPrune_countsNoJoinOfTheKeptHead() public {
        harness.landSnapshot(CHANNEL_ID, _addresses(a), H2, 2);
        harness.clearStorage(CHANNEL_ID, H2, false);

        address[] memory atHead = harness.historicThresholdSet(_disputeAt(H2, 2));
        assertEq(abi.encode(atHead), abi.encode(_addresses(a)), "b left after its JOIN was consumed");

        harness.seedInboundJoins(CHANNEL_ID, H3, H2, 3, block.timestamp, _addresses(c));
        address[] memory aboveHead = harness.historicThresholdSet(_disputeAt(H3, 3));
        assertEq(abi.encode(aboveHead), abi.encode(_addresses(a, c)), "a JOIN above the head is pending");
    }

    // ---- one inbound resolution for reduce and the deposit reads: stored block, else the snapshot's head ----

    function test_reduce_cutAboveTheSnapshotHead_readsTheStoredBlocksHeight() public {
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b), H2, 2);
        harness.clearStorage(CHANNEL_ID, H2, false);
        harness.seedInboundJoins(CHANNEL_ID, H3, H2, 3, block.timestamp, _addresses(c));
        harness.seedWindow(CHANNEL_ID, FORK_ID);

        ReduceOutput memory out = harness.reduce(_reducedFork());

        assertEq(out.latestInboundMessageBlockHash, H3);
        assertEq(out.latestInboundMessageBlockHeight, 3);
    }

    /// A local mirror can hold the snapshot's inbound head without its block: the snapshot's own height is read.
    function test_reduce_snapshotHeadNotStored_readsTheSnapshotsHeight() public {
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b), H2, 2);
        harness.clearStorage(CHANNEL_ID, H2, true);
        assertFalse(harness.hasInboundBlock(CHANNEL_ID, H2), "premise: the head block is gone");
        harness.seedWindow(CHANNEL_ID, FORK_ID);

        ReduceOutput memory out = harness.reduce(_reducedFork());

        assertEq(out.latestInboundMessageBlockHash, H2);
        assertEq(out.latestInboundMessageBlockHeight, 2);
    }

    /// The earliest window the chain can open after a prune is in the prune's own block, so its cut is at or after
    /// the snapshot head's time and the walk stops at that head.
    function test_reduce_windowOpenedInThePrunesBlock_stopsAtTheSnapshotHead() public {
        harness.seedInboundJoins(CHANNEL_ID, H3, H2, 3, block.timestamp, _addresses(c));
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b, c), H3, 3);
        harness.clearStorage(CHANNEL_ID, H3, false);
        harness.seedWindow(CHANNEL_ID, FORK_ID);

        ReduceOutput memory out = harness.reduce(_reducedFork());

        assertEq(out.latestInboundMessageBlockHash, H3);
        assertEq(out.latestInboundMessageBlockHeight, 3);
    }

    /// The prune below the snapshot head also deletes every dispute window, so a window cut before the head's time
    /// never reaches reduceAndFinalize: it returns without reducing.
    function test_reduceAndFinalize_windowOpenedBeforeThePrune_isDeletedAndReducesNothing() public {
        harness.seedWindow(CHANNEL_ID, FORK_ID);
        vm.warp(block.timestamp + 100);
        harness.seedInboundJoins(CHANNEL_ID, H3, H2, 3, block.timestamp, _addresses(c));
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b, c), H3, 3);
        harness.clearStorage(CHANNEL_ID, H3, false);

        vm.recordLogs();
        harness.reduceAndFinalize(_reducedFork(), _emptySnapshot(), "", new MessageBlock[](0), bytes32(0));

        assertEq(vm.getRecordedLogs().length, 0, "nothing reduced or committed");
    }

    /// The public view without an expired window cuts before every block: an off-chain comparison reads the zero
    /// hash at height zero instead of a revert.
    function test_reduce_withoutADisputeWindow_readsTheZeroHashAtHeightZero() public view {
        ReduceOutput memory out = harness.reduce(_reducedFork());

        assertEq(out.latestInboundMessageBlockHash, bytes32(0));
        assertEq(out.latestInboundMessageBlockHeight, 0);
    }

    function test_reduce_cutBeforeTheFirstInboundBlock_readsTheZeroHashAtHeightZero() public {
        bytes32 channel = keccak256("blocks after the cut");
        harness.seedInboundJoins(channel, H1, bytes32(0), 1, block.timestamp + 100, _addresses(a));
        harness.seedInboundJoins(channel, H2, H1, 2, block.timestamp + 100, _addresses(b));
        harness.landSnapshot(channel, _addresses(a, b), H2, 2);
        harness.seedWindow(channel, FORK_ID);
        Dispute[] memory disputes = _reducedFork();
        disputes[0].input.channelId = channel;

        ReduceOutput memory out = harness.reduce(disputes);

        assertEq(out.latestInboundMessageBlockHash, bytes32(0));
        assertEq(out.latestInboundMessageBlockHeight, 0);
    }

    /// A cut before the snapshot head's time walks into the pruned block below it; only the view reaches this, and
    /// it reads height zero instead of a revert.
    function test_reduce_cutBeforeThePrunedSnapshotHeadsTime_readsThePrunedBlockAtHeightZero() public {
        vm.warp(block.timestamp + 100);
        harness.seedInboundJoins(CHANNEL_ID, H3, H2, 3, block.timestamp, _addresses(c));
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b, c), H3, 3);
        harness.clearStorage(CHANNEL_ID, H3, false);
        harness.seedWindowAt(CHANNEL_ID, FORK_ID, block.timestamp - 100);

        ReduceOutput memory out = harness.reduce(_reducedFork());

        assertEq(out.latestInboundMessageBlockHash, H2);
        assertEq(out.latestInboundMessageBlockHeight, 0);
    }

    function test_verifyBalanceInvariant_storedInboundHead_readsTheBlocksDepositTotal() public {
        bytes32 channel = keccak256("deposits");
        harness.seedDeposit(channel, H1, bytes32(0), 1, 20);
        harness.landSnapshot(channel, _addresses(a), H1, 1);
        harness.landSnapshotDeposits(channel, 99);
        (SnapshotData memory claim, bytes memory state) = _balanceClaim(H1, 20);

        assertTrue(harness.verifyBalanceInvariantCheckSnapshot(channel, claim, state), "the stored total");
        (claim, state) = _balanceClaim(H1, 99);
        assertFalse(harness.verifyBalanceInvariantCheckSnapshot(channel, claim, state), "not the snapshot's total");
    }

    function test_verifyBalanceInvariant_snapshotHeadNotStored_readsTheSnapshotsDepositTotal() public {
        bytes32 channel = keccak256("deposits");
        harness.landSnapshot(channel, _addresses(a), H1, 1);
        harness.landSnapshotDeposits(channel, 30);
        (SnapshotData memory claim, bytes memory state) = _balanceClaim(H1, 30);

        assertTrue(harness.verifyBalanceInvariantCheckSnapshot(channel, claim, state));
    }

    /// A dispute's latest state can name an inbound head that is not on chain: the check answers false, so the
    /// balance counter still decides, instead of reverting.
    function test_verifyBalanceInvariant_missingInboundHead_answersFalseWithoutRevert() public {
        bytes32 channel = keccak256("deposits");
        harness.seedDeposit(channel, H1, bytes32(0), 1, 20);
        harness.landSnapshot(channel, _addresses(a), H1, 1);
        (SnapshotData memory claim, bytes memory state) = _balanceClaim(H3, 20);

        assertFalse(harness.verifyBalanceInvariantCheckSnapshot(channel, claim, state));
    }

    function test_verifyBalanceInvariant_zeroInboundHead_answersFalseWithoutRevert() public {
        bytes32 channel = keccak256("deposits");
        harness.seedDeposit(channel, H1, bytes32(0), 1, 20);
        harness.landSnapshot(channel, _addresses(a), H1, 1);
        (SnapshotData memory claim, bytes memory state) = _balanceClaim(bytes32(0), 20);

        assertFalse(harness.verifyBalanceInvariantCheckSnapshot(channel, claim, state));
    }

    function test_applyOutboundMessageBlocks_storedNewSnapshotHead_reads() public {
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b), H2, 2);
        harness.seedInboundJoins(CHANNEL_ID, H3, H2, 3, block.timestamp, _addresses(c));
        SnapshotData memory next;
        next.latestInboundMessageBlockHash = H3;

        harness.applyNoOutboundMessageBlocks(CHANNEL_ID, next);
    }

    function test_applyOutboundMessageBlocks_snapshotHeadNotStored_reads() public {
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b), H2, 2);
        harness.clearStorage(CHANNEL_ID, H2, true);
        SnapshotData memory next;
        next.latestInboundMessageBlockHash = H2;

        harness.applyNoOutboundMessageBlocks(CHANNEL_ID, next);
    }

    /// A same-fork update takes the channel's inbound head and a fork adoption a reduction's head, so no entry point
    /// reaches a missing head; the read reverts instead of reading zero deposits.
    function test_applyOutboundMessageBlocks_missingNewSnapshotHead_reverts() public {
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b), H2, 2);
        SnapshotData memory next;
        next.latestInboundMessageBlockHash = H3;

        vm.expectRevert(abi.encodeWithSelector(ErrorInboundMessageBlockNotStored.selector, CHANNEL_ID, H3));
        harness.applyNoOutboundMessageBlocks(CHANNEL_ID, next);
    }

    function test_applyOutboundMessageBlocks_zeroNewSnapshotHead_reverts() public {
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b), H2, 2);
        SnapshotData memory next;

        vm.expectRevert(abi.encodeWithSelector(ErrorInboundMessageBlockNotStored.selector, CHANNEL_ID, bytes32(0)));
        harness.applyNoOutboundMessageBlocks(CHANNEL_ID, next);
    }

    /// A slash of an address that already exited stays recorded until the next pruning snapshot update deletes it.
    function test_clearStorage_openChannel_dropsTheSlashOfAnExitedAddress() public {
        harness.landSnapshot(CHANNEL_ID, _addresses(a), H2, 2);
        harness.slashOnChain(CHANNEL_ID, b);
        assertEq(abi.encode(harness.onChainSlashes(CHANNEL_ID)), abi.encode(_addresses(b)), "premise: recorded");

        harness.clearStorage(CHANNEL_ID, H2, false);

        assertEq(harness.onChainSlashes(CHANNEL_ID).length, 0);
    }

    function _reducedFork() internal pure returns (Dispute[] memory disputes) {
        disputes = new Dispute[](1);
        disputes[0].input.channelId = CHANNEL_ID;
        disputes[0].input.forkId = FORK_ID;
    }

    function _emptySnapshot() internal pure returns (StateSnapshot memory snapshot) {}

    /// a one-participant snapshot claim at inbound head `inboundHash` whose state and deposits both hold `amount`
    function _balanceClaim(bytes32 inboundHash, uint256 amount)
        internal
        view
        returns (SnapshotData memory claim, bytes memory encodedState)
    {
        MathState memory state;
        state.participants = _addresses(a);
        state.balances = new uint256[](1);
        state.balances[0] = amount;
        encodedState = abi.encode(state);
        claim.stateMachineStateHash = keccak256(encodedState);
        claim.participants = _addresses(a);
        claim.latestInboundMessageBlockHash = inboundHash;
        claim.totalDeposits.amount = amount;
    }

    function _disputeAt(bytes32 inboundHash, uint256 inboundHeight) internal pure returns (Dispute memory dispute) {
        dispute.input.channelId = CHANNEL_ID;
        dispute.input.forkId = FORK_ID;
        dispute.input.latestInboundMessageBlockHash = inboundHash;
        dispute.input.lastInboundMessageBlockHeight = inboundHeight;
    }

    function _addresses(address first) internal pure returns (address[] memory addresses) {
        addresses = new address[](1);
        addresses[0] = first;
    }

    function _addresses(address first, address second) internal pure returns (address[] memory addresses) {
        addresses = new address[](2);
        addresses[0] = first;
        addresses[1] = second;
    }

    function _addresses(address first, address second, address third)
        internal
        pure
        returns (address[] memory addresses)
    {
        addresses = new address[](3);
        addresses[0] = first;
        addresses[1] = second;
        addresses[2] = third;
    }
}
